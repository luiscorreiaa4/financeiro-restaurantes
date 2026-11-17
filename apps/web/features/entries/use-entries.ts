"use client";

import type {
  EntryCreateBody,
  EntryDetail,
  EntryListQuery,
  EntryUpdateBodyInput,
} from "@app/core/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import { tenantKey } from "@/lib/query/keys";
import type { EntriesApi, TrashQueryInput } from "./entries-api";
import { serializeFilters } from "./url-filters";

type TenantCtx = { tenantId: string; unitId: string };
type EntriesContextValue = { ctx: TenantCtx; api: EntriesApi };

const EntriesContext = createContext<EntriesContextValue | null>(null);

/** Entrega aos hooks a empresa e a unidade ativas (para a chave de query) e o cliente da API. */
export function EntriesProvider({
  ctx,
  api,
  children,
}: {
  ctx: TenantCtx;
  api: EntriesApi;
  children: ReactNode;
}) {
  const { tenantId, unitId } = ctx;
  const value = useMemo(() => ({ ctx: { tenantId, unitId }, api }), [tenantId, unitId, api]);
  return createElement(EntriesContext.Provider, { value }, children);
}

function useEntriesContext(): EntriesContextValue {
  const value = useContext(EntriesContext);
  if (value === null) throw new Error("useEntries* precisa de um EntriesProvider acima");
  return value;
}

/** Lista paginada por cursor; "Carregar mais" chama `fetchNextPage` (RF22.Obs3). */
export function useEntries(query: EntryListQuery) {
  const { ctx, api } = useEntriesContext();
  const filters = serializeFilters(query);
  return useInfiniteQuery({
    queryKey: tenantKey(ctx, "entries", "list", filters),
    queryFn: ({ pageParam }) => api.list({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Totais da consulta inteira, vindos do servidor: a tela nunca soma (RF22.Obs2). */
export function useEntryTotals(query: EntryListQuery) {
  const { ctx, api } = useEntriesContext();
  const filters = serializeFilters(query);
  return useQuery({
    queryKey: tenantKey(ctx, "entries", "totals", filters),
    queryFn: () => api.totals(query),
  });
}

export function useEntryOptions() {
  const { ctx, api } = useEntriesContext();
  return useQuery({
    queryKey: tenantKey(ctx, "entries", "options"),
    queryFn: () => api.options(),
  });
}

/** Detalhe com o histórico; `null` = nenhum lançamento aberto, não busca. */
export function useEntryDetail(id: string | null) {
  const { ctx, api } = useEntriesContext();
  return useQuery({
    queryKey: tenantKey(ctx, "entries", "detail", id),
    queryFn: () => api.detail(id as string),
    enabled: id !== null,
  });
}

/** Origem do lançamento; só busca quando a aba Origem pede (`enabled`). */
export function useEntrySource(id: string | null, enabled = true) {
  const { ctx, api } = useEntriesContext();
  return useQuery({
    queryKey: tenantKey(ctx, "entries", "source", id),
    queryFn: () => api.source(id as string),
    enabled: enabled && id !== null,
  });
}

/** Lixeira paginada por cursor (RF24). */
export function useTrash(query: Omit<TrashQueryInput, "cursor">) {
  const { ctx, api } = useEntriesContext();
  const key = JSON.stringify(query);
  return useInfiniteQuery({
    queryKey: tenantKey(ctx, "entries", "trash", key),
    queryFn: ({ pageParam }) => api.trash({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Mutação que, ao terminar, invalida toda consulta de lançamentos da empresa e unidade ativas. */
function useEntriesMutation<TVars, TData>(run: (api: EntriesApi, vars: TVars) => Promise<TData>) {
  const { ctx, api } = useEntriesContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => run(api, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(ctx, "entries") }),
  });
}

export function useCreateEntry() {
  return useEntriesMutation((api, body: EntryCreateBody) => api.create(body));
}

export function useUpdateEntry() {
  return useEntriesMutation((api, v: { id: string; body: EntryUpdateBodyInput }) =>
    api.update(v.id, v.body),
  );
}

export function useRemoveEntry() {
  return useEntriesMutation((api, v: { id: string; reason?: string }) =>
    api.remove(v.id, v.reason),
  );
}

export function useRestoreEntry() {
  return useEntriesMutation((api, id: string) => api.restore(id));
}

/** Quantidade e soma do servidor para a confirmação do lote; não altera nada, não invalida. */
export function useBatchPreview() {
  const { api } = useEntriesContext();
  return useMutation({ mutationFn: (ids: readonly string[]) => api.batchPreview(ids) });
}

export function useBatchDelete() {
  return useEntriesMutation((api, v: { ids: readonly string[]; reason?: string }) =>
    api.batchDelete(v.ids, v.reason),
  );
}

/** Troca no cache o detalhe do lançamento (usado ao "Recarregar" depois de um conflito de edição). */
export function useSetEntryDetail() {
  const { ctx } = useEntriesContext();
  const queryClient = useQueryClient();
  return (detail: EntryDetail) =>
    queryClient.setQueryData(tenantKey(ctx, "entries", "detail", detail.id), detail);
}
