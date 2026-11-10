import { isServer, MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { handleBrowserApiError, windowNav } from "@/lib/api/browser-client";
import { ApiError } from "@/lib/api/client";

function makeQueryClient(): QueryClient {
  // Erro 4xx (401, 403, 409) não melhora refazendo: segue direto para o tratamento global.
  const retry = (count: number, error: Error) =>
    !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 3;
  // Com SSR, um staleTime > 0 evita refazer a busca logo após a hidratação.
  const defaultOptions = { queries: { staleTime: 60_000, retry } };
  if (isServer) return new QueryClient({ defaultOptions });
  // No navegador, 401 leva ao login e 409 de outra aba recarrega (ver `handleBrowserApiError`).
  return new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError) handleBrowserApiError(error, "query", windowNav());
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof ApiError) handleBrowserApiError(error, "mutation", windowNav());
      },
    }),
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * No servidor, um QueryClient novo por chamada (nunca compartilhar dado entre requisições
 * de tenants diferentes). No navegador, um só durante a vida da página.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
