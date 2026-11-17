"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCents } from "@/lib/format";
import { compactAxis } from "./chart-format";
import { toMonthlySeries } from "./chart-mappers";
import { ChartFrame } from "./chart-table";
import type { DashboardParams } from "./url-state";
import { useMonthly } from "./use-reports";

const INITIAL = { width: 320, height: 240 } as const;

const tooltip = (
  <ChartTooltipContent
    formatter={(value, name) => (
      <div className="flex w-full justify-between gap-3">
        <span>{name}</span>
        <span className="font-medium tabular-nums">{formatCents(Number(value))}</span>
      </div>
    )}
  />
);

function Frame({ children }: { children: ReactNode }) {
  return <div className="h-60 w-full min-w-0">{children}</div>;
}

/** Receita × despesa dos 6 meses que terminam no mês de `to` (RF27). */
export function RevenueExpenseChart({ params }: { params: DashboardParams }) {
  const series = toMonthlySeries(useMonthly(params).data);
  const config = {
    revenue: { label: "Receita", color: "var(--chart-2)" },
    expense: { label: "Despesa", color: "var(--chart-3)" },
  } satisfies ChartConfig;
  const title = "Receita × despesa por mês";
  return (
    <ChartFrame
      title={title}
      columns={[
        { header: "Mês" },
        { header: "Receita", numeric: true },
        { header: "Despesa", numeric: true },
      ]}
      rows={series.map((s) => ({
        key: s.month,
        cells: [s.label, formatCents(s.revenue), formatCents(s.expense)],
      }))}
      chart={
        <Frame>
          <ChartContainer
            config={config}
            role="img"
            aria-label={title}
            initialDimension={INITIAL}
            className="h-full w-full"
          >
            <BarChart data={series} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={compactAxis} width={48} tickLine={false} axisLine={false} />
              <ChartTooltip content={tooltip} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={3} />
              <Bar dataKey="expense" fill="var(--color-expense)" radius={3} />
            </BarChart>
          </ChartContainer>
        </Frame>
      }
    />
  );
}

/** Evolução do resultado mês a mês; o resultado negativo aparece abaixo do zero. */
export function ResultChart({ params }: { params: DashboardParams }) {
  const series = toMonthlySeries(useMonthly(params).data);
  const config = { result: { label: "Resultado", color: "var(--chart-2)" } } satisfies ChartConfig;
  const title = "Evolução do resultado";
  return (
    <ChartFrame
      title={title}
      columns={[{ header: "Mês" }, { header: "Resultado", numeric: true }]}
      rows={series.map((s) => ({ key: s.month, cells: [s.label, formatCents(s.result)] }))}
      chart={
        <Frame>
          <ChartContainer
            config={config}
            role="img"
            aria-label={title}
            initialDimension={INITIAL}
            className="h-full w-full"
          >
            <BarChart data={series} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={compactAxis} width={48} tickLine={false} axisLine={false} />
              <ChartTooltip content={tooltip} />
              <Bar dataKey="result" radius={3}>
                {series.map((s) => (
                  <Cell
                    key={s.month}
                    fill={s.result < 0 ? "var(--chart-3)" : "var(--color-result)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </Frame>
      }
    />
  );
}
