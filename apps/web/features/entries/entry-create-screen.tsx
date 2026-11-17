"use client";

import { accountAllows } from "@app/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { entriesApi } from "./entries-api";
import { EntryCreateForm } from "./entry-create-form";
import { EntriesProvider, useEntryOptions } from "./use-entries";

function CreateBody({ me, today }: { me: FullMe; today: string }) {
  const router = useRouter();
  const options = useEntryOptions();
  const writable = accountAllows(me.context.accountStatus, me.context.role).write;

  if (!writable) {
    return (
      <p role="alert" className="rounded-lg border p-4 text-sm">
        Conta somente leitura: não é possível lançar.
      </p>
    );
  }
  if (options.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">Carregando o formulário…</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (options.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="text-sm">Não foi possível carregar o formulário.</p>
        <Button variant="outline" onClick={() => void options.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  return (
    <EntryCreateForm
      options={options.data}
      today={today}
      unitId={me.context.unitId}
      onSaved={(saved) => router.push(`/lancamentos?entry=${encodeURIComponent(saved.id)}`)}
    />
  );
}

/** Página de lançamento manual (RF26): liga o formulário à API do navegador e ao contexto ativo. */
export function EntryCreateScreen({ me, today }: { me: FullMe; today: string }) {
  const api = useMemo(() => entriesApi(browserApi(() => contextHeaderOf(me))), [me]);
  return (
    <EntriesProvider ctx={{ tenantId: me.context.tenantId, unitId: me.context.unitId }} api={api}>
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Novo lançamento</h1>
          <Link href="/lancamentos" className="text-sm underline">
            Voltar para lançamentos
          </Link>
        </div>
        <CreateBody me={me} today={today} />
      </section>
    </EntriesProvider>
  );
}
