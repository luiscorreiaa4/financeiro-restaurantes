import { describe, expect, it } from "vitest";
import { applyMask, CNPJ_MASK, maskBRL, maskBrPhone, maskCnpj, PHONE_MASK } from "./input-masks";

describe("maskCnpj", () => {
  it("formata enquanto digita", () => {
    expect(maskCnpj("1")).toBe("1");
    expect(maskCnpj("112")).toBe("11.2");
    expect(maskCnpj("11222333")).toBe("11.222.333");
    expect(maskCnpj("112223330001")).toBe("11.222.333/0001");
    expect(maskCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("aceita colar com ou sem pontuação, em minúsculas", () => {
    expect(maskCnpj("12.abc.345/01de-35")).toBe("12.ABC.345/01DE-35");
    expect(maskCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });

  it("não aceita letra nos dois dígitos verificadores e ignora o que passa de 14", () => {
    expect(maskCnpj("12ABC34501DEAB")).toBe("12.ABC.345/01DE");
    expect(maskCnpj("1122233300018199")).toBe("11.222.333/0001-81");
  });
});

describe("maskBrPhone", () => {
  it("formata celular e fixo enquanto digita", () => {
    expect(maskBrPhone("")).toBe("");
    expect(maskBrPhone("1")).toBe("(1");
    expect(maskBrPhone("11")).toBe("(11");
    expect(maskBrPhone("119")).toBe("(11) 9");
    expect(maskBrPhone("1198765")).toBe("(11) 9876-5");
    expect(maskBrPhone("1134567890")).toBe("(11) 3456-7890");
    expect(maskBrPhone("11987654321")).toBe("(11) 98765-4321");
  });

  it("aceita colar com +55, zero de tronco e pontuação", () => {
    expect(maskBrPhone("+55 (11) 98765-4321")).toBe("(11) 98765-4321");
    expect(maskBrPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(maskBrPhone("011 98765-4321")).toBe("(11) 98765-4321");
  });

  it("não perde o DDD 55 de quem digita um número nacional", () => {
    expect(maskBrPhone("55987654321")).toBe("(55) 98765-4321");
  });
});

describe("applyMask (cursor)", () => {
  it("digitar no fim leva o cursor ao fim", () => {
    expect(applyMask(PHONE_MASK, "(11) 9876", "(11) 98765", 10)).toEqual({
      value: "(11) 9876-5",
      caret: 11,
    });
  });

  it("inserir no meio mantém o cursor depois do dígito digitado", () => {
    // "(11) 98765-4321" com um 0 digitado depois do 9 (cursor 6).
    const result = applyMask(PHONE_MASK, "(11) 98765-4321", "(11) 908765-4321", 7);
    expect(result.value).toBe("(11) 90876-5432");
    expect(result.caret).toBe(7);
  });

  it("Backspace sobre o separador apaga o dígito anterior", () => {
    // Cursor logo depois do hífen em "(11) 98765-4321": o "-" foi apagado.
    const result = applyMask(PHONE_MASK, "(11) 98765-4321", "(11) 987654321", 10);
    // Sai o "5" (não o hífen); restam 10 dígitos, que a máscara reagrupa como fixo.
    expect(result.value).toBe("(11) 9876-4321");
    expect(result.caret).toBe(9);
  });

  it("colar o CNPJ inteiro leva o cursor ao fim", () => {
    const result = applyMask(CNPJ_MASK, "", "12.abc.345/01de-35", 18);
    expect(result).toEqual({ value: "12.ABC.345/01DE-35", caret: 18 });
  });

  it("apagar tudo zera o cursor", () => {
    expect(applyMask(CNPJ_MASK, "1", "", 0)).toEqual({ value: "", caret: 0 });
  });
});

describe("maskBRL", () => {
  it("agrupa os milhares e mantém a vírgula decimal enquanto digita", () => {
    expect(maskBRL("")).toBe("");
    expect(maskBRL("1")).toBe("1");
    expect(maskBRL("1234")).toBe("1.234");
    expect(maskBRL("1234567")).toBe("1.234.567");
    expect(maskBRL("1234,")).toBe("1.234,");
    expect(maskBRL("1234,5")).toBe("1.234,5");
    expect(maskBRL("1234,56")).toBe("1.234,56");
  });

  it("limita a dois decimais e ignora uma segunda vírgula", () => {
    expect(maskBRL("1234,567")).toBe("1.234,56");
    expect(maskBRL("12,3,4")).toBe("12,34");
  });

  it("tira o prefixo R$, espaços e letras; vírgula sozinha vira 0,", () => {
    expect(maskBRL("R$ 1.234,56")).toBe("1.234,56");
    expect(maskBRL("abc")).toBe("");
    expect(maskBRL(",5")).toBe("0,5");
  });

  it("tira zeros à esquerda da parte inteira, sem apagar o zero antes da vírgula", () => {
    expect(maskBRL("007")).toBe("7");
    expect(maskBRL("0,50")).toBe("0,50");
    expect(maskBRL("000")).toBe("0");
  });
});
