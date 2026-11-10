import type { FastifyError, FastifyPluginAsync } from "fastify";
import type { AuthGateway, CheckSession, SessionBlocked } from "../../modules/auth/check-session";
import { expiredContextCookie } from "../panel/panel-context";
import { authError } from "./auth-messages";
import { toWebHeaders } from "./require-session";

export interface AuthRoutesDeps {
  readonly gateway: AuthGateway;
  readonly checkSession: CheckSession;
  /** Sessão válida de quem perdeu o vínculo ativo (RF02.CA07). */
  readonly sessionBlocked: SessionBlocked;
  /** Cookie `__Secure-` e atributo `Secure` (fora de development); define qual `fr_ctx` expirar. */
  readonly secure: boolean;
}

/**
 * Lista fechada de rotas do Better Auth que o painel pode chamar (comparação exata, após
 * `normalizePath`). Qualquer outra em `/api/auth/*` responde 404: perfil, senha e sessões passam
 * por rotas próprias da API. As abertas aqui não exigem vínculo ativo da sessão atual (um cookie
 * velho de outra pessoa no mesmo navegador não pode impedir o login).
 */
const ALLOWED_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-in/email-otp",
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/sign-out",
]);

/** Entrar (2xx) e sair (qualquer status) apagam o cookie de contexto do painel (`fr_ctx`). */
const SIGN_OUT = "/api/auth/sign-out";
const EXPIRES_CONTEXT = new Set(["/api/auth/sign-in/email", "/api/auth/sign-in/email-otp"]);

/** Prefixo dos cabeçalhos que só os ganchos do Better Auth usam (ver infra/auth). */
const INTERNAL_HEADER_PREFIX = "x-auth-internal-";

/** Cabeçalhos que não passam adiante: o corpo é reserializado e o IP vem do Fastify. */
const DROPPED_HEADERS = new Set(["content-length", "x-forwarded-for", "connection"]);

/**
 * Forma canônica para comparar com `ALLOWED_PATHS`: o roteador do Better Auth aceita barra final
 * e barras repetidas; minúsculas para que caixa diferente nunca escape da lista.
 */
export function normalizePath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/").toLowerCase();
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

/**
 * Login por código: código vencido e tentativas esgotadas só acontecem para e-mail com conta;
 * viram o mesmo `INVALID_OTP` (400) do código errado para não revelar quem é cliente
 * (RF02.R1, DD-30).
 */
export function unifyOtpFailure(
  path: string,
  status: number,
  code: unknown,
): { status: number; code: unknown } {
  const isOtpSignIn = path === "/api/auth/sign-in/email-otp";
  if (isOtpSignIn && (code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS")) {
    return { status: 400, code: "INVALID_OTP" };
  }
  return { status, code };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `/api/auth/*` (Better Auth); `/api/me` mora em `panel-routes.ts`. Nunca loga corpo, cookie nem e-mail (regra 9): o
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
      if (!ALLOWED_PATHS.has(normalizePath(url.pathname))) {
        return reply.code(404).send(authError(404));
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
      // Entrar e sair apagam o contexto lembrado: o próximo login nunca herda a empresa de
      // outra pessoa (chamada 5 da F2).
      const path = normalizePath(url.pathname);
      // Sair apaga em qualquer status (sessão já vencida também); entrar só quando deu certo.
      if (path === SIGN_OUT || (response.status < 300 && EXPIRES_CONTEXT.has(path))) {
        cookies.push(expiredContextCookie(deps.secure));
      }
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      const text = await response.text();
      if (response.status >= 400) {
        const body = parseJson(text) as { code?: unknown } | undefined;
        if (response.status >= 500) {
          request.log.error({ status: response.status }, "falha no Better Auth");
        }
        const failure = unifyOtpFailure(normalizePath(url.pathname), response.status, body?.code);
        reply.code(failure.status);
        return reply.type("application/json").send(authError(failure.status, failure.code));
      }
      return reply.send(text);
    },
  });
};
