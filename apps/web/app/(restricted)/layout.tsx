import { type ReactNode, Suspense } from "react";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { requireRestrictedSession } from "@/lib/auth/session";

// Leitura da sessão no servidor a cada requisição (nunca em cache): a API valida o cookie.
async function RestrictedGate({ children }: { children: ReactNode }) {
  const me = await requireRestrictedSession();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="font-semibold">Finanças para restaurantes</span>
        <div className="flex items-center gap-3">
          <span className="truncate text-sm text-muted-foreground">{me.name}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
    </div>
  );
}

export default function RestrictedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="p-4" aria-busy="true">
          <span className="sr-only">Carregando…</span>
        </main>
      }
    >
      <RestrictedGate>{children}</RestrictedGate>
    </Suspense>
  );
}
