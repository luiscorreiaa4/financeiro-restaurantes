import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { reportsApi } from "./reports-api";
import type { DashboardParams } from "./url-state";

const UNIT = "0193a1b2-0000-7000-8000-00000000000a";
const PARAMS: DashboardParams = {
  from: "2026-10-01",
  to: "2026-10-31",
  unitIds: [UNIT],
  compare: "previous_year",
};

const indicator = { value: 1, previous: null, changePermille: null, direction: null };
const summary = {
  period: { from: "2026-10-01", to: "2026-10-31" },
  comparison: null,
  isEmpty: false,
  ticketCoveragePermille: null,
  indicators: {
    grossRevenue: indicator,
    deductions: indicator,
    netRevenue: indicator,
    operatingExpenses: indicator,
    result: indicator,
    investments: indicator,
    margin: indicator,
    cmvRatio: indicator,
    averageTicket: indicator,
    breakEven: indicator,
  },
};

function setup(body: unknown) {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const api = reportsApi(createApiClient({ baseUrl: "", fetch: fetchImpl }));
  return { api, url: () => String(fetchImpl.mock.calls[0]?.[0]) };
}

describe("cliente das rotas de relatório", () => {
  it("summary chama a URL com período, unidades e comparação", async () => {
    const { api, url } = setup(summary);
    await api.summary(PARAMS);
    expect(url()).toBe(
      `/api/reports/summary?from=2026-10-01&to=2026-10-31&compare=previous_year&unitIds=${UNIT}`,
    );
  });

  it("summary aceita a resposta sem payrollRatio e recusa chave extra", async () => {
    await expect(setup(summary).api.summary(PARAMS)).resolves.toBeDefined();
    const extra = { ...summary, indicators: { ...summary.indicators, folha: indicator } };
    await expect(setup(extra).api.summary(PARAMS)).rejects.toThrow();
  });

  it("monthly só leva `to` e as unidades", async () => {
    const months = Array.from({ length: 6 }, (_, i) => ({
      month: `2026-${String(i + 5).padStart(2, "0")}`,
      revenueCents: 0,
      expenseCents: 0,
      resultCents: 0,
    }));
    const { api, url } = setup({ months });
    await api.monthly(PARAMS);
    expect(url()).toBe(`/api/reports/monthly?to=2026-10-31&unitIds=${UNIT}`);
  });

  it("breakdown leva a dimensão e valida a resposta", async () => {
    const { api, url } = setup({ by: "category", totalCents: 0, items: [] });
    await api.breakdown(PARAMS, "category");
    expect(url()).toBe(
      `/api/reports/breakdown?from=2026-10-01&to=2026-10-31&unitIds=${UNIT}&by=category`,
    );
    await expect(
      setup({ by: "category", totalCents: 1.5, items: [] }).api.breakdown(PARAMS, "category"),
    ).rejects.toThrow();
  });
});
