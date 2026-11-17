"use client";

import type { BreakdownDimension } from "@app/core/contracts";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCents, formatPermille } from "@/lib/format";
import { compactAxis } from "./chart-format";
import { toBreakdownSeries } from "./chart-mappers";
import { ChartFrame } from "./chart-table";
import type { DashboardParams } from "./url-state";
import { useBreakdown } from "./use-reports";

const TITLES: Record<BreakdownDimension, string> = {
  category: "Despesas por categoria",
  sales_channel: "Receita por canal de venda",
  payment_method: "Receita por forma de pagamento",
};
const FIRST_COLUMN: Record<BreakdownDimension, string> = {
  category: "Categoria",
  sales_channel: "Canal",
  payment_method: "Forma de pagamento",
};
const config = { amount: { label: "Valor", color: "var(--chart-2)" } } satisfies ChartConfig;
const ROW_HEIGHT = 36;

export function breakdownTitle(by: BreakdownDimension): string {
  return TITLES[by];
}

/** Ranking horizontal de uma quebra (categoria, canal ou forma de pagamento), com tabela. */
export function BreakdownChart({
  params,
  by,
}: {
  params: DashboardParams;
  by: BreakdownDimension;
}) {
  const report = useBreakdown(params, by).data;
  const series = toBreakdownSeries(report);
  const title = TITLES[by];
  return (
    <ChartFrame
      title={title}
      columns={[
        { header: FIRST_COLUMN[by] },
        { header: "Valor", numeric: true },
        { header: "Participação", numeric: true },
      ]}
      rows={series.map((s) => ({
        key: s.key,
        cells: [s.label, formatCents(s.amount), formatPermille(s.share)],
      }))}
      chart={
        series.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Sem valores neste período.</p>
        ) : (
          <ChartContainer
            config={config}
            role="img"
            aria-label={title}
            initialDimension={{ width: 320, height: series.length * ROW_HEIGHT + 32 }}
            className="w-full"
            style={{ height: series.length * ROW_HEIGHT + 32 }}
          >
            <BarChart data={series} layout="vertical" accessibilityLayer>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={compactAxis} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={96} tickLine={false} axisLine={false} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => (
                      <span className="font-medium tabular-nums">{formatCents(Number(value))}</span>
                    )}
                  />
                }
              />
              <Bar dataKey="amount" fill="var(--color-amount)" radius={3} />
            </BarChart>
          </ChartContainer>
        )
      }
    />
  );
}
