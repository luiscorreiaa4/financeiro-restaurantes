"use client";

import { resolvePeriod, type TrashItem, trashQuerySchema } from "@app/core/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBusinessDate, formatCents } from "@/lib/format";
import { NativeSelect } from "./entry-form-fields";
import { formatInstant } from "./field-labels";
import { useEntryOptions, useRestoreEntry, useTrash } from "./use-entries";

export const TRASH_EMPTY_MESSAGE = "Nenhum lançamento excluído neste período.";
const RESTORE_FAILED = "Não foi possível restaurar. O prazo pode ter vencido.";

type TrashFilters = {
  deletedFrom: string;
  deletedTo: string;
  unitIds?: string[];
  deletedBy?: string;
};

/** Do início do mês anterior até hoje: cobre os 30 dias em que a lixeira guarda (RF24.R2). */
function defaultPeriod(today: string): { deletedFrom: string; deletedTo: string } {
  return { deletedFrom: resolvePeriod("previous_month", today).from, deletedTo: today };
}

/** Filtros da lixeira lidos da URL; inválido ou ausente volta ao período padrão. */
export function parseTrashFilters(params: URLSearchParams, today: string): TrashFilters {
  const fallback = defaultPeriod(today);
  const raw: Record<string, string | string[]> = {
    deletedFrom: params.get("deletedFrom") ?? fallback.deletedFrom,
    deletedTo: params.get("deletedTo") ?? fallback.deletedTo,
  };
  const units = params.getAll("unitIds");
  if (units.length > 0) raw.unitIds = units;
  const by = params.get("deletedBy");
  if (by !== null) raw.deletedBy = by;
  const parsed = trashQuerySchema.safeParse(raw);
  if (parsed.success) {
    const { deletedFrom, deletedTo, unitIds, deletedBy } = parsed.data;
    return { deletedFrom, deletedTo, unitIds, deletedBy };
  }
  return fallback;
}

function toSearch(filters: TrashFilters): string {
  const params = new URLSearchParams();
  params.set("deletedFrom", filters.deletedFrom);
  params.set("deletedTo", filters.deletedTo);
  for (const id of filters.unitIds ?? []) params.append("unitIds", id);
  if (filters.deletedBy) params.set("deletedBy", filters.deletedBy);
  return params.toString();
}

function RestoreButton({ item, onRestore }: { item: TrashItem; onRestore(id: string): void }) {
  if (!item.canRestore) return null;
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => onRestore(item.id)}>
      Restaurar
    </Button>
  );
}

/**
 * Lixeira (RF24): lançamentos excluídos nos últimos 30 dias, com quem excluiu, o motivo e o
 * último dia para restaurar. Filtros na URL; tabela no computador e cartões no celular.
 */
export function TrashView({ today }: { today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `search` é o texto de `params`; o objeto muda a cada render.
  const filters = useMemo(() => parseTrashFilters(params, today), [search, today]);

  const options = useEntryOptions();
  const trash = useTrash(filters);
  const restore = useRestoreEntry();
  const [failed, setFailed] = useState(false);
  const items = trash.data?.pages.flatMap((page) => page.items) ?? [];

  function go(next: TrashFilters) {
    router.push(`${pathname}?${toSearch(next)}`);
  }
  async function restoreEntry(id: string) {
    setFailed(false);
    try {
      await restore.mutateAsync(id);
    } catch {
      setFailed(true);
    }
  }

  const members = options.data?.members ?? [];
  const units = options.data?.units ?? [];

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Lixeira</h1>
        <Link href="/lancamentos" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar aos lançamentos
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Os lançamentos excluídos ficam aqui por 30 dias e podem ser restaurados.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="trash-from" className="text-xs font-medium text-muted-foreground">
            Excluídos de
          </label>
          <Input
            id="trash-from"
            type="date"
            value={filters.deletedFrom}
            onChange={(event) =>
              event.target.value && go({ ...filters, deletedFrom: event.target.value })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="trash-to" className="text-xs font-medium text-muted-foreground">
            até
          </label>
          <Input
            id="trash-to"
            type="date"
            value={filters.deletedTo}
            onChange={(event) =>
              event.target.value && go({ ...filters, deletedTo: event.target.value })
            }
          />
        </div>
        {units.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="trash-unit" className="text-xs font-medium text-muted-foreground">
              Unidade
            </label>
            <NativeSelect
              id="trash-unit"
              value={filters.unitIds?.[0] ?? ""}
              onChange={(event) =>
                go({ ...filters, unitIds: event.target.value ? [event.target.value] : undefined })
              }
            >
              <option value="">Todas</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {members.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="trash-by" className="text-xs font-medium text-muted-foreground">
              Excluído por
            </label>
            <NativeSelect
              id="trash-by"
              value={filters.deletedBy ?? ""}
              onChange={(event) => go({ ...filters, deletedBy: event.target.value || undefined })}
            >
              <option value="">Todos</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {RESTORE_FAILED}
        </p>
      )}

      {trash.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Carregando a lixeira…</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : trash.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm">Não foi possível carregar a lixeira.</p>
          <Button variant="outline" onClick={() => void trash.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {TRASH_EMPTY_MESSAGE}
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Lançado por</TableHead>
                  <TableHead>Excluído por</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Restaurável até</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatBusinessDate(item.occurredOn)}</TableCell>
                    <TableCell className="max-w-xs break-words">{item.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(item.amountCents)}
                    </TableCell>
                    <TableCell>{item.category?.name ?? ""}</TableCell>
                    <TableCell>{item.unit.name}</TableCell>
                    <TableCell>{item.createdBy.name}</TableCell>
                    <TableCell>
                      {item.deleted.by?.name ?? "Gestão"}
                      <span className="block text-xs text-muted-foreground">
                        {formatInstant(item.deleted.at)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs break-words">
                      {item.deleted.reason ?? ""}
                    </TableCell>
                    <TableCell>{formatBusinessDate(item.deleted.restorableUntil)}</TableCell>
                    <TableCell>
                      <RestoreButton item={item} onRestore={(id) => void restoreEntry(id)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {items.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{item.description}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatCents(item.amountCents)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatBusinessDate(item.occurredOn)} · {item.unit.name} · {item.createdBy.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.deleted.by
                    ? `Excluído por ${item.deleted.by.name}`
                    : "Excluído pela gestão"}{" "}
                  em {formatInstant(item.deleted.at)}
                </span>
                {item.deleted.reason && (
                  <span className="break-words text-sm">{item.deleted.reason}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  Restaurável até {formatBusinessDate(item.deleted.restorableUntil)}
                </span>
                <div className="pt-1">
                  <RestoreButton item={item} onRestore={(id) => void restoreEntry(id)} />
                </div>
              </li>
            ))}
          </ul>
          {trash.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={trash.isFetchingNextPage}
              onClick={() => void trash.fetchNextPage()}
            >
              {trash.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
