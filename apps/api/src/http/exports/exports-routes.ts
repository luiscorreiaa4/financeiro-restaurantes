import { type Clock, can, type ExportFileStore, entryScopeFor, type JobQueue } from "@app/core";
import {
  EXPORT_MAX_PENDING,
  EXPORT_RETENTION_DAYS,
  type ExportItem,
  exportCreateBodySchema,
  exportItemSchema,
  exportLinkResponseSchema,
  exportListResponseSchema,
} from "@app/core/contracts";
import {
  EXPORTS_CLIENT_REQUEST_UNIQUE,
  type ExportRecord,
  exportsRepo,
  isExportAvailable,
  isUniqueViolation,
  type Transaction,
  withTenant,
} from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { canDeliverExport } from "../../modules/exports/export-authorization";
import { exportDownloadInfo } from "../../modules/exports/export-download";
import { failExport } from "../../modules/exports/export-failure";
import { GENERATE_EXPORT_QUEUE } from "../../modules/exports/queues";
import {
  decoratePanelRequest,
  type PanelDeps,
  type PanelRequestContext,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
} from "../panel/panel-context";

/** Token do link de download (o adaptador mora em `infra/exports/export-link.ts`). */
export interface ExportLinkSignerPort {
  issue(input: { exportId: string; userId: string; tenantId: string }): {
    token: string;
    expiresAt: Date;
  };
  verify(token: string, input: { exportId: string; userId: string; tenantId: string }): boolean;
}

export type ExportsRoutesDeps = PanelDeps & {
  readonly clock: Clock;
  readonly store: ExportFileStore;
  readonly queue: JobQueue;
  readonly linkSigner: ExportLinkSignerPort;
  /** UUID v7 do pedido. */
  readonly newId: () => string;
};

const DAY_MS = 86_400_000;
const idSchema = z.uuid();

function callerOf(request: FastifyRequest): { panel: PanelRequestContext; userId: string } {
  if (request.panel == null || request.session == null) {
    throw new Error("requirePanelContext não preencheu o contexto");
  }
  return { panel: request.panel, userId: request.session.userId };
}

/**
 * Item do contrato para o pedido. `available` é a regra única do repositório; o `parse` é a
 * última barreira da saída (nada além do que o contrato declara).
 */
function toItem(record: ExportRecord, now: Date): ExportItem {
  return exportItemSchema.parse({
    id: record.id,
    format: record.format,
    content: record.content,
    status: record.status,
    rowCount: record.rowCount,
    fileSize: record.fileSize,
    errorCode: record.errorCode,
    filters: record.filters,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    available: isExportAvailable(record, now),
  });
}

/**
 * Exportação do painel (F5, RF29, DD-42). Exportar é leitura (DD-06): sem `requireWritable`, a
 * conta somente leitura exporta. Erros só com `{ code }`; nada de token, URL com `?t=`, filtro,
 * busca, nome de arquivo, cookie ou `X-Context` em log (regra 9).
 */
