import {
  type BreakdownDimension,
  breakdownReportSchema,
  dashboardSummarySchema,
  monthlyReportSchema,
} from "@app/core/contracts";
import { describe, expect, it } from "vitest";
import { answerReports } from "../../e2e/fake-reports.mjs";

// Contrato da API falsa de relatórios (T10): cada resposta passa pelos schemas `.strict()` de
// packages/core/src/contracts/reports.ts. A API falsa é um .mjs sem servidor, importado direto.

type Company = { role: "owner" | "manager" | "staff" | "accountant" };

const OWNER = { role: "owner" } as const;
const MANAGER = { role: "manager" } as const;
const ACCOUNTANT = { role: "accountant" } as const;
const STAFF = { role: "staff" } as const;

function get(company: Company, path: string): { status: number; body: unknown } {
  return answerReports("GET", path, company);
}

function summaryOf(company: Company, query = "") {
  const answer = get(company, `/api/reports/summary${query}`);
  expect(answer.status).toBe(200);
  return dashboardSummarySchema.parse(answer.body);
}

function breakdownOf(company: Company, by: BreakdownDimension) {
  const answer = get(company, `/api/reports/breakdown?from=2026-11-01&to=2026-11-17&by=${by}`);
  expect(answer.status).toBe(200);
  return breakdownReportSchema.parse(answer.body);
}

describe("API falsa de relatórios (T10, RF27)", () => {
  it("dono: resumo válido, com a folha e a variação do período anterior", () => {
    const s = summaryOf(OWNER);
    expect(s.period).toEqual({ from: "2026-11-01", to: "2026-11-17" });
    expect(s.comparison).toEqual({
      kind: "previous_period",
      period: { from: "2026-10-15", to: "2026-10-31" },
    });
    expect(s.isEmpty).toBe(false);
    expect(s.ticketCoveragePermille).toBe(600);
    expect(s.indicators.grossRevenue).toEqual({
      value: 1000000,
      previous: 900000,
      changePermille: 111,
      direction: "up",
    });
    expect(s.indicators.netRevenue.value).toBe(965000);
    expect(s.indicators.result.value).toBe(265000);
    expect(s.indicators.investments.direction).toBe("flat");
    expect(s.indicators.payrollRatio?.value).toBe(300);
  });

  it("gerente sem folha: mesmo resumo, sem payrollRatio", () => {
    const s = summaryOf(MANAGER);
    expect("payrollRatio" in s.indicators).toBe(false);
    expect(s.indicators.grossRevenue.value).toBe(1000000);
    expect(s.indicators.operatingExpenses.value).toBe(700000);
  });

  it("contador vê a folha, como o dono", () => {
    expect(summaryOf(ACCOUNTANT).indicators.payrollRatio?.value).toBe(300);
  });

  it("compare=none: sem comparação e sem variação em nenhum indicador", () => {
    const s = summaryOf(OWNER, "?compare=none");
    expect(s.comparison).toBeNull();
    for (const indicator of Object.values(s.indicators)) {
      expect(indicator).toMatchObject({ previous: null, changePermille: null, direction: null });
    }
    expect(s.indicators.grossRevenue.value).toBe(1000000);
  });

  it("compare=previous_year: comparação com o mesmo intervalo do ano anterior", () => {
    const s = summaryOf(OWNER, "?compare=previous_year");
    expect(s.comparison).toEqual({
      kind: "previous_year",
      period: { from: "2025-11-01", to: "2025-11-17" },
    });
  });

  it("período vazio: isEmpty, zeros e nulos coerentes, sem exceção", () => {
    const s = summaryOf(OWNER, "?from=2026-01-01&to=2026-01-31");
    expect(s.isEmpty).toBe(true);
    expect(s.period).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(s.ticketCoveragePermille).toBeNull();
    expect(s.indicators.grossRevenue).toMatchObject({ value: 0, previous: 0 });
    expect(s.indicators.margin).toMatchObject({ value: null, previous: null });
    expect(s.indicators.payrollRatio).toMatchObject({ value: null, previous: null });
    expect(s.indicators.averageTicket.value).toBeNull();
    expect(s.indicators.breakEven.value).toBeNull();
  });

  it("monthly: seis meses de jun a nov de 2026, com resultado = receita − despesa", () => {
    const answer = get(OWNER, "/api/reports/monthly?to=2026-11-17");
    expect(answer.status).toBe(200);
    const m = monthlyReportSchema.parse(answer.body);
    expect(m.months.map((x) => x.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    for (const month of m.months) {
      expect(month.resultCents).toBe(month.revenueCents - month.expenseCents);
    }
  });

  it("breakdown por categoria: 'Pessoal' para o dono e 'Pessoal (restrito)' para o gerente", () => {
    const owner = breakdownOf(OWNER, "category");
    expect(owner.items.map((i) => i.label)).toContain("Pessoal");
    expect(owner.items.some((i) => i.key === "pessoal")).toBe(true);

    const manager = breakdownOf(MANAGER, "category");
    const restricted = manager.items.find((i) => i.key === "restricted");
    expect(restricted?.label).toBe("Pessoal (restrito)");
    expect(manager.items.map((i) => i.label)).not.toContain("Folha de pagamento");
    expect(manager.items.map((i) => i.label)).not.toContain("Pessoal");
  });

  it("breakdown: itens em ordem decrescente, somando o total, com a parte em permil", () => {
    for (const by of ["category", "sales_channel", "payment_method"] as const) {
      const b = breakdownOf(OWNER, by);
      const amounts = b.items.map((i) => i.amountCents);
      expect(amounts).toEqual([...amounts].sort((x, y) => y - x));
      expect(amounts.reduce((sum, n) => sum + n, 0)).toBe(b.totalCents);
    }
  });

  it("breakdown por canal e forma de pagamento: 'Não informado' e 'Não informada' com key none", () => {
    const channel = breakdownOf(OWNER, "sales_channel");
    expect(channel.items.find((i) => i.key === "none")?.label).toBe("Não informado");
    const payment = breakdownOf(OWNER, "payment_method");
    expect(payment.items.find((i) => i.key === "none")?.label).toBe("Não informada");
  });

  it("lançador: 403 forbidden nas três rotas", () => {
    for (const path of [
      "/api/reports/summary",
      "/api/reports/monthly?to=2026-11-17",
      "/api/reports/breakdown?by=category",
    ]) {
      expect(get(STAFF, path)).toEqual({ status: 403, body: { code: "forbidden" } });
    }
  });
});
