"use client";

import type { EntryListQuery } from "@app/core/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EntriesTable } from "./entries-table";
import { EntryCard } from "./entry-card";
import { EntryDrawer } from "./entry-drawer";
import { FiltersBar } from "./filters-bar";
import { TotalsBar } from "./totals-bar";
import { parseFilters, serializeFilters } from "./url-filters";
import { useEntries, useEntryOptions, useEntryTotals } from "./use-entries";

export const EMPTY_MESSAGE =
  "Nenhum lançamento neste período. Que tal mandar o primeiro pelo WhatsApp?";

/**
 * Lista de lançamentos (RF22). O estado mora na URL (filtros, ordenação e o lançamento aberto):
 * recarregar e o botão voltar mantêm a consulta (RF22.Obs1). Lista e totais vêm do servidor; a
 * tela não soma nem reordena.
 */
export function EntriesView({ today, role }: { today: string; role: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `search` é o texto de `params`; o objeto muda a cada render.
  const query = useMemo(() => parseFilters(params, today), [search, today]);

  const entries = useEntries(query);
  const totals = useEntryTotals(query);
  const options = useEntryOptions();
  const items = entries.data?.pages.flatMap((page) => page.items) ?? [];

  function go(next: EntryListQuery) {
    router.push(`${pathname}?${serializeFilters(next)}`);
  }
  // Abrir empilha no histórico (o botão voltar fecha); fechar pelo botão troca a entrada atual.
  function close() {
    router.replace(`${pathname}?${serializeFilters(query)}`);
  }
  function open(id: string) {
    router.push(`${pathname}?${serializeFilters(query)}&entry=${encodeURIComponent(id)}`);
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Lançamentos</h1>
      <FiltersBar
        // Refaz o campo de busca quando a URL muda por fora (botão voltar, "Limpar filtros").
        key={query.q ?? ""}
        query={query}
        options={options.data}
        showCreatedBy={role !== "staff"}
        today={today}
        onChange={go}
      />
      <TotalsBar totals={totals.data} failed={totals.isError} />

      {entries.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Carregando lançamentos…</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : entries.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm">Não foi possível carregar os lançamentos.</p>
          <Button variant="outline" onClick={() => void entries.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {EMPTY_MESSAGE}
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <EntriesTable
              items={items}
              sort={{ sort: query.sort, dir: query.dir }}
              onSort={(next) => go({ ...query, ...next, cursor: undefined })}
              onOpen={open}
            />
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {items.map((item) => (
              <EntryCard key={item.id} item={item} onOpen={open} />
            ))}
          </ul>
          {entries.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={entries.isFetchingNextPage}
              onClick={() => void entries.fetchNextPage()}
            >
              {entries.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </Button>
          )}
        </>
      )}
      <EntryDrawer entryId={params.get("entry")} onClose={close} />
    </section>
  );
}
