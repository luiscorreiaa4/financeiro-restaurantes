import { computeFee, type DomainError, money, type Result } from "@app/core";
import {
  feePreviewSchema,
  paymentMethodInputSchema,
  paymentMethodPatchSchema,
  paymentMethodSettingsSchema,
  salesChannelInputSchema,
  salesChannelPatchSchema,
  salesChannelSettingsSchema,
} from "@app/core/contracts";
import type { CatalogSettingsRepo } from "@app/db";
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

export type CatalogRoutesDeps = PanelDeps & {
  readonly catalogSettings: CatalogSettingsRepo;
};

const idSchema = z.uuid();
const listQuerySchema = z
  .object({
    type: z.string().min(1).max(40).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();

const validation = (reply: FastifyReply, field: string, reason: string) =>
  reply.code(422).send({ code: "validation", field, reason });

/**
 * Erro de domínio do catálogo para a resposta: só `code` (e `field`/`reason` da validação, que
 * não trazem dado). Nome repetido e canal padrão de unidade são 409; o resto é 422.
 */
function sendDomainError(reply: FastifyReply, error: DomainError) {
  switch (error.code) {
    case "NameTaken":
      return reply.code(409).send({ code: "name_taken" });
    case "ChannelIsUnitDefault":
      return reply.code(409).send({ code: "channel_is_unit_default" });
    case "InvalidName":
      return validation(reply, "name", "invalid");
    case "AliasesTooMany":
      return validation(reply, "aliases", "too_many");
    case "AliasTooLong":
      return validation(reply, "aliases", "too_long");
    case "InvalidFeeRate":
      return validation(reply, "fee_percent_bp", "invalid");
    case "InvalidAmount":
      return validation(reply, "fee_fixed_cents", "invalid");
    case "FeeExceedsAmount":
      return validation(reply, "fee_fixed_cents", "exceeds_amount");
    case "DefaultCardType":
      return validation(reply, "is_default_card", "invalid_type");
    case "DefaultCardInactive":
      return validation(reply, "is_default_card", "inactive");
    case "SystemCatalogReadOnly":
      return validation(reply, "name", "system_read_only");
    default:
      throw new Error(`erro de domínio inesperado no catálogo: ${error.code}`);
  }
}

/**
 * Formas de pagamento, canais de venda e prévia de taxa (F6a, RF08, RF09): leitura com
 * `catalog:view`; escrita com `catalog:manage` e conta gravável (RF37). Erros só com `{ code }`;
 * nome, apelido, cookie e `X-Context` nunca vão para o log (regra 9).
 */
export const catalogRoutes: FastifyPluginAsync<{ deps: CatalogRoutesDeps }> = async (
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
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha no catálogo");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const read = [requirePanelContext(deps), requireTenantRoute(), requirePermission("catalog:view")];
  const write = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("catalog:manage"),
    requireWritable(),
  ];

  /** Tenant e autor vêm do contexto revalidado, nunca do corpo, da URL ou do cabeçalho. */
  function callerOf(request: FastifyRequest): { tenantId: string; userId: string } {
    if (request.panel == null || request.session == null) {
      throw new Error("requirePanelContext não preencheu o contexto");
    }
    return { tenantId: request.panel.tenantId, userId: request.session.userId };
  }

  function respond(
    reply: FastifyReply,
    result: Result<unknown, DomainError> | null,
    successStatus: number,
    present: (value: unknown) => unknown,
  ) {
    if (result === null) return reply.code(404).send({ code: "not_found" });
    if (!result.ok) return sendDomainError(reply, result.error);
    return reply.code(successStatus).send(present(result.value));
  }

  /** Id que não é UUID responde igual a id inexistente ou de outra empresa. */
  const idOf = (request: FastifyRequest): string | null => {
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    return parsed.success ? parsed.data : null;
  };

  const presentPayment = (value: unknown) => paymentMethodSettingsSchema.parse(value);
  const presentChannel = (value: unknown) => salesChannelSettingsSchema.parse(value);

  app.get("/api/settings/payment-methods", { preHandler: read }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId } = callerOf(request);
    const items = await deps.catalogSettings.listPaymentMethods(tenantId, query.data);
    return { items: items.map(presentPayment) };
  });

  app.post("/api/settings/payment-methods", { preHandler: write }, async (request, reply) => {
    const parsed = paymentMethodInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId, userId } = callerOf(request);
    const result = await deps.catalogSettings.createPaymentMethod(tenantId, userId, parsed.data);
    return respond(reply, result, 201, presentPayment);
  });

  app.patch("/api/settings/payment-methods/:id", { preHandler: write }, async (request, reply) => {
    const parsed = paymentMethodPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId } = callerOf(request);
    const result = await deps.catalogSettings.updatePaymentMethod(
      tenantId,
      userId,
      id,
      parsed.data,
    );
    return respond(reply, result, 200, presentPayment);
  });

  app.get("/api/settings/sales-channels", { preHandler: read }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId } = callerOf(request);
    const items = await deps.catalogSettings.listSalesChannels(tenantId, query.data);
    return { items: items.map(presentChannel) };
  });

  app.post("/api/settings/sales-channels", { preHandler: write }, async (request, reply) => {
    const parsed = salesChannelInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId, userId } = callerOf(request);
    const result = await deps.catalogSettings.createSalesChannel(tenantId, userId, parsed.data);
    return respond(reply, result, 201, presentChannel);
  });

  app.patch("/api/settings/sales-channels/:id", { preHandler: write }, async (request, reply) => {
    const parsed = salesChannelPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId } = callerOf(request);
    const result = await deps.catalogSettings.updateSalesChannel(tenantId, userId, id, parsed.data);
    return respond(reply, result, 200, presentChannel);
  });

  /** Prévia sobre R$ 100,00 (RF08): não grava nem lê dado da empresa. */
  app.get("/api/settings/fee-preview", { preHandler: read }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const asInt = (value: unknown): number | null =>
      typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : null;
    const feePercentBp = asInt(query.feePercentBp);
    if (feePercentBp === null) return validation(reply, "fee_percent_bp", "invalid");
    const feeFixedCents = asInt(query.feeFixedCents);
    if (feeFixedCents === null) return validation(reply, "fee_fixed_cents", "invalid");
    const gross = money(10000);
    if (!gross.ok) throw new Error("R$ 100,00 deveria ser um valor válido");
    const fee = computeFee(gross.value, { feePercentBp, feeFixedCents });
    if (!fee.ok) return sendDomainError(reply, fee.error);
    return feePreviewSchema.parse({ grossCents: 10000, ...fee.value });
  });
};
