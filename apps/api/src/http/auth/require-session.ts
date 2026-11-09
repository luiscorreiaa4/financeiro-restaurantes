import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { AuthSession, CheckSession } from "../../modules/auth/check-session";
import { authError } from "./auth-messages";

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchida por `requireSession`; nas rotas sem ela fica `null`. */
    session: AuthSession | null;
  }
}

/** Cabeçalhos do Fastify no formato Web, para o Better Auth ler o cookie. */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

/**
 * preHandler das rotas do painel: 401 sem sessão válida ou sem vínculo ativo (RF02.CA07, CA08).
 * A autoridade é a API, mesmo que o `proxy.ts` do web seja contornado.
 */
export function requireSession(checkSession: CheckSession): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await checkSession(toWebHeaders(request));
    if (!result.ok) return reply.code(401).send(authError(401));
    if (result.setCookies.length > 0) reply.header("set-cookie", result.setCookies);
    request.session = result.session;
  };
}
