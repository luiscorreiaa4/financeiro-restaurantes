import type { ReactNode } from "react";
import type { Me } from "@/lib/api/me-contract";

/**
 * Mostra a página só a quem tem a ação (`allowedActions` do /api/me). É conforto: a autorização
 * real é da API (apps/web/CLAUDE.md, regra 4).
 */
export function RequireAction({
  me,
  action,
  children,
}: {
  me: Me;
  action: string;
  children: ReactNode;
}) {
  if (!me.context.allowedActions.includes(action)) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Você não tem acesso a esta página</h1>
        <p className="text-sm text-muted-foreground">
          Peça ao dono da empresa para liberar este acesso.
        </p>
      </section>
    );
  }
  return <>{children}</>;
}
