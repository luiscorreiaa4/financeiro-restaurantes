import { describe, expect, it } from "vitest";
import { parseBRLInput } from "./parse-brl";

const cents = (text: string): number => {
  const result = parseBRLInput(text);
  if (!result.ok) throw new Error(`valor recusado: "${text}"`);
  return result.value;
};

const errorCode = (text: string): string | null => {
  const result = parseBRLInput(text);
  return result.ok ? null : result.error.code;
};

describe("valor digitado em reais vira centavos", () => {
  it("lê milhar com ponto e centavos com vírgula (RF23.CA01)", () => {
    expect(cents("1.234,56")).toBe(123456);
  });

  it("lê ponto único seguido de 1 ou 2 dígitos como decimal", () => {
    expect(cents("1234.56")).toBe(123456);
    expect(cents("1234.5")).toBe(123450);
  });

  it("lê valor sem separador como reais inteiros", () => {
    expect(cents("450")).toBe(45000);
  });

  it("lê vírgula como decimal, com 1 ou 2 casas", () => {
    expect(cents("450,00")).toBe(45000);
    expect(cents("0,1")).toBe(10);
    expect(cents("1234,56")).toBe(123456);
  });

  it("lê ponto que separa grupos de exatamente 3 dígitos como milhar", () => {
    expect(cents("1.234")).toBe(123400);
    expect(cents("1.234.567")).toBe(123456700);
    expect(cents("1.234.567,89")).toBe(123456789);
  });

  it("aceita o símbolo R$ e espaços em volta", () => {
    expect(cents("R$ 12,5")).toBe(1250);
    expect(cents("  R$1.234,56  ")).toBe(123456);
    expect(cents(" 450 ")).toBe(45000);
  });

  it("não perde centavo em valor que float representaria errado", () => {
    expect(cents("0,29")).toBe(29);
    expect(cents("1,15")).toBe(115);
    expect(cents("4,35")).toBe(435);
    expect(cents("90071992547409,91")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("recusa vírgula com mais de 2 casas", () => {
    expect(errorCode("1,234")).toBe("InvalidAmount");
  });

  it("recusa texto que não é valor", () => {
    expect(errorCode("abc")).toBe("InvalidAmount");
    expect(errorCode("")).toBe("InvalidAmount");
    expect(errorCode("   ")).toBe("InvalidAmount");
    expect(errorCode("R$")).toBe("InvalidAmount");
    expect(errorCode("12abc")).toBe("InvalidAmount");
    expect(errorCode("1e3")).toBe("InvalidAmount");
  });

  it("recusa valor negativo", () => {
    expect(errorCode("-5")).toBe("InvalidAmount");
  });

  it("recusa pontos que não formam milhar nem decimal", () => {
    expect(errorCode("1.2.3")).toBe("InvalidAmount");
    expect(errorCode("12.34,56")).toBe("InvalidAmount");
    expect(errorCode("1234.567")).toBe("InvalidAmount");
    expect(errorCode("1.2345")).toBe("InvalidAmount");
  });

  it("recusa separador sem dígito de um dos lados e mais de uma vírgula", () => {
    expect(errorCode(",5")).toBe("InvalidAmount");
    expect(errorCode("5,")).toBe("InvalidAmount");
    expect(errorCode("5.")).toBe("InvalidAmount");
    expect(errorCode("1,2,3")).toBe("InvalidAmount");
  });

  it("recusa zero, porque o valor precisa ser maior que zero", () => {
    expect(parseBRLInput("0")).toEqual({ ok: false, error: { code: "InvalidAmount", value: 0 } });
    expect(errorCode("0,00")).toBe("InvalidAmount");
    expect(errorCode("0.0")).toBe("InvalidAmount");
  });

  it("recusa valor acima do inteiro seguro em centavos", () => {
    expect(errorCode("90071992547409,92")).toBe("InvalidAmount");
    expect(errorCode("99999999999999999999")).toBe("InvalidAmount");
  });
});
