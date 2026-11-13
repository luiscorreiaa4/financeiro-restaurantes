import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { safeNext } from "@/lib/auth/safe-next";
import { currentSession } from "@/lib/auth/session";

// Os dois nomes do cookie do Better Auth (mesmos do proxy.ts).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

/**
 * Telas de acesso (RF02.R9): com sessão válida, manda para o destino seguro. Só consulta a API
 * quando há cookie. Cookie vencido (sessão nula) mostra o formulário: um Server Component não
 * apaga cookie, e redirecionar aqui criaria o laço /login -> / -> /login. Use dentro de <Suspense>.
 */
export async function RedirectIfSignedIn({
  next,
  children,
}: {
  next?: string | string[];
  children: ReactNode;
}) {
  const jar = await cookies();
  if (!SESSION_COOKIES.some((name) => jar.get(name)?.value)) return children;
  const session = await currentSession();
  if (session) redirect(safeNext(next));
  return children;
}
