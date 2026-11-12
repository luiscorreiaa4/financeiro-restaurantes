import type { onRequestHookHandler } from "fastify";

/**
 * Caminhos de escrita que NÃO exigem `Origin` (DD-32 item 3, RNF01.R10): só quem não é
 * navegador e se protege por outro meio. Hoje: o webhook do WhatsApp (assinatura HMAC).
 * Comparação exata, sem query string: acrescentar aqui exige o teste da lista exata.
 */
export const ORIGIN_EXEMPT_PATHS: readonly string[] = ["/webhooks/whatsapp"];

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Origem (esquema, host e porta) de `APP_URL`; barra final ou caminho não mudam o resultado. */
export function appOriginOf(appUrl: string): string {
  return new URL(appUrl).origin;
}

/**
 * Hook `onRequest` global contra CSRF: toda escrita exige `Origin` igual ao do painel.
 * Recusa com 403 `{ code: "origin_forbidden" }`, sem logar o valor recebido.
 */
export function originGuard(opts: {
  appOrigin: string;
  exempt?: readonly string[];
}): onRequestHookHandler {
  const exempt = opts.exempt ?? ORIGIN_EXEMPT_PATHS;
  return async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const path = request.url.split("?")[0] ?? "";
    if (exempt.includes(path)) return;
    if (request.headers.origin === opts.appOrigin) return;
    return reply.code(403).send({ code: "origin_forbidden" });
  };
}
