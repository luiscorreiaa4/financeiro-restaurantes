import {
  accountAllows,
  type Clock,
  can,
  type EntryChange,
  type EntryStore,
  type FeeReapplicationPlan,
  planFeeReapplication,
  resolvePanelContext,
} from "@app/core";
import type {
  FeeReapplicationRecord,
  FeeReapplicationScope,
  FeeReapplyBatch,
  FeeReapplyRepo,
  PanelAccessStore,
} from "@app/db";
import type { JobLogger } from "../../infra/logger";
import {
  type FeeReapplyJobAttempt,
  type FeeReapplyJobOutcome,
  feeReapplyJobSchema,
} from "./queues";

/** Tamanho do lote da reaplicação (RF08/RF09, DD de F6a). */
export const FEE_REAPPLY_BATCH_SIZE = 200;

export interface RunFeeReapplyDeps {
  repo: FeeReapplyRepo;
  store: Pick<EntryStore, "applyChanges">;
  /** Vínculo atual de quem confirmou (o job refaz a autorização, como a exportação). */
  access: PanelAccessStore;
  clock: Clock;
  logger: JobLogger;
  /** Só os testes mudam isto. */
  batchSize?: number;
}

const scopeOf = (record: FeeReapplicationRecord): FeeReapplicationScope => ({
  targetKind: record.targetKind,
  targetId: record.targetId,
  from: record.from,
  to: record.to,
});

/** Prévia: conta, sem gravar, o que a reaplicação mudaria. `null` se o alvo não existe. */
export async function previewFeeReapplication(
  deps: Pick<RunFeeReapplyDeps, "repo" | "clock" | "batchSize">,
  tenantId: string,
  actorId: string,
  scope: FeeReapplicationScope,
): Promise<{
  matched: number;
  deltaNetCents: number;
  feePercentBp: number;
  feeFixedCents: number;
} | null> {
  const rate = await deps.repo.findTarget(tenantId, scope.targetKind, scope.targetId);
  if (rate === null) return null;
  const ctx = { actorId, channel: "web" as const, at: deps.clock.now() };
  const size = deps.batchSize ?? FEE_REAPPLY_BATCH_SIZE;
  let matched = 0;
  let deltaNetCents = 0;
  let after: string | null = null;
  for (;;) {
    const batch: FeeReapplyBatch = await deps.repo.loadBatch(tenantId, scope, after, size);
    if (batch.entries.length === 0) break;
    const plan = planFeeReapplication(batch.entries, batch.catalog, ctx);
    matched += plan.matched;
    deltaNetCents += plan.deltaNetCents;
    after = batch.entries[batch.entries.length - 1]?.id ?? null;
    if (batch.entries.length < size) break;
  }
  return { matched, deltaNetCents, ...rate };
}

/**
 * Worker `fee-reapply` (F6a, RF08 e RF09 Alteração). A linha é a fonte da verdade: período, alvo e
 * taxa vista vêm dela, nunca do payload. Autor das versões = quem confirmou (o dono), canal `web`.
 * Idempotente: o plano pula o lançamento que já tem a regra (`NothingToChange`). Nunca persiste
 * mensagem de erro (só código curto) nem loga valor ou descrição.
 */
