import {
  type BreakdownDimension,
  type BreakdownReport,
  breakdownReportSchema,
  type DashboardSummary,
  dashboardSummarySchema,
  type MonthlyReport,
  monthlyReportSchema,
} from "@app/core/contracts";
import type { ApiClient } from "@/lib/api/client";
import type { DashboardParams } from "./url-state";

export type ReportsApi = {
  /** Indicadores do período e da comparação, calculados no servidor (RF27): a tela não soma. */
  summary(p: DashboardParams): Promise<DashboardSummary>;
  /** Série dos 6 meses que terminam no mês de `p.to`. */
  monthly(p: DashboardParams): Promise<MonthlyReport>;
  breakdown(p: DashboardParams, by: BreakdownDimension): Promise<BreakdownReport>;
};

function query(
  p: DashboardParams,
  fields: readonly ("from" | "to" | "compare")[],
): URLSearchParams {
  const params = new URLSearchParams();
  for (const field of fields) params.set(field, p[field]);
  for (const id of p.unitIds) params.append("unitIds", id);
  return params;
}

/** Rotas `/api/reports/*`. Toda resposta é validada contra o contrato `.strict()`. */
export function reportsApi(client: ApiClient): ReportsApi {
  return {
    summary: (p) =>
      client.get(
        `/api/reports/summary?${query(p, ["from", "to", "compare"])}`,
        dashboardSummarySchema,
      ),
    monthly: (p) => client.get(`/api/reports/monthly?${query(p, ["to"])}`, monthlyReportSchema),
    breakdown: (p, by) => {
      const params = query(p, ["from", "to"]);
      params.set("by", by);
      return client.get(`/api/reports/breakdown?${params}`, breakdownReportSchema);
    },
  };
}
