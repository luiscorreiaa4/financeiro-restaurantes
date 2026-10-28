import { describe, expect, it } from "vitest";
import { add, formatBRL, type Money, money, mulBasisPoints, subtract, ZERO } from "./money";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error(`centavos inválidos: ${cents}`);
  return result.value;
};

describe("dinheiro em centavos", () => {
  it("aceita zero e valores inteiros positivos", () => {
    expect(money(0).ok).toBe(true);
    expect(money(12345).ok).toBe(true);
  });

  it("rejeita valor negativo", () => {
    const result = money(-1);
    expect(result).toEqual({ ok: false, error: { code: "InvalidAmount", value: -1 } });
  });

  it("rejeita valor com casas decimais, NaN e infinito", () => {
    expect(money(10.5).ok).toBe(false);
    expect(money(Number.NaN).ok).toBe(false);
    expect(money(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("rejeita valor acima do inteiro seguro", () => {
    expect(money(Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
    expect(money(Number.MAX_SAFE_INTEGER).ok).toBe(true);
  });

  it("soma sem erro de ponto flutuante (0,10 + 0,20 = 0,30)", () => {
    const result = add(m(10), m(20));
    expect(result).toEqual({ ok: true, value: 30 });
  });

  it("avisa estouro quando a soma passa do inteiro seguro", () => {
    const result = add(m(Number.MAX_SAFE_INTEGER), m(1));
    expect(result).toEqual({ ok: false, error: { code: "MoneyOverflow" } });
  });

  it("subtrai e permite chegar a zero", () => {
    expect(subtract(m(500), m(500))).toEqual({ ok: true, value: ZERO });
  });

  it("rejeita subtração que ficaria negativa", () => {
    const result = subtract(m(100), m(101));
    expect(result.ok).toBe(false);
  });
});

describe("multiplicação por pontos-base", () => {
  it("calcula 3,20% de R$ 100,00", () => {
    expect(mulBasisPoints(m(10000), 320)).toEqual({ ok: true, value: 320 });
  });

  it("zero vezes qualquer taxa é zero, e qualquer valor com taxa zero é zero", () => {
    expect(mulBasisPoints(ZERO, 320)).toEqual({ ok: true, value: 0 });
    expect(mulBasisPoints(m(10000), 0)).toEqual({ ok: true, value: 0 });
  });

  it("arredonda meio centavo para cima (0,5 vira 1)", () => {
    // 50 centavos × 1,00% = 0,5 centavo
    expect(mulBasisPoints(m(50), 100)).toEqual({ ok: true, value: 1 });
  });

  it("arredonda para baixo quando a fração é menor que meio centavo", () => {
    // 49 centavos × 1,00% = 0,49 centavo
    expect(mulBasisPoints(m(49), 100)).toEqual({ ok: true, value: 0 });
    // 1050 centavos × 3,20% = 33,6 centavos → 34
    expect(mulBasisPoints(m(1050), 320)).toEqual({ ok: true, value: 34 });
    // 1000 centavos × 3,24% = 32,4 centavos → 32
    expect(mulBasisPoints(m(1000), 324)).toEqual({ ok: true, value: 32 });
  });

  it("calcula valores enormes sem perder precisão (bigint por dentro)", () => {
    // R$ 90 trilhões em centavos × 1,00%
    const big = m(9_000_000_000_000_000);
    expect(mulBasisPoints(big, 100)).toEqual({ ok: true, value: 90_000_000_000_000 });
  });

  it("avisa estouro quando o resultado passa do inteiro seguro", () => {
    const result = mulBasisPoints(m(Number.MAX_SAFE_INTEGER), 20000);
    expect(result).toEqual({ ok: false, error: { code: "MoneyOverflow" } });
  });

  it("rejeita taxa negativa ou fracionária", () => {
    expect(mulBasisPoints(m(100), -1).ok).toBe(false);
    expect(mulBasisPoints(m(100), 1.5).ok).toBe(false);
  });
});

describe("formatação em reais", () => {
  it.each([
    [0, "R$ 0,00"],
    [5, "R$ 0,05"],
    [99, "R$ 0,99"],
    [100, "R$ 1,00"],
    [123456, "R$ 1.234,56"],
    [100000000, "R$ 1.000.000,00"],
    [9_007_199_254_740_991, "R$ 90.071.992.547.409,91"],
  ])("formata %i centavos como %s", (cents, expected) => {
    expect(formatBRL(m(cents))).toBe(expected);
  });
});