export const exportsRoutes: FastifyPluginAsync<{ deps: ExportsRoutesDeps }> = async (
  app,
  { deps },
) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      // Só o tipo do erro: a mensagem do driver traz SQL e parâmetros.
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha nas exportações");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const guards = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("export:data"),
  ];

  /**
   * Download é navegação do navegador (`window.location.assign`): não manda `X-Context`, então o
   * contexto vem só do cookie `fr_ctx`. Cookie inválido segue 403. O que protege o arquivo é o
   * pedido ser lido por `withTenant` do tenant do cookie, só do próprio autor, e o token ser
   * assinado para exportação, usuário E empresa.
   */
  const downloadGuards = [
    requirePanelContext(deps),
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (callerOf(request).panel.source === "invalid_cookie") {
        return reply.code(403).send({ code: "context_invalid" });
      }
    },
    requirePermission("export:data"),
  ];

  app.post("/api/exports", { preHandler: guards }, async (request, reply) => {
    const parsed = exportCreateBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const body = parsed.data;
    const { panel, userId } = callerOf(request);
    // COMPLETO é só do dono (RF29.Obs1 e R3).
    if (body.content === "full" && !can(panel.actor, "export:full")) {
      return reply.code(403).send({ code: "forbidden" });
    }
    // A unidade dos filtros tem de estar no acesso de quem pede (RF06.R5); o worker recalcula.
    const scope = entryScopeFor({
      actor: panel.actor,
      userId,
      activeUnitId: panel.unitId,
      requestedUnitIds: body.filters.unitIds,
    });
    if (!scope.ok) return reply.code(403).send({ code: "forbidden" });

    type Outcome =
      | { kind: "replayed"; record: ExportRecord }
      | { kind: "created"; record: ExportRecord }
      | { kind: "too_many_pending" };

    /** Repetição: o pedido da chave, do próprio usuário. */
    const replay = (tx: Transaction) =>
      exportsRepo.findByClientRequest(tx, userId, body.clientRequestId);

    /** Um `withTenant` só: chave, teto, gravação e auditoria. */
    const run = async (tx: Transaction): Promise<Outcome> => {
      const existing = await replay(tx);
      if (existing !== null) return { kind: "replayed", record: existing };
      if ((await exportsRepo.countPending(tx, userId)) >= EXPORT_MAX_PENDING) {
        return { kind: "too_many_pending" };
      }
      const record = await exportsRepo.insert(tx, {
        id: deps.newId(),
        tenantId: panel.tenantId,
        requestedBy: userId,
        unitChoice: panel.unitId,
        format: body.format,
        content: body.content,
        filters: body.filters,
        clientRequestId: body.clientRequestId,
      });
      await exportsRepo.audit(tx, {
        tenantId: panel.tenantId,
        actorId: userId,
        action: "export_requested",
        exportId: record.id,
        // O texto livre da busca nunca vai para a auditoria (regra 9).
        metadata: {
          format: body.format,
          content: body.content,
          filters: { ...body.filters, q: body.filters.q ? "[busca]" : undefined },
        },
      });
      return { kind: "created", record };
    };

    let outcome: Outcome;
    try {
      outcome = await withTenant(deps.appDb, panel.tenantId, run);
    } catch (error) {
      if (!isUniqueViolation(error, EXPORTS_CLIENT_REQUEST_UNIQUE)) throw error;
      // Corrida com a mesma chave: a transação inteira foi desfeita; só relê, em transação nova.
      const record = await withTenant(deps.appDb, panel.tenantId, replay);
      if (record === null) return reply.code(409).send({ code: "already_submitted" });
      outcome = { kind: "replayed", record };
    }

    if (outcome.kind === "too_many_pending") {
      return reply.code(429).send({ code: "too_many_pending" });
    }
    const now = deps.clock.now();
    if (outcome.kind === "replayed") return reply.code(200).send(toItem(outcome.record, now));

    // O job vai DEPOIS do commit (o worker só enxerga o pedido já gravado). Se a fila falhar, o
    // pedido não pode ficar `queued` para sempre: vira `failed`/`generation_failed` (e o
    // `fail-stuck-export` do worker cobre o caso de esta marcação também falhar).
    const { record } = outcome;
    try {
      await deps.queue.enqueue(
        GENERATE_EXPORT_QUEUE,
        { tenantId: panel.tenantId, exportId: record.id },
        { singletonKey: record.id },
      );
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : typeof error },
        "falha ao enfileirar a exportação",
      );
      await failExport(deps.appDb, record, "generation_failed").catch((failure: unknown) => {
        request.log.error(
          { errorName: failure instanceof Error ? failure.name : typeof failure },
          "falha ao marcar a exportação como falha",
        );
      });
      return reply.code(503).send({ code: "queue_unavailable" });
    }
    return reply.code(202).send(toItem(record, now));
  });

  app.get("/api/exports", { preHandler: guards }, async (request) => {
    const { panel, userId } = callerOf(request);
    const now = deps.clock.now();
    const since = new Date(now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS);
    const records = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      exportsRepo.listForUser(tx, userId, since),
    );
    return exportListResponseSchema.parse({ items: records.map((record) => toItem(record, now)) });
  });

  /**
   * Pedido do próprio usuário na empresa ativa, ou `null`: outro usuário, outra empresa, id
   * inexistente ou id que não é UUID respondem igual (404), sem dizer qual.
   */
  async function findOwn(request: FastifyRequest): Promise<ExportRecord | null> {
    const parsedId = idSchema.safeParse((request.params as { id?: unknown }).id);
    if (!parsedId.success) return null;
    const { panel, userId } = callerOf(request);
    const record = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      exportsRepo.get(tx, parsedId.data),
    );
    return record !== null && record.requestedBy === userId ? record : null;
  }

  app.post("/api/exports/:id/link", { preHandler: guards }, async (request, reply) => {
    const record = await findOwn(request);
    if (record === null) return reply.code(404).send({ code: "export_not_found" });
    if (record.status !== "ready") return reply.code(409).send({ code: "export_not_ready" });
    if (!isExportAvailable(record, deps.clock.now())) {
      return reply.code(410).send({ code: "export_expired" });
    }
    // A autorização do conteúdo vale enquanto o arquivo existir, não só na geração (A.8-2).
    if (!(await canDeliverExport(deps.access, record))) {
      return reply.code(403).send({ code: "forbidden" });
    }
    const { panel, userId } = callerOf(request);
    const { token, expiresAt } = deps.linkSigner.issue({
      exportId: record.id,
      userId,
      tenantId: panel.tenantId,
    });
    return exportLinkResponseSchema.parse({
      url: `/api/exports/${record.id}/download?t=${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  });

  /**
   * Ordem fixa e nenhum byte antes do fim: 404 (autor e empresa), 403 `link_invalid` (token
   * ausente, inválido, vencido, de outro pedido, usuário ou empresa), 410 (sem arquivo), 403
   * `forbidden` (o autor não pode mais receber este conteúdo).
   */
  app.get("/api/exports/:id/download", { preHandler: downloadGuards }, async (request, reply) => {
    const record = await findOwn(request);
    if (record === null) return reply.code(404).send({ code: "export_not_found" });
    const { panel, userId } = callerOf(request);
    const token = (request.query as { t?: unknown }).t;
    if (
      typeof token !== "string" ||
      !deps.linkSigner.verify(token, {
        exportId: record.id,
        userId,
        tenantId: panel.tenantId,
      })
    ) {
      return reply.code(403).send({ code: "link_invalid" });
    }
    if (!isExportAvailable(record, deps.clock.now()) || record.fileKey === null) {
      return reply.code(410).send({ code: "export_expired" });
    }
    // Nenhum byte antes de refazer a autorização (A.8-2, RF06.R3, RF29.R2).
    if (!(await canDeliverExport(deps.access, record))) {
      return reply.code(403).send({ code: "forbidden" });
    }
    const bytes = await deps.store.get(record.fileKey);
    if (bytes === null) return reply.code(410).send({ code: "export_expired" });

    await withTenant(deps.appDb, panel.tenantId, (tx) =>
      exportsRepo.audit(tx, {
        tenantId: panel.tenantId,
        actorId: userId,
        action: "export_downloaded",
        exportId: record.id,
        metadata: { format: record.format, content: record.content },
      }),
    );
    const { fileName, contentType } = exportDownloadInfo(record);
    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(bytes));
  });
};
