import type { BreakdownReport, MonthlyReport } from "@app/core/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { type ReactNode, Suspense } from "react";
import type { ReportsApi } from "./reports-api";
import type { DashboardParams } from "./url-state";
import { ReportsProvider } from "./use-reports";

export const PARAMS: DashboardParams = {
  from: "2026-11-01",
  to: "2026-11-17",
  unitIds: [],
  compare: "previous_period",
};

export const MONTHLY: MonthlyReport = {
  months: ["06", "07", "08", "09", "10", "11"].map((m, i) => ({
    month: `2026-${m}`,
    revenueCents: i === 5 ? 1000000 : 0,
    expenseCents: i === 5 ? 735000 : 0,
    resultCents: i === 5 ? 265000 : 0,
  })),
};

export function renderWithReports(ui: ReactNode, api: Partial<ReportsApi>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportsProvider ctx={{ tenantId: "t", unitId: "all" }} api={api as ReportsApi}>
        <Suspense fallback={<p>carregando</p>}>{ui}</Suspense>
      </ReportsProvider>
    </QueryClientProvider>,
  );
}

export function breakdown(
  by: BreakdownReport["by"],
  items: BreakdownReport["items"],
): BreakdownReport {
  return { by, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0), items };
}
