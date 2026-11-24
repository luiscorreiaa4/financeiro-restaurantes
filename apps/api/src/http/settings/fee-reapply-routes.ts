import type { Clock, JobQueue } from "@app/core";
import {
  FEE_REAPPLICATION_TARGET_KINDS,
  feeReapplicationInputSchema,
  feeReapplicationPreviewInputSchema,
  feeReapplicationPreviewSchema,
  feeReapplicationSchema,
} from "@app/core/contracts";
import type { FeeReapplicationRecord, FeeReapplyRepo } from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { FEE_REAPPLY_QUEUE } from "../../modules/fee-reapply/queues";
import { previewFeeReapplication } from "../../modules/fee-reapply/run-fee-reapply";
import {
  decoratePanelRequest,
  type PanelDeps,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
  requireWritable,
} from "../panel/panel-context";

export type FeeReapplyRoutesDeps = PanelDeps & {
  readonly feeReapply: FeeReapplyRepo;
  readonly queue: JobQueue;
  readonly clock: Clock;
  /** UUID v7 da linha. */
  readonly newId: () => string;
};

/** Mesmo teto do CHECK da tabela (`to_date - from_date <= 366`). */
const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;

const latestQuerySchema = z
  .object({ targetKind: z.enum(FEE_REAPPLICATION_TARGET_KINDS), targetId: z.uuid() })
  .strict();

const toItem = (record: FeeReapplicationRecord) =>
  feeReapplicationSchema.parse({
    id: record.id,
    targetKind: record.targetKind,
    targetId: record.targetId,
    from: record.from,
    to: record.to,
    status: record.status,
    errorCode: record.errorCode,
    matched: record.matched ?? 0,
    updated: record.updated ?? 0,
    skipped: record.skipped ?? 0,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
  });

/**
 * Reaplicação da taxa atual a lançamentos passados (F6a, RF08 e RF09, Alteração): só
 * `catalog:manage` (o dono). A prévia e a consulta não gravam (sem `requireWritable`); a
 * confirmação grava e enfileira o job `fee-reapply`. Erros só com `{ code }` (a 409 leva também a
 * linha em andamento, da mesma empresa); nada de cookie, `X-Context` ou valor em log (regra 9).
 */
export const feeReapplyRoutes: FastifyPluginAsync<{ deps: FeeReapplyRoutesDeps }> = async (
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
      request.log.error(
        { errorName: error.name, errorCode: error.code },
        "falha na reaplicação de taxa",
      );
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const read = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("catalog:manage"),
  ];
  const write = [...read, requireWritable()];

  /** Tenant e autor vêm do contexto revalidado, nunca do corpo, da URL ou do cabeçalho. */
  function callerOf(request: FastifyRequest): { tenantId: string; userId: string } {
    if (request.panel == null || request.session == null) {
      throw new Error("requirePanelContext não preencheu o contexto");
    }
    return { tenantId: request.panel.tenantId, userId: request.session.userId };
  }

  /** Período de até 366 dias e fim até hoje (data de negócio). `null` se válido. */
  function periodIssue(from: string, to: string): { field: string; reason: string } | null {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
    if (days > MAX_PERIOD_DAYS) return { field: "period", reason: "too_long" };
    if (to > deps.clock.today()) return { field: "to", reason: "future" };
    return null;
  }
  const invalidPeriod = (reply: FastifyReply, issue: { field: string; reason: string }) =>
    reply.code(422).send({ code: "validation", ...issue });

  /** Enfileira o job `fee-reapply`; `false` se a fila falhou (só o tipo do erro vai ao log). */
  async function enqueue(
    request: FastifyRequest,
    tenantId: string,
    reapplicationId: string,
  ): Promise<boolean> {
    try {
      await deps.queue.enqueue(
        FEE_REAPPLY_QUEUE,
        { tenantId, reapplicationId },
        { singletonKey: reapplicationId },
      );
      return true;
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : typeof error },
        "falha ao enfileirar a reaplicação de taxa",
      );
      return false;
    }
  }

  app.post(
    `/api/settings/fee-reapplications/preview`,
    { preHandler: read },
    async (request, reply) => {
      const parsed = feeReapplicationPreviewInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
      const issue = periodIssue(parsed.data.from, parsed.data.to);
      if (issue) return invalidPeriod(reply, issue);
      const { tenantId, userId } = callerOf(request);
      const preview = await previewFeeReapplication(
        { repo: deps.feeReapply, clock: deps.clock },
        tenantId,
        userId,
        {
          targetKind: parsed.data.targetKind,
          targetId: parsed.data.targetId,
          from: parsed.data.from,
          to: parsed.data.to,
        },
      );
      // Alvo inexistente, de outra empresa ou de outro tipo responde igual (RLS).
      if (preview === null) return reply.code(404).send({ code: "not_found" });
      return feeReapplicationPreviewSchema.parse(preview);
    },
  );

  app.post("/api/settings/fee-reapplications", { preHandler: write }, async (request, reply) => {
    const parsed = feeReapplicationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const body = parsed.data;
    const issue = periodIssue(body.from, body.to);
    if (issue) return invalidPeriod(reply, issue);
    const { tenantId, userId } = callerOf(request);

    const result = await deps.feeReapply.create(tenantId, {
      id: deps.newId(),
      createdBy: userId,
      targetKind: body.targetKind,
      targetId: body.targetId,
      from: body.from,
      to: body.to,
      clientRequestId: body.clientRequestId,
    });
    switch (result.kind) {
      case "unknown_target":
        return reply.code(404).send({ code: "not_found" });
      case "replayed": {
        // Linha ainda `queued`: a API pode ter caído entre o commit e o enqueue. Reenfileira com a
        // mesma singletonKey (o job é idempotente), em vez de devolver uma linha parada.
        if (result.record.status === "queued") {
          const requeued = await enqueue(request, tenantId, result.record.id);
          if (!requeued) return reply.code(503).send({ code: "queue_unavailable" });
        }
        return reply.code(200).send(toItem(result.record));
      }
      case "in_progress":
        return reply.code(409).send({ code: "reapply_in_progress", item: toItem(result.record) });
      case "created":
        break;
    }

    // O job vai DEPOIS do commit (o worker só enxerga a linha já gravada). Se a fila falhar, a
    // linha não pode ficar `queued` para sempre (e travar o alvo): vira `failed`.
    const { record } = result;
    if (!(await enqueue(request, tenantId, record.id))) {
      await deps.feeReapply
        .markFailed(tenantId, record.id, "queue_unavailable")
        .catch((failure: unknown) => {
          request.log.error(
            { errorName: failure instanceof Error ? failure.name : typeof failure },
            "falha ao marcar a reaplicação como falha",
          );
        });
      return reply.code(503).send({ code: "queue_unavailable" });
    }
    return reply.code(202).send(toItem(record));
  });

  app.get("/api/settings/fee-reapplications", { preHandler: read }, async (request, reply) => {
    const query = latestQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId } = callerOf(request);
    const record = await deps.feeReapply.latest(
      tenantId,
      query.data.targetKind,
      query.data.targetId,
    );
    return { item: record === null ? null : toItem(record) };
  });
};
