import { safeNext } from "@/lib/auth/safe-next";
import { type ApiClient, type ApiError, createApiClient } from "./client";

export const CONTEXT_CHANGED_MESSAGE =
  "A empresa foi trocada em outra aba. Recarregue para continuar.";

export type BrowserNav = {
  assign(url: string): void;
  reload(): void;
  pathname: string;
  search: string;
};

function isContextChanged(e: ApiError): boolean {
  return (
    e.status === 409 &&
    typeof e.body === "object" &&
    e.body !== null &&
    (e.body as { code?: unknown }).code === "context_changed"
  );
}

/**
 * Tratamento global de erro da API no navegador.
 * - 401 (query ou mutação): vai para /login?next=<rota atual, só caminho interno>.
 * - 409 context_changed: em leitura recarrega a página; em mutação não recarrega (o formulário
 *   não se perde) e o erro passa a carregar a mensagem para o usuário.
 */
export function handleBrowserApiError(
  e: ApiError,
  kind: "query" | "mutation",
  nav: BrowserNav,
): void {
  if (e.status === 401) {
    if (nav.pathname.startsWith("/login")) return;
    const next = safeNext(nav.pathname + nav.search);
    nav.assign(`/login?next=${encodeURIComponent(next)}`);
    return;
  }
  if (isContextChanged(e)) {
    if (kind === "query") nav.reload();
    else e.message = CONTEXT_CHANGED_MESSAGE;
  }
}

/** `window.location` como `BrowserNav`, lido na hora do uso. */
export function windowNav(): BrowserNav {
  return {
    assign: (url) => window.location.assign(url),
    reload: () => window.location.reload(),
    get pathname() {
      return window.location.pathname;
    },
    get search() {
      return window.location.search;
    },
  };
}

/**
 * Cliente da API para o navegador: fala com o próprio web (rewrite de /api/*, cookie de primeira
 * parte), envia o `X-Context` e trata 401 e 409 de mutação direta. Erros de query passam pelo
 * `QueryCache` (ver `get-query-client.ts`).
 */
export function browserApi(contextHeader: () => string | null): ApiClient {
  return createApiClient({
    baseUrl: "",
    contextHeader,
    onError: (e) => handleBrowserApiError(e, "mutation", windowNav()),
  });
}
