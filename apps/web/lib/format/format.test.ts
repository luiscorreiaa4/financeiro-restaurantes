import { type Money, money, ZERO } from "@app/core";
import { describe, expect, it } from "vitest";
import {
  formatBRL,
  formatBusinessDate,
  formatCents,
  formatPermille,
  todayBusinessDate,
} from "./index";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error(`centavos inválidos: ${cents}`);
  return result.value;
};

describe("formatação de dinheiro no painel", () => {
  it("mostra centavos como reais com separadores brasileiros", () => {
    expect(formatBRL(m(123456))).toBe("R$ 1.234,56");
  });

  it("mostra zero como R$ 0,00", () => {
    expect(formatBRL(ZERO)).toBe("R$ 0,00");
  });
});

describe("formatação de data de negócio", () => {
  it("formata YYYY-MM-DD como dd/MM/yyyy", () => {
    expect(formatBusinessDate("2026-10-27")).toBe("27/10/2026");
  });

  it("não desloca o dia por causa do fuso (1º de janeiro continua 1º de janeiro)", () => {
    expect(formatBusinessDate("2026-01-01")).toBe("01/01/2026");
  });

  it.each(["2026-13-45", "2026-02-30", "27/10/2026", ""])(
    "rejeita data inválida %j com RangeError",
    (input) => {
      expect(() => formatBusinessDate(input)).toThrow(RangeError);
    },
  );
});

describe("centavos do contrato da API (number) como reais", () => {
  it("formata o inteiro de centavos que a API devolveu", () => {
    expect(formatCents(123456)).toBe("R$ 1.234,56");
    expect(formatCents(0)).toBe("R$ 0,00");
  });

  it("resultado negativo sai com o sinal na frente", () => {
    expect(formatCents(-1564252)).toBe("-R$ 15.642,52");
    expect(formatCents(-5)).toBe("-R$ 0,05");
  });

  it("recusa valor que não é inteiro seguro (nunca float)", () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  });
});

describe("hoje como data de negócio", () => {
  it("usa o dia de America/Sao_Paulo, não o de UTC", () => {
    // 01:30 UTC do dia 14 ainda é dia 13 em São Paulo (UTC-3).
    expect(todayBusinessDate(new Date("2026-11-14T01:30:00Z"))).toBe("2026-11-13");
    expect(todayBusinessDate(new Date("2026-11-14T03:00:00Z"))).toBe("2026-11-14");
  });
});

describe("formatação de percentual em décimos de ponto (formatPermille)", () => {
  it("mostra uma casa decimal com vírgula", () => {
    expect(formatPermille(123)).toBe("12,3%");
    expect(formatPermille(265)).toBe("26,5%");
    expect(formatPermille(600)).toBe("60,0%");
  });

  it("mantém o sinal do valor negativo e o zero sem sinal", () => {
    expect(formatPermille(-124)).toBe("-12,4%");
    expect(formatPermille(-5)).toBe("-0,5%");
    expect(formatPermille(0)).toBe("0,0%");
  });

  it("mostra traço quando não há valor", () => {
    expect(formatPermille(null)).toBe("—");
  });

  it("recusa valor que não é inteiro seguro", () => {
    expect(() => formatPermille(1.5)).toThrow(RangeError);
  });
});
