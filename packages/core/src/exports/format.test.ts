import { describe, expect, it } from "vitest";
import { businessDateToBR, centsToDecimalText, neutralizeFormula, timestampToBR } from "./format";

describe("centsToDecimalText", () => {
  it.each([
    [0, "0,00"],
    [5, "0,05"],
    [99, "0,99"],
    [100, "1,00"],
    [123456, "1234,56"],
    [-123456, "-1234,56"],
    [-5, "-0,05"],
    [Number.MAX_SAFE_INTEGER, "90071992547409,91"],
    [-Number.MAX_SAFE_INTEGER, "-90071992547409,91"],
  ])("%i centavos vira %s", (cents, text) => {
    expect(centsToDecimalText(cents)).toBe(text);
  });

  it("recusa o que não é inteiro seguro", () => {
    expect(() => centsToDecimalText(1.5)).toThrow(RangeError);
    expect(() => centsToDecimalText(Number.NaN)).toThrow(RangeError);
    expect(() => centsToDecimalText(2 ** 60)).toThrow(RangeError);
  });
});

describe("businessDateToBR", () => {
  it("troca a ordem sem passar por Date", () => {
    expect(businessDateToBR("2026-10-05")).toBe("05/10/2026");
  });

  it("recusa texto que não é data de negócio", () => {
    expect(() => businessDateToBR("05/10/2026")).toThrow(RangeError);
  });
});

describe("timestampToBR", () => {
  it("usa o fuso de São Paulo por padrão", () => {
    expect(timestampToBR("2026-10-01T02:30:00Z")).toBe("30/09/2026 23:30");
  });

  it("aceita outro fuso", () => {
    expect(timestampToBR("2026-10-01T02:30:00Z", "UTC")).toBe("01/10/2026 02:30");
  });

  it("recusa instante inválido", () => {
    expect(() => timestampToBR("ontem")).toThrow(RangeError);
  });
});

describe("neutralizeFormula", () => {
  it.each(["=SOMA(A1)", "+1", "-1", "@x", "\tx", "\rx"])("prefixa %j", (text) => {
    expect(neutralizeFormula(text)).toBe(`'${text}`);
  });

  it("deixa o resto intacto", () => {
    expect(neutralizeFormula("Pão de açúcar")).toBe("Pão de açúcar");
    expect(neutralizeFormula("")).toBe("");
    expect(neutralizeFormula("a=b")).toBe("a=b");
  });
});
