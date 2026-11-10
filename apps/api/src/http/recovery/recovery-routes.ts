import type { FastifyError, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  type RecoverPassword,
  RecoveryError,
  type RequestRecoveryLink,
} from "../../modules/recovery/recover-password";
import { authError } from "../auth/auth-messages";

export interface RecoveryRoutesDeps {
  readonly recover: RecoverPassword;
  readonly requestLink: RequestRecoveryLink;
}

const requestBody = z.object({ email: z.string().max(320) });
const resetBody = z.object({
  token: z.string().max(128),
  password: z.string().max(256),
});

// Alfabeto do token do Better Auth (letras e números). Fora disso nem chega ao banco: um byte nulo,
// por exemplo, faria o Postgres recusar o texto e viraria 500. A resposta é a de qualquer link inválido.
const TOKEN_ALPHABET = /^[A-Za-z0-9_-]+$/;

/**
 * `POST /api/recovery/request` e `/reset` (F1c, RF03, DD-27), públicas: o link do e-mail é a
 * prova. Nunca loga corpo, e-mail, token nem senha (regra 9): o serializer do app só registra o
 * caminho. O IP e o user-agent vêm da conexão do servidor, nunca do corpo.
 */
export const recoveryRoutes: FastifyPluginAsync<{ deps: RecoveryRoutesDeps }> = async (
  app,
  { deps },
) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha na recuperação");
    }
    return reply.code(status).send(authError(status));
  });

  // Resposta sempre igual: nada revela se o e-mail existe, tem vínculo ou foi limitado (RF03.R1).
  app.post("/api/recovery/request", async (request, reply) => {
    const body = requestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(authError(400));
    await deps.requestLink({
      email: body.data.email,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return reply.send({ success: true });
  });

  app.post("/api/recovery/reset", async (request, reply) => {
    const body = resetBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(authError(400));
    const token = body.data.token.trim();
    if (!TOKEN_ALPHABET.test(token)) return reply.code(400).send(authError(400, "INVALID_TOKEN"));
    try {
      await deps.recover({
        token,
        password: body.data.password,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
    } catch (error) {
      if (error instanceof RecoveryError) {
        return reply.code(400).send(authError(400, error.code));
      }
      throw error;
    }
    return reply.send({ success: true });
  });
};
