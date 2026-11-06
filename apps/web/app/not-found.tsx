import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-muted-foreground">O endereço não existe ou foi removido.</p>
      <Link href="/" className="underline">
        Voltar ao início
      </Link>
    </main>
  );
}
