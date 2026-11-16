import { type ReactNode, Suspense } from "react";
import { RequireAction } from "@/components/require-action";
import type { FullMe } from "@/lib/api/me-contract";
import { requireCurrentSession } from "@/lib/auth/session";

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

async function Guarded({
  action,
  children,
}: {
  action: string;
  children: (me: FullMe) => ReactNode;
}) {
  const me = await requireCurrentSession();
  return (
    <RequireAction me={me} action={action}>
      {children(me)}
    </RequireAction>
  );
}

/**
 * Lê a sessão e exige a ação, dentro de uma fronteira `<Suspense>` da própria página. Uma
 * fronteira no layout não vale na navegação do cliente (o layout já está montado e só a página
 * troca), então a página que lê a sessão precisa da sua: sem ela o Next acusa "uncached data
 * during a navigation" e a troca de rota bloqueia. A sessão vem de `cache()` por requisição,
 * dividida com o layout. A autorização real é da API (apps/web/CLAUDE.md, regra 4).
 */
export function PageGuard({
  action,
  children,
}: {
  action: string;
  children: (me: FullMe) => ReactNode;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guarded action={action}>{children}</Guarded>
    </Suspense>
  );
}
