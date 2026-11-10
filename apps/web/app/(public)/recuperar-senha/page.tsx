import { Suspense } from "react";
import { RecoverForm } from "@/features/auth/recover-form";

export const metadata = { title: "Recuperar senha | Finanças para restaurantes" };

export default function RecoverPasswordPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      <Suspense fallback={<p aria-busy="true">Carregando…</p>}>
        <RecoverForm />
      </Suspense>
    </main>
  );
}
