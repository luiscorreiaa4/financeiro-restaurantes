import {
  type Actor,
  type Clock,
  ENTRY_EXPORT_COLUMNS,
  type EntryScope,
  type ExportFileStore,
  FULL_EXPORT_EXTRA_COLUMNS,
  HISTORY_EXPORT_COLUMNS,
  historyRows,
  type JobQueue,
} from "@app/core";
import {
  type EntryFilters,
  EXPORT_MAX_ROWS,
  EXPORT_RETENTION_DAYS,
  type ExportErrorCode,
} from "@app/core/contracts";
import {
  type Database,
  type ExportRecord,
  entryReader,
  exportsRepo,
  type PanelAccessStore,
  withTenant,
} from "@app/db";
import {
  type AnyExportSheet,
  writeCsv,
  writeXlsx,
  zipFiles,
} from "../../infra/exports/export-writers";
import { type ExportFileExt, exportFileKey } from "../../infra/exports/local-export-store";
import type { JobLogger } from "../../infra/logger";
import { authorizeExport } from "./export-authorization";
import { discardExportFile, failExport } from "./export-failure";
import {
  DELETE_EXPORT_FILE_QUEUE,
  type ExportJobAttempt,
  type ExportJobOutcome,
  exportJobSchema,
} from "./queues";

/** Falha de domínio: o pedido vira `failed` com este código, sem retry. */
class ExportDomainError extends Error {
  constructor(readonly code: ExportErrorCode) {
    super(code);
    this.name = "ExportDomainError";
  }
}

export interface GenerateExportDeps {
  appDb: Database;
  access: PanelAccessStore;
  store: ExportFileStore;
  queue: JobQueue;
  clock: Clock;
  logger: JobLogger;
  /** Só os testes mudam isto (DD-42). */
  maxRows?: number;
}

type Prepared = { actor: Actor; scope: EntryScope; filters: EntryFilters };

/**
 * Worker `generate-export` (RF29, DD-42). O ator e o escopo são RECALCULADOS aqui a partir do
 * vínculo atual de quem pediu (A.8-2): nada do pedido além de tenant e id vale como autorização.
 * Nunca persiste mensagem de erro nem loga filtros, linhas ou conteúdo (regra 9).
 */
