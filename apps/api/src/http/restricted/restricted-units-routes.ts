import { accountAllows } from "@app/core";
import { restrictedUnitsSchema } from "@app/core/contracts";
import type { OwnedInactiveUnit, OwnedUnitsStore, UnitSettingsRepo } from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CheckEntry } from "../../modules/auth/check-session";
import { authError } from "../auth/auth-messages";
import { toWebHeaders } from "../auth/require-session";

export type RestrictedUnitsDeps = {
  /** Aceita sessão completa e restrita (DD-33); só confere a sessão, sem `fr_ctx`. */
  readonly checkEntry: CheckEntry;
  readonly ownedUnits: OwnedUnitsStore;
  readonly unitSettings: UnitSettingsRepo;
};

const idSchema = z.uuid();

/**
 * Reativação de unidade no acesso restrito (F6a, DD-33): o dono sem unidade ativa escolhe uma
 * unidade inativa para voltar ao painel. Não usa `requirePanelContext` (a sessão restrita não
 * tem contexto): o tenant sai sempre da própria unidade, lida pelo `app_auth` junto da conferência
 * de dono ativo, nunca do corpo, da URL ou de cabeçalho. A gravação é pelo `app`, em `withTenant`.
 * Tudo que não é elegível responde a mesma 404, sem revelar o motivo. Sem dado pessoal em log.
 */
export const restrictedUnitsRoutes: FastifyPluginAsync<{ deps: RestrictedUnitsDeps }> = async (
  app,
  { deps },
) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(
        { errorName: error.name, errorCode: error.code },
        "falha nas unidades do acesso restrito",
      );
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send(authError(status));
  });

  /** Sessão válida (completa ou restrita); `null` já respondeu 401. */
  async function userOf(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const entry = await deps.checkEntry(toWebHeaders(request));
    if (!entry.ok) {
      reply.code(401).send(authError(401));
      return null;
    }
    if (entry.setCookies.length > 0) reply.header("set-cookie", entry.setCookies);
    return entry.session.userId;
  }

  /** Reativar é escrita: conta que não grava (RF37) não oferece a unidade. */
  async function eligible(userId: string): Promise<OwnedInactiveUnit[]> {
    const all = await deps.ownedUnits.ownedInactiveUnits(userId);
    return all.filter((u) => accountAllows(u.accountStatus, "owner").write);
  }

  app.get("/api/restricted/units", async (request, reply) => {
    const userId = await userOf(request, reply);
    if (userId === null) return reply;
    const items = await eligible(userId);
    const names = new Map<string, string>();
    for (const tenantId of new Set(items.map((u) => u.tenantId))) {
      for (const unit of await deps.unitSettings.list(tenantId)) names.set(unit.id, unit.name);
    }
    return restrictedUnitsSchema.parse({
      units: items.flatMap((u) => {
        const name = names.get(u.id);
        return name === undefined ? [] : [{ id: u.id, name, tenantName: u.tenantName }];
      }),
    });
  });

  app.post("/api/restricted/units/:id/reactivate", async (request, reply) => {
    const userId = await userOf(request, reply);
    if (userId === null) return reply;
    const notFound = () => reply.code(404).send({ code: "not_found" });
    const id = idSchema.safeParse((request.params as { id?: unknown }).id);
    if (!id.success) return notFound();
    const target = (await eligible(userId)).find((u) => u.id === id.data);
    if (target === undefined) return notFound();
    const result = await deps.unitSettings.reactivate(target.tenantId, userId, target.id);
    if (result === null || !result.ok) return notFound();
    return reply.code(204).send();
  });
};
