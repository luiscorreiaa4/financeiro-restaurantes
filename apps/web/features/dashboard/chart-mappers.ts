import type { BreakdownReport, MonthlyReport } from "@app/core/contracts";

const MONTH_LABELS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

/** "2026-11" vira "nov/26". Só rotula: o mês vem pronto do servidor. */
function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTH_LABELS[index] ?? month.slice(5, 7)}/${month.slice(2, 4)}`;
}

/** Os mapeadores só copiam e rotulam: nenhuma conta de dinheiro ou percentual (RF27.Obs1). */
export function toMonthlySeries(report: MonthlyReport): {
  month: string;
  label: string;
  revenue: number;
  expense: number;
  result: number;
}[] {
  return report.months.map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    revenue: m.revenueCents,
    expense: m.expenseCents,
    result: m.resultCents,
  }));
}

export function toBreakdownSeries(report: BreakdownReport): {
  key: string;
  label: string;
  amount: number;
  share: number | null;
}[] {
  return report.items.map((item) => ({
    key: item.key,
    label: item.label,
    amount: item.amountCents,
    share: item.sharePermille,
  }));
}
