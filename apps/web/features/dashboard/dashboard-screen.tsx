"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { entriesApi } from "@/features/entries/entries-api";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { tenantKey } from "@/lib/query/keys";
import { BlockBoundary } from "./block-boundary";
import { BreakdownChart, breakdownTitle } from "./breakdown-chart";
import { DashboardFilters } from "./dashboard-filters";
import { EmptyState } from "./empty-state";
import { IndicatorCards } from "./indicator-cards";
import { ResultChart, RevenueExpenseChart } from "./monthly-chart";
import { reportsApi } from "./reports-api";
import { type DashboardParams, parseDashboardParams, serializeDashboardParams } from "./url-state";
import { prefetchChartBlocks, ReportsProvider, useSummary } from "./use-reports";

const noopSubscribe = () => () => {};
/** Falso no servidor e na hidratação, verdadeiro depois: os blocos só buscam dados no navegador. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function Body({ params, whatsappNumber }: { params: DashboardParams; whatsappNumber?: string }) {
  const { data: summary } = useSummary(params);
  if (summary.isEmpty) return <EmptyState whatsappNumber={whatsappNumber} />;
  return (
    <>
      <IndicatorCards summary={summary} />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <BlockBoundary title="Receita × despesa por mês">
          <RevenueExpenseChart params={params} />
        </BlockBoundary>
        <BlockBoundary title="Evolução do resultado">
          <ResultChart params={params} />
        </BlockBoundary>
        <BlockBoundary title={breakdownTitle("category")}>
          <BreakdownChart params={params} by="category" />
        </BlockBoundary>
        <BlockBoundary title={breakdownTitle("sales_channel")}>
          <BreakdownChart params={params} by="sales_channel" />
        </BlockBoundary>
        <BlockBoundary title={breakdownTitle("payment_method")}>
          <BreakdownChart params={params} by="payment_method" />
        </BlockBoundary>
      </div>
    </>
  );
}

function View({
  me,
  today,
  whatsappNumber,
}: {
  me: FullMe;
  today: string;
  whatsappNumber?: string;
}) {
  const isClient = useIsClient();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const text = search.toString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` é o texto de `search`; o objeto muda a cada render.
  const params = useMemo(() => parseDashboardParams(search, today), [text, today]);

  // Unidades para o filtro: mesma fonte da lista (`/api/entries/options`), mesma chave.
  const ctx = { tenantId: me.context.tenantId, unitId: me.context.unitId };
  const client = useQueryClient();
  const reports = useMemo(() => reportsApi(browserApi(() => contextHeaderOf(me))), [me]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `params` muda junto com o texto da URL.
  useEffect(
    () => prefetchChartBlocks(client, ctx, reports, params),
    [client, reports, params, ctx.tenantId, ctx.unitId],
  );
  const options = useQuery({
    queryKey: tenantKey(ctx, "entries", "options"),
    queryFn: () => entriesApi(browserApi(() => contextHeaderOf(me))).options(),
  });

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <DashboardFilters
        params={params}
        today={today}
        units={options.data?.units ?? []}
        onChange={(next) => router.push(`${pathname}?${serializeDashboardParams(next)}`)}
      />
      {isClient ? (
        <BlockBoundary title="Indicadores">
          <Body params={params} whatsappNumber={whatsappNumber} />
        </BlockBoundary>
      ) : (
        // Os dados do tenant vêm da API pelo navegador (com o contexto no cabeçalho): sem consulta no servidor.
        <Skeleton className="h-32 w-full" />
      )}
    </section>
  );
}

/**
 * Dashboard (RF27). O estado mora na URL; cada bloco busca os próprios números no servidor e
 * a tela só formata. `today` vem do servidor, já como data de negócio.
 */
export function DashboardScreen({
  me,
  today,
  whatsappNumber,
}: {
  me: FullMe;
  today: string;
  whatsappNumber?: string;
}) {
  const api = useMemo(() => reportsApi(browserApi(() => contextHeaderOf(me))), [me]);
  return (
    <ReportsProvider ctx={{ tenantId: me.context.tenantId, unitId: me.context.unitId }} api={api}>
      {/* `useSearchParams` exige um limite de Suspense na página. */}
      <Suspense fallback={null}>
        <View me={me} today={today} whatsappNumber={whatsappNumber} />
      </Suspense>
    </ReportsProvider>
  );
}
