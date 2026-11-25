import { type Clock, can, type DomainError, entryScopeFor, type Result } from "@app/core";
import {
  businessDateSchema,
  mergeInputSchema,
  mergePreviewSchema,
  mergeResultSchema,
  SUPPLIER_LIST_STATUSES,
  supplierListSchema,
  supplierPatchSchema,
  supplierSettingsSchema,
} from "@app/core/contracts";
import type { MergeFailure, SuppliersPeriod, SuppliersScope, SuppliersSettingsRepo } from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  decoratePanelRequest,
  type PanelDeps,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
  requireWritable,
} from "../panel/panel-context";

export type SuppliersRoutesDeps = PanelDeps & {
  readonly supplierSettings: SuppliersSettingsRepo;
  readonly clock: Clock;
  /** Teto de lançamentos por mesclagem; o padrão do repositório é 5.000 (RF10). */
  readonly mergeLimit?: number;
};

const idSchema = z.uuid();
const listQuerySchema = z
  .object({
    search: z.string().max(60).optional(),
    status: z.enum(SUPPLIER_LIST_STATUSES).default("all"),
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
  })
  .strict();

const validation = (reply: FastifyReply, field: string, reason: string) =>
  reply.code(422).send({ code: "validation", field, reason });

/** Erro de domínio do fornecedor para a resposta: só `code` (e `field`/`reason`), sem dado. */
function sendDomainError(reply: FastifyReply, error: MergeFailure | DomainError) {
  switch (error.code) {
    case "NameTaken":
      return reply.code(409).send({ code: "name_taken" });
    case "DocumentTaken":
      return reply.code(409).send({ code: "document_taken" });
    case "AlreadyMerged":
      return reply.code(409).send({ code: "already_merged" });
    case "InvalidName":
      return validation(reply, "name", "invalid");
    case "AliasesTooMany":
      return validation(reply, "aliases", "too_many");
    case "AliasTooLong":
      return validation(reply, "aliases", "too_long");
    case "InvalidDocument":
      return validation(reply, "document", "invalid");
    case "AliasesOverflow":
      return reply.code(422).send({ code: "aliases_overflow" });
    case "DocumentConflict":
      return reply.code(422).send({ code: "document_conflict" });
    case "SameSupplier":
      return validation(reply, "target_id", "same_supplier");
    case "MergeTooLarge":
      return reply.code(422).send({ code: "merge_too_large" });
    default:
      throw new Error(`erro de domínio inesperado no fornecedor: ${error.code}`);
  }
}

/** Primeiro e último dia do mês de `today` (padrão do total gasto, RF10). */
function monthOf(today: string): SuppliersPeriod {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = String(m).padStart(2, "0");
  return { from: `${y}-${month}-01`, to: `${y}-${month}-${String(last).padStart(2, "0")}` };
}

/**
 * Fornecedores (F6c, RF10): leitura com `supplier:view`, escrita com `supplier:manage` e conta
 * gravável (RF37). Total gasto e última compra saem do banco no recorte do ator (unidades e
 * folha, RF06.R3); o CPF só sai inteiro para quem exporta dados (RF10.R2). A mesclagem move
 * também o que o ator não vê, mas nunca devolve a contagem total. Erros só com `{ code }`; nome,
 * documento, cookie e `X-Context` nunca vão para o log.
 */
export const suppliersRoutes: FastifyPluginAsync<{ deps: SuppliersRoutesDeps }> = async (
  app,
  { deps },
) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha nos fornecedores");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const read = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("supplier:view"),
  ];
  const write = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("supplier:manage"),
    requireWritable(),
  ];

  /** Tenant, autor e recorte vêm do contexto revalidado, nunca do corpo ou da URL. */
  function callerOf(request: FastifyRequest): {
    tenantId: string;
    userId: string;
    scope: SuppliersScope;
  } {
    if (request.panel == null || request.session == null) {
      throw new Error("requirePanelContext não preencheu o contexto");
    }
    const { actor } = request.panel;
    // O recorte de lançamentos pelas unidades de ACESSO. Sem recorte, não vê nada (falha fechado).
    const entries = entryScopeFor({
      actor,
      userId: request.session.userId,
      activeUnitId: "all",
    });
    const scope: SuppliersScope = {
      unitIds: entries.ok ? entries.value.unitIds : [],
      includeSensitive: entries.ok && entries.value.includeSensitive,
      revealCpf: can(actor, "export:data"),
    };
    return { tenantId: request.panel.tenantId, userId: request.session.userId, scope };
  }

  const idOf = (request: FastifyRequest): string | null => {
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    return parsed.success ? parsed.data : null;
  };

  app.get("/api/settings/suppliers", { preHandler: read }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "invalid_request" });
    const month = monthOf(deps.clock.today());
    const from = query.data.from ?? month.from;
    const to = query.data.to ?? month.to;
    if (from > to) return validation(reply, "to", "before_from");
    const { tenantId, scope } = callerOf(request);
    const items = await deps.supplierSettings.list(
      tenantId,
      {
        status: query.data.status,
        from,
        to,
        ...(query.data.search ? { search: query.data.search } : {}),
      },
      scope,
    );
    return supplierListSchema.parse({ items, from, to });
  });

  app.patch("/api/settings/suppliers/:id", { preHandler: write }, async (request, reply) => {
    const parsed = supplierPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId, scope } = callerOf(request);
    const result = await deps.supplierSettings.update(
      tenantId,
      userId,
      id,
      parsed.data,
      scope,
      monthOf(deps.clock.today()),
    );
    if (result === null) return reply.code(404).send({ code: "not_found" });
    if (!result.ok) return sendDomainError(reply, result.error);
    return supplierSettingsSchema.parse(result.value);
  });

  app.post(
    "/api/settings/suppliers/:id/merge/preview",
    { preHandler: write },
    async (request, reply) => {
      const parsed = mergeInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
      const id = idOf(request);
      if (id === null) return reply.code(404).send({ code: "not_found" });
      const { tenantId, scope } = callerOf(request);
      const result: Result<number, DomainError> | null = await deps.supplierSettings.previewMerge(
        tenantId,
        id,
        parsed.data.targetId,
        scope,
      );
      if (result === null) return reply.code(404).send({ code: "not_found" });
      if (!result.ok) return sendDomainError(reply, result.error);
      return mergePreviewSchema.parse({ visibleEntries: result.value });
    },
  );

  app.post("/api/settings/suppliers/:id/merge", { preHandler: write }, async (request, reply) => {
    const parsed = mergeInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId, scope } = callerOf(request);
    const result = await deps.supplierSettings.merge(
      tenantId,
      userId,
      id,
      parsed.data.targetId,
      scope,
      {
        now: deps.clock.now(),
        period: monthOf(deps.clock.today()),
        ...(deps.mergeLimit !== undefined ? { limit: deps.mergeLimit } : {}),
      },
    );
    if (result === null) return reply.code(404).send({ code: "not_found" });
    if (!result.ok) return sendDomainError(reply, result.error);
    return mergeResultSchema.parse({ ok: true, target: result.value });
  });
};
