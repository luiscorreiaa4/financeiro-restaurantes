import type { DashboardSummary, Indicator } from "@app/core/contracts";

const NONE: Indicator = { value: null, previous: null, changePermille: null, direction: null };
const ind = (
  value: number | null,
  previous: number | null = null,
  changePermille: number | null = null,
  direction: Indicator["direction"] = null,
): Indicator => ({ value, previous, changePermille, direction });

/** Resposta do dono do seed de referência (valores do plano da F4): usada só em testes. */
export function summaryFixture(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    period: { from: "2026-11-01", to: "2026-11-17" },
    comparison: { kind: "previous_period", period: { from: "2026-10-15", to: "2026-10-31" } },
    isEmpty: false,
    ticketCoveragePermille: 600,
    indicators: {
      grossRevenue: ind(1000000, 900000, 111, "up"),
      deductions: ind(35000, 30000, 167, "up"),
      netRevenue: ind(965000, 870000, 109, "up"),
      operatingExpenses: ind(700000, 650000, 77, "up"),
      result: ind(265000, 220000, 205, "up"),
      investments: ind(320000, 320000, 0, "flat"),
      margin: ind(265, 244, 21, "up"),
      cmvRatio: ind(250, 260, -10, "down"),
      payrollRatio: ind(300, 310, -10, "down"),
      averageTicket: ind(3000, 2900, 34, "up"),
      breakEven: ind(2857143, 2900000, -15, "down"),
    },
    ...overrides,
  };
}

export function withoutPayroll(summary: DashboardSummary): DashboardSummary {
  const { payrollRatio: _omit, ...rest } = summary.indicators;
  return { ...summary, indicators: rest };
}

export { NONE as NO_INDICATOR };
