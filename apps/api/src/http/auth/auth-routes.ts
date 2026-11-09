import type { FastifyError, FastifyPluginAsync } from "fastify";
import type { AuthGateway, CheckSession, SessionBlocked } from "../../modules/auth/check-session";
import { authError } from "./auth-messages";
import { requireSession, toWebHeaders } from "./require-session";

export interface AuthRoutesDeps {
  readonly gateway: AuthGateway;
  readonly checkSession: CheckSession;
  /** Sessão válida de quem perdeu o vínculo ativo (RF02.CA07). */
  readonly sessionBlocked: SessionBlocked;
}

/**
 * Rotas de entrada e saída: não exigem vínculo ativo da sessão atual (um cookie velho de outra
 * pessoa no mesmo navegador não pode impedir o login). As demais (`get-session`,
 * `change-password`, `update-user`, `list-sessions`...) recusam quem perdeu o vínculo.
 */
const OPEN_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-in/email-otp",
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/email-otp/request-password-reset",
  "/api/auth/forget-password/email-otp",
  "/api/auth/email-otp/check-verification-otp",
  "/api/auth/email-otp/reset-password",
  "/api/auth/reset-password",
  "/api/auth/sign-out",
]);

/** Prefixo dos cabeçalhos que só os ganchos do Better Auth usam (ver infra/auth). */
const INTERNAL_HEADER_PREFIX = "x-auth-internal-";

/** Cabeçalhos que não passam adiante: o corpo é reserializado e o IP vem do Fastify. */
const DROPPED_HEADERS = new Set(["content-length", "x-forwarded-for", "connection"]);

/**
 * Forma canônica para comparar com `OPEN_PATHS`: o roteador do Better Auth aceita barra final
 * e barras repetidas; minúsculas para que caixa diferente nunca escape da lista.
 */
export function normalizePath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/").toLowerCase();
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `/api/auth/*` (Better Auth) e `/api/me`. Nunca loga corpo, cookie nem e-mail (regra 9): o
 * serializer de requisição do app só registra método e caminho.
 */
export const authRoutes: FastifyPluginAsync<{ deps: AuthRoutesDeps }> = async (app, { deps }) => {
  app.decorateRequest("session", null);

  // Corpo vazio, JSON malformado e afins: 4xx no formato da API, nunca o texto do Fastify.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha no acesso");
    }
    return reply.code(status).send(authError(status));
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const headers = toWebHeaders(request);
      for (const name of DROPPED_HEADERS) headers.delete(name);
      // Marcas internas dos ganchos do Better Auth nunca vêm do cliente.
      for (const name of [...headers.keys()]) {
        if (name.startsWith(INTERNAL_HEADER_PREFIX)) headers.delete(name);
      }
      // O limite por IP (RF02.R4) lê este cabeçalho: vale o IP que o Fastify resolveu, não o
      // que o cliente mandou. Atrás do proxy de produção, `trustProxy` decide (F8).
      headers.set("x-forwarded-for", request.ip);

      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      if (!OPEN_PATHS.has(normalizePath(url.pathname)) && (await deps.sessionBlocked(headers))) {
        return reply.code(401).send(authError(401));
      }
      const hasBody = request.method === "POST" && request.body !== undefined;
      const response = await deps.gateway.handle(
        new Request(url, {
          method: request.method,
          headers,
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        }),
      );

      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie" && key !== "content-length") reply.header(key, value);
      });
      // Lista, não string única: login manda mais de um cookie (nota da Task 1).
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      const text = await response.text();
      if (response.status >= 400) {
        const body = parseJson(text) as { code?: unknown } | undefined;
        if (response.status >= 500) {
          request.log.error({ status: response.status }, "falha no Better Auth");
        }
        return reply.type("application/json").send(authError(response.status, body?.code));
      }
      return reply.send(text);
    },
  });

  app.get("/api/me", { preHandler: requireSession(deps.checkSession) }, async (request) => {
    const session = request.session;
    if (session === null) throw new Error("requireSession não preencheu a sessão");
    return { userId: session.userId, name: session.name, email: session.email };
  });
};