export function createRunFeeReapply(
  deps: RunFeeReapplyDeps,
): (payload: unknown, attempt?: FeeReapplyJobAttempt) => Promise<FeeReapplyJobOutcome> {
  const size = deps.batchSize ?? FEE_REAPPLY_BATCH_SIZE;

  /** Aplica o plano; se a guarda de versão recusar, relê o lote UMA vez e replaneja. */
  async function applyBatch(
    tenantId: string,
    record: FeeReapplicationRecord,
    batch: FeeReapplyBatch,
  ): Promise<{ matched: number; updated: number; skipped: number }> {
    const ctx = { actorId: record.createdBy, channel: "web" as const, at: deps.clock.now() };
    const first = planFeeReapplication(batch.entries, batch.catalog, ctx);
    if (first.changes.length === 0) {
      return { matched: first.matched, updated: 0, skipped: first.skipped };
    }
    if (await deps.store.applyChanges(tenantId, first.changes)) {
      return { matched: first.matched, updated: first.matched, skipped: first.skipped };
    }

    // A releitura aplica o mesmo recorte do lote: quem saiu dele (outra forma ou canal, data fora
    // do período, tipo trocado, excluído) não é replanejado nem sobrescrito; conta como pulado.
    const fresh = await deps.repo.loadEntries(
      tenantId,
      scopeOf(record),
      batch.entries.map((e) => e.id),
    );
    const left = batch.entries.length - fresh.entries.length;
    const second: FeeReapplicationPlan = planFeeReapplication(fresh.entries, fresh.catalog, ctx);
    if (second.changes.length === 0) {
      return { matched: second.matched, updated: 0, skipped: second.skipped + left };
    }
    if (await deps.store.applyChanges(tenantId, second.changes)) {
      return {
        matched: second.matched,
        updated: second.matched,
        skipped: second.skipped + left,
      };
    }

    // Ainda divergiu: um por vez, para só pular o lançamento disputado.
    let updated = 0;
    let skipped = second.skipped + left;
    for (const change of second.changes as EntryChange[]) {
      if (await deps.store.applyChanges(tenantId, [change])) updated += 1;
      else skipped += 1;
    }
    return { matched: second.matched, updated, skipped };
  }

  /** Transição que não afetou linha: avisa (só ids e nome da operação, sem dado). */
  async function settle(done: Promise<boolean>, reapplicationId: string, op: string) {
    if (!(await done)) {
      deps.logger.warn({ reapplicationId, op }, "reaplicação: nenhuma linha afetada na transição");
    }
  }

  /** Regra efetiva do alvo no catálogo lido junto com o lote (a mesma que o plano vai usar). */
  function batchRate(record: FeeReapplicationRecord, batch: FeeReapplyBatch) {
    if (record.targetKind === "payment_method") {
      return batch.catalog.paymentMethods.get(record.targetId) ?? null;
    }
    const channel = batch.catalog.salesChannels.get(record.targetId);
    return channel ? { feePercentBp: channel.feePercentBp, feeFixedCents: 0 } : null;
  }

  /**
   * Autorização atual de quem confirmou (como a exportação, A.8-2): ainda dono ativo com
   * `catalog:manage` e a conta ainda grava (RF37). Falha fechado.
   */
  async function authorAllowed(record: FeeReapplicationRecord): Promise<boolean> {
    const resolution = resolvePanelContext(
      await deps.access.listPanelMemberships(record.createdBy),
      {
        tenantId: record.tenantId,
        unitId: "all",
      },
    );
    if (!resolution.ok || resolution.source !== "cookie") return false;
    const { context } = resolution;
    if (context.tenantId !== record.tenantId) return false;
    if (!can(context.actor, "catalog:manage")) return false;
    return accountAllows(context.accountStatus, context.actor.role).write;
  }

  async function process(
    tenantId: string,
    record: FeeReapplicationRecord,
  ): Promise<"done" | "failed"> {
    const rate = await deps.repo.findTarget(tenantId, record.targetKind, record.targetId);
    if (rate === null) {
      await settle(
        deps.repo.markFailed(tenantId, record.id, "target_not_found"),
        record.id,
        "markFailed",
      );
      return "failed";
    }
    // A taxa mudou depois da confirmação: o usuário não aprovou este valor.
    if (rate.feePercentBp !== record.feePercentBp || rate.feeFixedCents !== record.feeFixedCents) {
      await settle(
        deps.repo.markFailed(tenantId, record.id, "rate_changed"),
        record.id,
        "markFailed",
      );
      return "failed";
    }
    const scope = scopeOf(record);
    let after: string | null = null;
    for (;;) {
      // A cada lote: o autor ainda pode e a taxa vista na confirmação ainda vale. Lotes já
      // aplicados ficam; `failed` + contadores parciais avisam o dono.
      if (!(await authorAllowed(record))) {
        await settle(
          deps.repo.markFailed(tenantId, record.id, "not_allowed"),
          record.id,
          "markFailed",
        );
        return "failed";
      }
      const batch: FeeReapplyBatch = await deps.repo.loadBatch(tenantId, scope, after, size);
      if (batch.entries.length === 0) break;
      const current = batchRate(record, batch);
      if (
        current === null ||
        current.feePercentBp !== record.feePercentBp ||
        current.feeFixedCents !== record.feeFixedCents
      ) {
        await settle(
          deps.repo.markFailed(
            tenantId,
            record.id,
            current === null ? "target_not_found" : "rate_changed",
          ),
          record.id,
          "markFailed",
        );
        return "failed";
      }
      const result = await applyBatch(tenantId, record, batch);
      // Contadores na linha depois de CADA lote: um retry soma ao que já foi aplicado. Há uma janela
      // mínima entre o `applyChanges` e este UPDATE (o armazém de lançamentos tem transação própria).
      if (result.matched + result.updated + result.skipped > 0) {
        await settle(deps.repo.addProgress(tenantId, record.id, result), record.id, "addProgress");
      }
      after = batch.entries[batch.entries.length - 1]?.id ?? null;
      if (batch.entries.length < size) break;
    }
    await settle(deps.repo.markDone(tenantId, record.id), record.id, "markDone");
    return "done";
  }

  return async (payload, attempt) => {
    const parsed = feeReapplyJobSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.error({ issues: parsed.error.issues.length }, "job fee-reapply inválido");
      return "skipped";
    }
    const { tenantId, reapplicationId } = parsed.data;

    // Assume a linha: queued -> running. `running` é retry; terminado não se repete.
    const current = await deps.repo.get(tenantId, reapplicationId);
    if (current === null || current.tenantId !== tenantId) {
      deps.logger.info({ reapplicationId }, "reaplicação inexistente, job ignorado");
      return "skipped";
    }
    if (current.status === "queued") {
      if (!(await deps.repo.markRunning(tenantId, reapplicationId))) return "skipped";
    } else if (current.status !== "running") {
      deps.logger.info({ reapplicationId }, "reaplicação já tratada, job ignorado");
      return "skipped";
    }

    const startedAt = performance.now();
    try {
      const outcome = await process(tenantId, current);
      deps.logger.info(
        { reapplicationId, outcome, durationMs: Math.round(performance.now() - startedAt) },
        "reaplicação de taxa concluída",
      );
      return "done";
    } catch (error) {
      const lastAttempt = attempt !== undefined && attempt.retryCount >= attempt.retryLimit;
      if (lastAttempt) {
        await settle(
          deps.repo.markFailed(tenantId, reapplicationId, "job_failed"),
          reapplicationId,
          "markFailed",
        );
      }
      deps.logger.warn(
        {
          reapplicationId,
          errorName: error instanceof Error ? error.name : "UnknownError",
          lastAttempt,
        },
        lastAttempt
          ? "reaplicação falhou após todas as tentativas"
          : "erro na reaplicação, vai retentar",
      );
      throw error;
    }
  };
}

/**
 * Consumidor da DLQ de `fee-reapply`: o job esgotou as tentativas sem passar pelo caso de uso
 * (por exemplo, expirou com o worker morto). Linha `queued` ou `running` vira `failed`. Idempotente.
 */
export function createFailStuckFeeReapply(deps: {
  repo: FeeReapplyRepo;
  logger: JobLogger;
}): (payload: unknown) => Promise<FeeReapplyJobOutcome> {
  return async (payload) => {
    const parsed = feeReapplyJobSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.error(
        { issues: parsed.error.issues.length },
        "job na DLQ de fee-reapply inválido",
      );
      return "skipped";
    }
    const { tenantId, reapplicationId } = parsed.data;
    if (!(await deps.repo.markFailed(tenantId, reapplicationId, "job_failed"))) return "skipped";
    deps.logger.warn(
      { reapplicationId, errorCode: "job_failed" },
      "reaplicação presa falhou na DLQ",
    );
    return "done";
  };
}
