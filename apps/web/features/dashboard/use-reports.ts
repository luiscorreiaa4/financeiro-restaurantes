"use client";

import { BREAKDOWN_DIMENSIONS, type BreakdownDimension } from "@app/core/contracts";
import { type QueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import { tenantKey } from "@/lib/query/keys";
import type { ReportsApi } from "./reports-api";
import { type DashboardParams, serializeDashboardParams } from "./url-state";

type TenantCtx = { tenantId: string; unitId: string };
type ReportsContextValue = { ctx: TenantCtx; api: ReportsApi };

const ReportsContext = createContext<ReportsContextValue | null>(null);

/** Entrega aos hooks a empresa e a unidade ativas (chave de query) e o cliente da API. */
export function ReportsProvider({
  ctx,
  api,
  children,
}: {
  ctx: TenantCtx;
  api: ReportsApi;
  children: ReactNode;
}) {
  const { tenantId, unitId } = ctx;
  const value = useMemo(() => ({ ctx: { tenantId, unitId }, api }), [tenantId, unitId, api]);
  return createElement(ReportsContext.Provider, { value }, children);
}

function useReportsContext(): ReportsContextValue {
  const value = useContext(ReportsContext);
  if (value === null)
    throw new Error("useSummary/useMonthly/useBreakdown precisam de um ReportsProvider");
  return value;
}

// Um `useSuspenseQuery` por bloco: cada um suspende e falha sozinho (RF27.Obs3).
// A chave leva o estado inteiro da URL (inclui `unitIds` e `compare`), então nunca mistura blocos.

export function useSummary(p: DashboardParams) {
  const { ctx, api } = useReportsContext();
  return useSuspenseQuery({
    queryKey: tenantKey(ctx, "reports", "summary", serializeDashboardParams(p)),
    queryFn: () => api.summary(p),
  });
}

export function useMonthly(p: DashboardParams) {
  const { ctx, api } = useReportsContext();
  return useSuspenseQuery({
    queryKey: tenantKey(ctx, "reports", "monthly", serializeDashboardParams(p)),
    queryFn: () => api.monthly(p),
  });
}

export function useBreakdown(p: DashboardParams, by: BreakdownDimension) {
  const { ctx, api } = useReportsContext();
  return useSuspenseQuery({
    queryKey: tenantKey(ctx, "reports", "breakdown", by, serializeDashboardParams(p)),
    queryFn: () => api.breakdown(p, by),
  });
}

/**
 * Começa a buscar os gráficos junto com o resumo, para que o estado vazio (que depende do
 * resumo) não faça os blocos esperarem em fila. As chaves são as mesmas dos hooks.
 */
export function prefetchChartBlocks(
  client: QueryClient,
  ctx: TenantCtx,
  api: ReportsApi,
  p: DashboardParams,
): void {
  const state = serializeDashboardParams(p);
  void client.prefetchQuery({
    queryKey: tenantKey(ctx, "reports", "monthly", state),
    queryFn: () => api.monthly(p),
  });
  for (const by of BREAKDOWN_DIMENSIONS) {
    void client.prefetchQuery({
      queryKey: tenantKey(ctx, "reports", "breakdown", by, state),
      queryFn: () => api.breakdown(p, by),
    });
  }
}
