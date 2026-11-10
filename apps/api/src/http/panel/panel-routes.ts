import { allowedActions, formatContextValue, startUnitOf, validateContextChoice } from "@app/core";
import { createTenantUnitsReader, withTenant } from "@app/db";
import type { FastifyError, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authError } from "../auth/auth-messages";
import {
  contextCookieHeader,
  decoratePanelRequest,
  type PanelDeps,
  type PanelRequestContext,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
} from "./panel-context";

const contextBody = z.object({
  tenantId: z.guid(),
  unitId: z.union([z.literal("all"), z.guid()]),
});

function panelOf(panel: PanelRequestContext | null): PanelRequestContext {
  if (panel === null) throw new Error("requirePanelContext não preencheu o contexto");
  return panel;
}

/**
 * Contexto do painel (F2): `GET /api/me`, `POST /api/context` e `GET /api/units`. Nunca loga o
 * cookie de contexto, o e-mail nem o nome (regra 9); dado de tenant só dentro de `withTenant`.
 */
export const panelRoutes: FastifyPluginAsync<{ deps: PanelDeps }> = async (app, { deps }) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha no painel");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send(authError(status));
  });

  const unitsReader = createTenantUnitsReader();
  const preHandler = requirePanelContext(deps);

  app.get("/api/me", { preHandler }, async (request) => {
    const session = request.session;
    if (session === null) throw new Error("requirePanelContext não preencheu a sessão");
    const panel = panelOf(request.panel);
    const current = panel.companies.find((c) => c.tenantId === panel.tenantId);
    const actor = panel.actor;
    return {
      userId: session.userId,
      name: session.name,
      email: session.email,
      companies: panel.companies.map((c) => ({
        tenantId: c.tenantId,
        name: c.tenantName,
        role: c.role,
        accountStatus: c.accountStatus,
        startUnitId: startUnitOf(c),
      })),
      context: {
        tenantId: panel.tenantId,
        unitId: panel.unitId,
        role: actor.role,
        permissions: [...actor.permissions],
        allUnits: actor.units === "all",
        unitIds: actor.units === "all" ? [...(current?.unitIds ?? [])] : [...actor.units],
        accountStatus: panel.accountStatus,
        allowedActions: allowedActions(actor),
      },
      contextSource: panel.source,
    };
  });

  app.post("/api/context", { preHandler }, async (request, reply) => {
    const body = contextBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(authError(400));
    const panel = panelOf(request.panel);
    const chosen = validateContextChoice(panel.companies, body.data);
    if (chosen === null) return reply.code(403).send({ code: "context_invalid" });
    reply.header("set-cookie", [
      ...asList(reply.getHeader("set-cookie")),
      contextCookieHeader(formatContextValue(chosen), deps.secure),
    ]);
    return reply.code(204).send();
  });

  app.get(
    "/api/units",
    { preHandler: [preHandler, requireTenantRoute(), requirePermission("panel:access")] },
    async (request) => {
      const panel = panelOf(request.panel);
      const all = await withTenant(deps.appDb, panel.tenantId, (tx) =>
        unitsReader.listActiveUnits(tx),
      );
      const allowed = panel.actor.units;
      return { units: allowed === "all" ? all : all.filter((u) => allowed.includes(u.id)) };
    },
  );
};

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? [value] : [];
}
