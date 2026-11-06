import { isServer, QueryClient } from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    // Com SSR, um staleTime > 0 evita refazer a busca logo após a hidratação.
    defaultOptions: { queries: { staleTime: 60_000 } },
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
