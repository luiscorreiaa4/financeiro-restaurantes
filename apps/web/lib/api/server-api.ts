import { cookies } from "next/headers";
import { apiUrl, requireCurrentSession } from "@/lib/auth/session";
import { type ApiClient, createApiClient } from "./client";
import { contextHeaderOf } from "./me-contract";

/**
 * Cliente da API para Server Components e prefetch. Repassa todos os cookies da requisição e o
 * `X-Context` do contexto lido em `requireCurrentSession()` (uma só leitura por requisição).
 * Sem cache: dado de tenant nunca entra em cache compartilhado.
 */
export async function serverApi(): Promise<ApiClient> {
  const me = await requireCurrentSession();
  const cookieHeader = (await cookies()).toString();
  const doFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookieHeader);
    return fetch(input, { ...init, headers, cache: "no-store" });
  };
  return createApiClient({
    baseUrl: apiUrl(),
    fetch: doFetch,
    contextHeader: () => contextHeaderOf(me),
  });
}
