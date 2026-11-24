import type { DomainError, Result } from "@app/core";
import { unitInputSchema, unitPatchSchema, unitSettingsSchema } from "@app/core/contracts";
import type { UnitSettingsRepo } from "@app/db";
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

export type UnitsRoutesDeps = PanelDeps & {
  readonly unitSettings: UnitSettingsRepo;
};

const idSchema = z.uuid();

/**
 * Erro de domínio da unidade para a resposta: só `code` (e `field`/`reason` da validação, que
 * não trazem dado). Nome ou apelido repetido é 409; o resto da validação é 422.
 */
function sendDomainError(reply: FastifyReply, error: DomainError) {
  switch (error.code) {
    case "InvalidUnit":
      if (error.reason === "duplicate" && (error.field === "name" || error.field === "aliases")) {
        return reply.code(409).send({ code: "name_taken" });
      }
      return reply.code(422).send({ code: "validation", field: error.field, reason: error.reason });
    case "UnknownReference":
      return reply.code(422).send({ code: "unknown_reference" });
    case "LastActiveUnit":
      return reply.code(409).send({ code: "last_active_unit" });
    default:
      throw new Error(`erro de domínio inesperado nas unidades: ${error.code}`);
  }
}

/**
 * Unidades da empresa (F6a, RF04): leitura com `catalog:view`; escrita com `catalog:manage` e
 * conta gravável (RF04.CA05, RF37). Erros só com `{ code }`; nome, apelido, CNPJ, cookie e
 * `X-Context` nunca vão para o log (regra 9).
 */
export const unitsRoutes: FastifyPluginAsync<{ deps: UnitsRoutesDeps }> = async (app, { deps }) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      // Só o tipo do erro: a mensagem do driver traz SQL e parâmetros.
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha nas unidades");
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

  /** Último filtro da saída: nada além do que o contrato declara. */
  const present = (unit: unknown) => unitSettingsSchema.parse(unit);

  function respond(
    reply: FastifyReply,
    result: Result<unknown, DomainError> | null,
    successStatus: number,
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

  app.get("/api/settings/units", { preHandler: read }, async (request) => {
    const { tenantId } = callerOf(request);
    const items = await deps.unitSettings.list(tenantId);
    return { items: items.map(present) };
  });

  app.post("/api/settings/units", { preHandler: write }, async (request, reply) => {
    const parsed = unitInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId, userId } = callerOf(request);
    return respond(reply, await deps.unitSettings.create(tenantId, userId, parsed.data), 201);
  });

  app.patch("/api/settings/units/:id", { preHandler: write }, async (request, reply) => {
    const parsed = unitPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId } = callerOf(request);
    return respond(reply, await deps.unitSettings.update(tenantId, userId, id, parsed.data), 200);
  });

  app.post("/api/settings/units/:id/deactivate", { preHandler: write }, async (request, reply) => {
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId } = callerOf(request);
    return respond(reply, await deps.unitSettings.deactivate(tenantId, userId, id), 200);
  });

  app.post("/api/settings/units/:id/reactivate", { preHandler: write }, async (request, reply) => {
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId } = callerOf(request);
    return respond(reply, await deps.unitSettings.reactivate(tenantId, userId, id), 200);
  });
};
