import { describe, expect, it } from "vitest";
import {
  breakdownQuerySchema,
  dashboardSummarySchema,
  monthlyQuerySchema,
  monthlyReportSchema,
  reportQuerySchema,
} from "./reports";

const UNIT_1 = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const UNIT_2 = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

const indicator = { value: 1000, previous: 800, changePermille: 250, direction: "up" } as const;

function summary(): Record<string, unknown> {
  return {
    period: { from: "2026-11-01", to: "2026-11-17" },
    comparison: { kind: "previous_period", period: { from: "2026-10-15", to: "2026-10-31" } },
    isEmpty: false,
    ticketCoveragePermille: 900,
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
}

describe("contrato do resumo do dashboard (RF27)", () => {
  it("aceita a resposta sem payrollRatio", () => {
    expect(dashboardSummarySchema.safeParse(summary()).success).toBe(true);
  });

  it("aceita payrollRatio quando enviado", () => {
    const body = summary();
    (body.indicators as Record<string, unknown>).payrollRatio = indicator;
    expect(dashboardSummarySchema.safeParse(body).success).toBe(true);
  });

  it("aceita indicador sem base de comparação", () => {
    const body = summary();
    (body.indicators as Record<string, unknown>).margin = {
      value: null,
      previous: null,
      changePermille: null,
      direction: null,
    };
    body.comparison = null;
    expect(dashboardSummarySchema.safeParse(body).success).toBe(true);
  });

  it("recusa chave extra no topo", () => {
    expect(dashboardSummarySchema.safeParse({ ...summary(), extra: 1 }).success).toBe(false);
  });

  it("recusa chave extra dentro dos indicadores", () => {
    const body = summary();
    (body.indicators as Record<string, unknown>).secret = indicator;
    expect(dashboardSummarySchema.safeParse(body).success).toBe(false);
  });

  it("recusa valor fracionário (dinheiro é inteiro)", () => {
    const body = summary();
    (body.indicators as Record<string, unknown>).grossRevenue = { ...indicator, value: 1.5 };
    expect(dashboardSummarySchema.safeParse(body).success).toBe(false);
  });
});

describe("consulta de relatório (RF27.R1, R2)", () => {
  it("sem compare, o padrão é previous_period", () => {
    const parsed = reportQuerySchema.parse({ from: "2026-11-01", to: "2026-11-17" });
    expect(parsed.compare).toBe("previous_period");
  });

  it("aceita um unitIds só e lista de unitIds", () => {
    const one = reportQuerySchema.parse({ from: "2026-11-01", to: "2026-11-17", unitIds: UNIT_1 });
    expect(one.unitIds).toEqual([UNIT_1]);
    const two = reportQuerySchema.parse({
      from: "2026-11-01",
      to: "2026-11-17",
      unitIds: [UNIT_1, UNIT_2],
    });
    expect(two.unitIds).toEqual([UNIT_1, UNIT_2]);
  });

  it("recusa compare desconhecido", () => {
    expect(
      reportQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-17", compare: "x" }).success,
    ).toBe(false);
  });

  it("recusa período de 25 meses", () => {
    expect(reportQuerySchema.safeParse({ from: "2024-01-01", to: "2026-02-01" }).success).toBe(
      false,
    );
  });

  it("aceita período de exatamente 24 meses", () => {
    expect(reportQuerySchema.safeParse({ from: "2024-11-01", to: "2026-11-01" }).success).toBe(
      true,
    );
  });

  it("recusa período invertido", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-11-17", to: "2026-11-01" }).success).toBe(
      false,
    );
  });

  it("recusa data inexistente", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(
      false,
    );
  });

  it("recusa unitIds que não é uuid", () => {
    expect(
      reportQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-17", unitIds: "x" }).success,
    ).toBe(false);
  });
});

describe("consulta mensal e relatório mensal", () => {
  it("aceita to e unitIds", () => {
    expect(monthlyQuerySchema.safeParse({ to: "2026-11-17", unitIds: UNIT_1 }).success).toBe(true);
  });

  it("recusa to ausente", () => {
    expect(monthlyQuerySchema.safeParse({}).success).toBe(false);
  });

  const month = (m: string) => ({ month: m, revenueCents: 1, expenseCents: 1, resultCents: 0 });

  it("exige exatamente 6 meses", () => {
    const six = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map(month);
    expect(monthlyReportSchema.safeParse({ months: six }).success).toBe(true);
    expect(monthlyReportSchema.safeParse({ months: six.slice(1) }).success).toBe(false);
    expect(monthlyReportSchema.safeParse({ months: [...six, month("2026-12")] }).success).toBe(
      false,
    );
  });
});

describe("consulta de detalhamento", () => {
  it("aceita cada dimensão e recusa outra", () => {
    const base = { from: "2026-11-01", to: "2026-11-17" };
    for (const by of ["category", "sales_channel", "payment_method"]) {
      expect(breakdownQuerySchema.safeParse({ ...base, by }).success).toBe(true);
    }
    expect(breakdownQuerySchema.safeParse({ ...base, by: "supplier" }).success).toBe(false);
    expect(breakdownQuerySchema.safeParse(base).success).toBe(false);
  });

  it("recusa período de 25 meses", () => {
    expect(
      breakdownQuerySchema.safeParse({ from: "2024-01-01", to: "2026-02-01", by: "category" })
        .success,
    ).toBe(false);
  });
});
