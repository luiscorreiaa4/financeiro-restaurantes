import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Casca dos textos legais públicos. O texto ainda é provisório: o final é dos sócios (F1b).
 * A versão exibida acompanha `LEGAL_VERSIONS` de `@app/core`, gravada no aceite (RF01.R13).
 */
export function LegalPage({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <p role="note" className="rounded-lg border border-dashed bg-muted p-3 text-sm font-medium">
        Texto provisório (rascunho). A versão final será publicada antes do lançamento.
      </p>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">Versão {version}</p>
      </div>
      <div className="flex flex-col gap-4 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold">
        {children}
      </div>
      <Link
        href="/cadastro"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Voltar para o cadastro
      </Link>
    </main>
  );
}
