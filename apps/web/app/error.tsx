"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-2xl font-semibold">Algo deu errado</h1>
      <p className="text-muted-foreground">Não foi possível carregar esta página.</p>
      <Button onClick={reset}>Tentar de novo</Button>
    </main>
  );
}
