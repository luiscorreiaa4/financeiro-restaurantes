import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthSession, CheckSession } from "../../modules/auth/check-session";
import { ProfileError, type ProfileService } from "../../modules/profile/profile-service";
import { authError } from "../auth/auth-messages";
import { requireSession } from "../auth/require-session";

export interface ProfileRoutesDeps {
  readonly checkSession: CheckSession;
  readonly service: ProfileService;
}

const nameBody = z.object({ name: z.string().max(1000) });
const passwordBody = z.object({
  currentPassword: z.string().max(256),
  newPassword: z.string().max(256),
});

/** IP e navegador vêm da conexão do servidor, nunca de cabeçalho de proxy nem do corpo. */
const connection = (request: FastifyRequest) => ({
  ip: request.ip,
  userAgent: request.headers["user-agent"],
});

function sessionOf(request: FastifyRequest): AuthSession {
  if (request.session === null) throw new Error("requireSession não preencheu a sessão");
  return request.session;
}

/**
 * Perfil do painel (F1c, RF02): `/api/profile*`, todas com sessão válida e vínculo ativo
 * (RF02.CA07, CA08). Nunca loga corpo, e-mail nem senha (regra 9).
 */
export const profileRoutes: FastifyPluginAsync<{ deps: ProfileRoutesDeps }> = async (
  app,
  { deps },
) => {
  app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha no perfil");
    }
    return reply.code(status).send(authError(status));
  });

  const preHandler = requireSession(deps.checkSession);
  const { service } = deps;

  app.get("/api/profile", { preHandler }, async (request) => service.get(sessionOf(request)));

  app.patch("/api/profile/name", { preHandler }, async (request, reply) => {
    const body = nameBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(authError(400));
    try {
      await service.updateName(sessionOf(request), body.data.name);
    } catch (error) {
      return failure(reply, error);
    }
    return reply.send({ success: true });
  });

  app.post("/api/profile/password", { preHandler }, async (request, reply) => {
    const body = passwordBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(authError(400));
    try {
      await service.changePassword(sessionOf(request), { ...body.data, ...connection(request) });
    } catch (error) {
      return failure(reply, error);
    }
    return reply.send({ success: true });
  });

  app.post("/api/profile/password/link", { preHandler }, async (request, reply) => {
    try {
      await service.requestPasswordLink(sessionOf(request), connection(request));
    } catch (error) {
      return failure(reply, error);
    }
    return reply.send({ success: true });
  });

  app.post("/api/profile/sessions/revoke-others", { preHandler }, async (request, reply) => {
    try {
      await service.revokeOtherSessions(sessionOf(request), connection(request));
    } catch (error) {
      return failure(reply, error);
    }
    return reply.send({ success: true });
  });
};

/** `ProfileError` vira 400 com o código; qualquer outro erro segue para o 500 genérico. */
function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof ProfileError) return reply.code(400).send(authError(400, error.code));
  throw error;
}
