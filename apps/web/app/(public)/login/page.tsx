import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata = { title: "Entrar | Finanças para restaurantes" };

async function LoginContent({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <Suspense fallback={<p aria-busy="true">Carregando…</p>}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
