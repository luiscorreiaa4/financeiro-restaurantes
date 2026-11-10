import { describe, expect, it } from "vitest";
import { applyMask, CNPJ_MASK, maskBrPhone, maskCnpj, PHONE_MASK } from "./input-masks";

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