export function createGenerateExport(
  deps: GenerateExportDeps,
): (payload: unknown, attempt?: ExportJobAttempt) => Promise<ExportJobOutcome> {
  const maxRows = deps.maxRows ?? EXPORT_MAX_ROWS;

  const failWith = (record: ExportRecord, code: ExportErrorCode) =>
    failExport(deps.appDb, record, code);

  async function prepare(record: ExportRecord): Promise<Prepared> {
    const authorization = await authorizeExport(deps.access, record);
    if (!authorization.ok) {
      throw new ExportDomainError(
        authorization.code === "invalid_filters" ? "generation_failed" : "forbidden",
      );
    }
    return authorization;
  }

  async function build(
    record: ExportRecord,
    { scope, filters }: Prepared,
  ): Promise<{ bytes: Uint8Array; ext: ExportFileExt; rowCount: number }> {
    const full = record.content === "full";
    const data = await withTenant(deps.appDb, record.tenantId, async (tx) => {
      const rows = await entryReader.exportRows(tx, scope, filters, {
        includeDeleted: full,
        limit: maxRows + 1,
      });
      if (rows.length > maxRows) throw new ExportDomainError("too_many_rows");
      if (!full) return { rows, history: [] };
      const versions = await entryReader.exportVersions(
        tx,
        rows.map((r) => r.id),
      );
      const names = await entryReader.exportVersionNames(tx);
      // Fail-closed: a folha no histórico só sai se o recorte do ator a inclui (o dono).
      return {
        rows,
        history: historyRows(versions, names, { includeSensitive: scope.includeSensitive }),
      };
    });

    const columns = full
      ? [...ENTRY_EXPORT_COLUMNS, ...FULL_EXPORT_EXTRA_COLUMNS]
      : ENTRY_EXPORT_COLUMNS;
    const entries = { name: "Lançamentos", columns, rows: data.rows };
    const history = { name: "Histórico", columns: HISTORY_EXPORT_COLUMNS, rows: data.history };
    const rowCount = data.rows.length;
    if (record.format === "xlsx") {
      const sheets: AnyExportSheet[] = full ? [entries, history] : [entries];
      return { bytes: await writeXlsx(sheets), ext: "xlsx", rowCount };
    }
    if (!full) return { bytes: writeCsv(entries), ext: "csv", rowCount };
    return {
      bytes: zipFiles({
        "lancamentos.csv": writeCsv(entries),
        "historico.csv": writeCsv(history),
      }),
      ext: "zip",
      rowCount,
    };
  }

  return async (payload, attempt) => {
    const parsed = exportJobSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.error({ issues: parsed.error.issues.length }, "job generate-export inválido");
      return "skipped";
    }
    const { tenantId, exportId } = parsed.data;
    const startedAt = performance.now();

    // 1. Assume o pedido: queued -> generating. `generating` é retry; o resto não se repete.
    const record = await withTenant(deps.appDb, tenantId, async (tx) => {
      const current = await exportsRepo.get(tx, exportId);
      if (current === null || current.tenantId !== tenantId) return null;
      if (current.status === "queued") {
        if (!(await exportsRepo.markGenerating(tx, exportId))) return null;
        return { ...current, status: "generating" as const };
      }
      return current.status === "generating" ? current : null;
    });
    if (record === null) {
      deps.logger.info({ exportId }, "exportação já tratada ou inexistente, job ignorado");
      return "skipped";
    }

    try {
      const prepared = await prepare(record);
      const { bytes, ext, rowCount } = await build(record, prepared);
      const fileKey = exportFileKey(tenantId, exportId, ext);
      // Chave determinística: um put repetido (retry) sobrescreve.
      await deps.store.put(fileKey, bytes);
      // A limpeza é agendada antes do `ready`: se algo falhar daqui em diante, o retry não
      // deixa arquivo sem job de remoção (a fila é `exclusive` por exportId).
      await deps.queue.enqueue(
        DELETE_EXPORT_FILE_QUEUE,
        { tenantId, exportId },
        { singletonKey: exportId, startAfterSeconds: EXPORT_RETENTION_DAYS * 86_400 },
      );
      const marked = await withTenant(deps.appDb, tenantId, async (tx) => {
        const ok = await exportsRepo.markReady(tx, exportId, {
          fileKey,
          fileSize: bytes.length,
          rowCount,
          includedSensitive: prepared.scope.includeSensitive,
        });
        if (ok) {
          await exportsRepo.audit(tx, {
            tenantId,
            actorId: record.requestedBy,
            action: "export_ready",
            exportId,
            metadata: { rowCount },
          });
        }
        return ok;
      });
      if (!marked) return "skipped";
      deps.logger.info(
        { exportId, rowCount, durationMs: Math.round(performance.now() - startedAt) },
        "exportação pronta",
      );
      return "done";
    } catch (error) {
      if (error instanceof ExportDomainError) {
        await failWith(record, error.code);
        deps.logger.warn({ exportId, errorCode: error.code }, "exportação falhou");
        return "done";
      }
      const lastAttempt = attempt !== undefined && attempt.retryCount >= attempt.retryLimit;
      if (lastAttempt) {
        // Terminal: o `put` pode ter gravado o arquivo antes da falha; apaga sem mascarar o erro.
        await failWith(record, "generation_failed");
        await discardExportFile(deps.store, record);
      }
      deps.logger.warn(
        { exportId, errorName: error instanceof Error ? error.name : "UnknownError", lastAttempt },
        lastAttempt ? "exportação falhou após todas as tentativas" : "erro ao gerar, vai retentar",
      );
      throw error;
    }
  };
}
