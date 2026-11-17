import { describe, expect, it } from "vitest";
import { toBreakdownSeries, toMonthlySeries } from "./chart-mappers";

describe("mapeadores do contrato para os gráficos", () => {
  it("a série mensal preserva a ordem e os valores e rotula o mês em pt-BR", () => {
    const series = toMonthlySeries({
      months: [
        { month: "2026-06", revenueCents: 100, expenseCents: 60, resultCents: 40 },
        { month: "2026-09", revenueCents: 0, expenseCents: 0, resultCents: 0 },
        { month: "2026-11", revenueCents: 250, expenseCents: 300, resultCents: -50 },
        { month: "2026-12", revenueCents: 1, expenseCents: 1, resultCents: 0 },
        { month: "2027-02", revenueCents: 1, expenseCents: 2, resultCents: -1 },
        { month: "2027-03", revenueCents: 3, expenseCents: 2, resultCents: 1 },
      ],
    });
    expect(series.map((s) => s.label)).toEqual([
      "jun/26",
      "set/26",
      "nov/26",
      "dez/26",
      "fev/27",
      "mar/27",
    ]);
    expect(series[2]).toEqual({
      month: "2026-11",
      label: "nov/26",
      revenue: 250,
      expense: 300,
      result: -50,
    });
  });

  it("a série de quebra copia os campos sem refazer conta nem reordenar", () => {
    const series = toBreakdownSeries({
      by: "category",
      totalCents: 999,
      items: [
        { key: "restricted", label: "Pessoal (restrito)", amountCents: 300000, sharePermille: 500 },
        { key: "cmv", label: "CMV", amountCents: 100, sharePermille: null },
      ],
    });
    expect(series).toEqual([
      { key: "restricted", label: "Pessoal (restrito)", amount: 300000, share: 500 },
      { key: "cmv", label: "CMV", amount: 100, share: null },
    ]);
  });
});
