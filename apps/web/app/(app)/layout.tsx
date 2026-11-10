import { type ReactNode, Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { requireCurrentSession } from "@/lib/auth/session";

// Leitura da sessão no servidor a cada requisição (nunca em cache): a API valida o cookie.
async function SessionGate({ children }: { children: ReactNode }) {
  const session = await requireCurrentSession();
  return <AppShell userName={session.name}>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="p-4" aria-busy="true">
          <span className="sr-only">Carregando…</span>
        </main>
      }
    >
      <SessionGate>{children}</SessionGate>
    </Suspense>
  );
}
