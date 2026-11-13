import Link from "next/link";
import { Suspense } from "react";
import { RedirectIfSignedIn } from "@/components/redirect-if-signed-in";
import { SignupFlow } from "@/features/signup/signup-flow";

export const metadata = { title: "Criar conta | Finanças para restaurantes" };

export default function SignupPage() {
  return (
    <main className="flex min-h-svh flex-col items-center gap-6 px-4 py-8">
      <div className="flex w-full max-w-md flex-col gap-2">
        <h1 className="text-2xl font-semibold">Criar conta</h1>
        <p className="text-sm text-muted-foreground">
          Primeiro confirmamos seu e-mail com um código. Depois você informa os dados do restaurante
          e já entra no painel.
        </p>
      </div>
      <Suspense fallback={<p aria-busy="true">Carregando…</p>}>
        <RedirectIfSignedIn>
          <SignupFlow />
        </RedirectIfSignedIn>
      </Suspense>
      <p className="text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
