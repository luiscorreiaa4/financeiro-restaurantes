"use client";

import type { EntryListQuery } from "@app/core/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import { tenantKey } from "@/lib/query/keys";
import type { EntriesApi } from "./entries-api";
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
