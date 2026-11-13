import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type FullMe, type Me, meSchema, type RestrictedMe } from "@/lib/api/me-contract";
import { parseWebEnv } from "@/lib/env";

type SessionDeps = {
  baseUrl: string;
  cookieHeader: string;
  fetch: typeof fetch;
  redirect: (path: string) => never;
};

/**
 * Único lugar que lê a sessão e o contexto no servidor: pergunta à API (`/api/me`) repassando o cookie.
 * Sem cache entre usuários (`no-store`). Qualquer dúvida (sem cookie, 401, resposta torta,
 * API fora do ar) vira `null`: nunca autoriza por engano.
 */
export async function getSession(
  deps: Pick<SessionDeps, "baseUrl" | "cookieHeader" | "fetch">,
): Promise<Me | null> {
  if (!deps.cookieHeader) return null;
  try {
    const response = await deps.fetch(`${deps.baseUrl}/api/me`, {
      headers: { cookie: deps.cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const parsed = meSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function requireSessionOrRedirect(deps: SessionDeps): Promise<Me> {
  const session = await getSession(deps);
  if (!session) return deps.redirect("/login");
  return session;
}

/** Páginas do grupo `(app)`: só acesso completo. Restrito vai a `/acesso-restrito`. */
export async function requireFullSessionOrRedirect(deps: SessionDeps): Promise<FullMe> {
  const session = await requireSessionOrRedirect(deps);
  if (session.access === "restricted") return deps.redirect("/acesso-restrito");
  return session;
}

/** Área restrita: só acesso restrito. Completo vai a `/`. */
export async function requireRestrictedSessionOrRedirect(deps: SessionDeps): Promise<RestrictedMe> {
  const session = await requireSessionOrRedirect(deps);
  if (session.access === "full") return deps.redirect("/");
  return session;
}

export function apiUrl(): string {
  // O Next não lê o .env da raiz: fora de produção a API local é o padrão (como no next.config).
  const fallback =
    process.env.NODE_ENV === "production" ? {} : { API_URL: "http://localhost:4000" };
  return parseWebEnv({ ...fallback, ...process.env }).API_URL;
}

/** Versão para páginas e layouts: lê o cookie da requisição atual. Use dentro de <Suspense>. */
export const currentSession = cache(async (): Promise<Me | null> => {
  const cookieHeader = (await cookies()).toString();
  return getSession({ baseUrl: apiUrl(), cookieHeader, fetch });
});

// `cache()` do React vale por requisição: layout e páginas dividem uma só leitura de /api/me.
/** null → /login; restrito → /acesso-restrito. */
export const requireCurrentSession = cache(async (): Promise<FullMe> => {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.access === "restricted") redirect("/acesso-restrito");
  return session;
});

/** null → /login; completo → /. */
export const requireRestrictedSession = cache(async (): Promise<RestrictedMe> => {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.access === "full") redirect("/");
  return session;
});
