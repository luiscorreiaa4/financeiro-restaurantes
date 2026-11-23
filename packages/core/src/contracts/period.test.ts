import { describe, expect, it } from "vitest";
import {
  addMonthsToBusinessDate,
  COMPARISON_KINDS,
  comparisonPeriod,
  MAX_PERIOD_MONTHS,
  monthsOf,
  monthsWindow,
  PERIOD_PRESETS,
  periodWithinLimit,
  resolvePeriod,
} from "./period";

describe("atalhos de período da lista de lançamentos (RF22.R1)", () => {
  it("oferece hoje, ontem, últimos 7 dias, mês corrente, mês anterior e personalizado", () => {
    expect(PERIOD_PRESETS).toEqual([
      "today",
      "yesterday",
      "last_7_days",
      "current_month",
      "previous_month",
      "custom",
    ]);
  });

  it("hoje é o próprio dia", () => {
    expect(resolvePeriod("today", "2026-11-13")).toEqual({ from: "2026-11-13", to: "2026-11-13" });
  });

  it("ontem volta para o último dia do mês anterior na virada de mês", () => {
    expect(resolvePeriod("yesterday", "2026-11-01")).toEqual({
      from: "2026-10-31",
      to: "2026-10-31",
    });
  });

  it("ontem volta para 31 de dezembro na virada de ano", () => {
    expect(resolvePeriod("yesterday", "2027-01-01")).toEqual({
      from: "2026-12-31",
      to: "2026-12-31",
    });
  });

  it("ontem de 1º de março é 29 de fevereiro em ano bissexto e 28 nos demais", () => {
    expect(resolvePeriod("yesterday", "2028-03-01").from).toBe("2028-02-29");
    expect(resolvePeriod("yesterday", "2027-03-01").from).toBe("2027-02-28");
    // 2100 não é bissexto; 2000 é.
    expect(resolvePeriod("yesterday", "2100-03-01").from).toBe("2100-02-28");
    expect(resolvePeriod("yesterday", "2000-03-01").from).toBe("2000-02-29");
  });

  it("últimos 7 dias contam hoje e os seis dias anteriores", () => {
    expect(resolvePeriod("last_7_days", "2026-11-13")).toEqual({
      from: "2026-11-07",
      to: "2026-11-13",
    });
  });

  it("últimos 7 dias atravessam a virada de mês e de ano", () => {
    expect(resolvePeriod("last_7_days", "2027-01-03")).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
    expect(resolvePeriod("last_7_days", "2028-03-02").from).toBe("2028-02-25");
  });

  it("mês corrente vai do dia 1 ao último dia do mês, e não só até hoje", () => {
    expect(resolvePeriod("current_month", "2026-11-13")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(resolvePeriod("current_month", "2028-02-29")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(resolvePeriod("current_month", "2027-02-10").to).toBe("2027-02-28");
  });

  it("mês anterior de janeiro é dezembro do ano anterior", () => {
    expect(resolvePeriod("previous_month", "2027-01-15")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("mês anterior de março termina em 29 de fevereiro no ano bissexto", () => {
    expect(resolvePeriod("previous_month", "2028-03-31")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("recusa uma data de hoje que não existe", () => {
    expect(() => resolvePeriod("today", "2026-02-30")).toThrow(RangeError);
    expect(() => resolvePeriod("today", "13/11/2026")).toThrow(RangeError);
  });
});

describe("limite de 24 meses por consulta (RF22.R1)", () => {
  it("o limite é de 24 meses", () => {
    expect(MAX_PERIOD_MONTHS).toBe(24);
  });

  it("soma meses mantendo o dia e encurtando para o fim do mês quando o dia não existe", () => {
    expect(addMonthsToBusinessDate("2026-01-15", 24)).toBe("2028-01-15");
    expect(addMonthsToBusinessDate("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonthsToBusinessDate("2028-02-29", 24)).toBe("2030-02-28");
    expect(addMonthsToBusinessDate("2026-12-31", 1)).toBe("2027-01-31");
  });

  it("aceita exatamente 24 meses e recusa 24 meses e 1 dia", () => {
    expect(periodWithinLimit("2024-11-13", "2026-11-13")).toBe(true);
    expect(periodWithinLimit("2024-11-13", "2026-11-14")).toBe(false);
  });

  it("aceita um único dia", () => {
    expect(periodWithinLimit("2026-11-13", "2026-11-13")).toBe(true);
  });
});

describe("período de comparação do dashboard (RF27.R2)", () => {
  it("oferece período anterior, mesmo período do ano anterior e nenhum", () => {
    expect(COMPARISON_KINDS).toEqual(["previous_period", "previous_year", "none"]);
  });

  it("previous_period é o mesmo número de dias imediatamente antes", () => {
    expect(comparisonPeriod({ from: "2026-10-01", to: "2026-10-17" }, "previous_period")).toEqual({
      from: "2026-09-14",
      to: "2026-09-30",
    });
  });

  it("previous_period atravessa a virada de ano", () => {
    expect(comparisonPeriod({ from: "2027-01-01", to: "2027-01-10" }, "previous_period")).toEqual({
      from: "2026-12-22",
      to: "2026-12-31",
    });
  });

  it("previous_period de um mês cheio usa os 31 dias anteriores, não o mês anterior", () => {
    expect(comparisonPeriod({ from: "2026-10-01", to: "2026-10-31" }, "previous_period")).toEqual({
      from: "2026-08-31",
      to: "2026-09-30",
    });
  });

  it("previous_period de um dia só é o dia anterior, inclusive sobre 29/02", () => {
    expect(comparisonPeriod({ from: "2028-03-01", to: "2028-03-01" }, "previous_period")).toEqual({
      from: "2028-02-29",
      to: "2028-02-29",
    });
  });

  it("previous_year anda 12 meses nos dois extremos, e 29/02 vira 28/02", () => {
    expect(comparisonPeriod({ from: "2028-02-01", to: "2028-02-29" }, "previous_year")).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
    expect(comparisonPeriod({ from: "2028-02-29", to: "2028-02-29" }, "previous_year")).toEqual({
      from: "2027-02-28",
      to: "2027-02-28",
    });
  });

  it("none não tem período de comparação", () => {
    expect(comparisonPeriod({ from: "2026-10-01", to: "2026-10-17" }, "none")).toBeNull();
  });
});

describe("janela de meses do dashboard", () => {
  it("monthsWindow termina em `to` e começa no dia 1 do primeiro mês", () => {
    expect(monthsWindow("2026-11-17", 6)).toEqual({ from: "2026-06-01", to: "2026-11-17" });
  });

  it("monthsWindow atravessa a virada de ano", () => {
    expect(monthsWindow("2026-02-10", 6)).toEqual({ from: "2025-09-01", to: "2026-02-10" });
  });

  it("monthsOf lista os meses em ordem crescente", () => {
    expect(monthsOf("2026-02-10", 6)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});
