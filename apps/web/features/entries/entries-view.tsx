"use client";

import type { EntryListQuery } from "@app/core/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/features/exports/export-dialog";
import type { ExportsScope } from "@/features/exports/use-exports";
import { BatchBar } from "./batch-bar";
import { EntriesTable } from "./entries-table";
import { EntryCard } from "./entry-card";
import { EntryDrawer } from "./entry-drawer";
import { FiltersBar } from "./filters-bar";
import { TotalsBar } from "./totals-bar";
import { parseFilters, serializeFilters } from "./url-filters";
import { useEntries, useEntryOptions, useEntryTotals } from "./use-entries";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export const EMPTY_MESSAGE =
  "Nenhum lançamento neste período. Que tal mandar o primeiro pelo WhatsApp?";

/**
 * Lista de lançamentos (RF22). O estado mora na URL (filtros, ordenação e o lançamento aberto):
 * recarregar e o botão voltar mantêm a consulta (RF22.Obs1). Lista e totais vêm do servidor; a
 * tela não soma nem reordena.
 */
export function EntriesView({
  today,
  role,
  canSeeTrash = false,
  canCreate = false,
  exportScope,
  canExportFull = false,
}: {
  today: string;
  role: string;
  /** Quem pode restaurar (RF24) ganha o botão da lixeira. */
  canSeeTrash?: boolean;
  /** Quem pode lançar (`entry:create`) e tem conta gravável ganha "Novo lançamento" (RF26, RF37). */
  canCreate?: boolean;
  /** Só quem tem `export:data` recebe o escopo, e com ele o botão "Exportar" (RF29). A conta somente leitura também exporta. */
  exportScope?: ExportsScope;
  /** Só o dono (`export:full`) vê o conteúdo COMPLETO no diálogo (RF29.R3). */
  canExportFull?: boolean;
}) {
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

  // Seleção do lote (RF24.Obs3): só dono e gerente, só na tabela do computador. Ela é da consulta
  // em que foi feita: mudar filtro ou ordem (a chave) a descarta; abrir o drawer não.
  const canBatch = role === "owner" || role === "manager";
  const queryKey = serializeFilters(query);
  const [picked, setPicked] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: queryKey,
    ids: new Set(),
  });
  const selected = picked.key === queryKey ? picked.ids : EMPTY_SELECTION;
  const selectable = items.filter((item) => item.canDelete);
  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setPicked({ key: queryKey, ids: next });
  }
  function toggleAll() {
    const all = selectable.length > 0 && selected.size === selectable.length;
    setPicked({ key: queryKey, ids: all ? new Set() : new Set(selectable.map((item) => item.id)) });
  }

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Lançamentos</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <Link href="/lancamentos/novo" className={buttonVariants({ size: "sm" })}>
              Novo lançamento
            </Link>
          )}
          {canSeeTrash && (
            <Link
              href="/lancamentos/lixeira"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Lixeira
            </Link>
          )}
          {exportScope && (
            <ExportButton scope={exportScope} query={query} canFull={canExportFull} />
          )}
        </div>
      </div>
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
        <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center text-sm text-muted-foreground">
          <p>{EMPTY_MESSAGE}</p>
          {canCreate && (
            <Link href="/lancamentos/novo" className={buttonVariants({ size: "sm" })}>
              Novo lançamento
            </Link>
          )}
        </div>
      ) : (
        <>
          {canBatch && selected.size > 0 && (
            <div className="hidden md:block">
              <BatchBar
                ids={[...selected]}
                onDone={() => setPicked({ key: queryKey, ids: new Set() })}
                onClear={() => setPicked({ key: queryKey, ids: new Set() })}
              />
            </div>
          )}
          <div className="hidden md:block">
            <EntriesTable
              items={items}
              sort={{ sort: query.sort, dir: query.dir }}
              onSort={(next) => go({ ...query, ...next, cursor: undefined })}
              onOpen={open}
              selection={
                canBatch
                  ? { selected, total: selectable.length, onToggle: toggle, onToggleAll: toggleAll }
                  : undefined
              }
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
