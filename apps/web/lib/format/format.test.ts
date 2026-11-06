import { type Money, money, ZERO } from "@app/core";
import { describe, expect, it } from "vitest";
import { formatBRL, formatBusinessDate } from "./index";

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
