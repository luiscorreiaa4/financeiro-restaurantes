import { describe, expect, it } from "vitest";
import { normalizeBrazilianPhone, toWaId } from "./phone";

describe("telefone brasileiro: celular", () => {
  it("caso real: wa_id da Meta sem o 9 vira o canônico com o 9", () => {
    const result = normalizeBrazilianPhone("551187654321");
    expect(result).toMatchObject({
      ok: true,
      value: {
        e164: "+5511987654321",
        kind: "mobile",
        withNinthDigit: "+5511987654321",
        withoutNinthDigit: "+551187654321",
      },
    });
  });

  it("celular já com o 9 mantém o canônico e oferece a variante sem o 9", () => {
    const result = normalizeBrazilianPhone("5511987654321");
    expect(result).toMatchObject({
      ok: true,
      value: {
        e164: "+5511987654321",
        withNinthDigit: "+5511987654321",
        withoutNinthDigit: "+551187654321",
      },
    });
  });

  it("as duas formas do mesmo celular geram exatamente o mesmo resultado", () => {
    expect(normalizeBrazilianPhone("551187654321")).toEqual(
      normalizeBrazilianPhone("5511987654321"),
    );
  });

  it("candidatos de busca trazem o canônico primeiro, com e sem o 9", () => {
    const result = normalizeBrazilianPhone("551187654321");
    expect(result.ok && result.value.lookupCandidates).toEqual(["+5511987654321", "+551187654321"]);
  });

  it.each([
    ["+55 (11) 98765-4321"],
    ["(11) 98765-4321"],
    ["11987654321"],
    ["011987654321"],
    ["0055 11 98765 4321"],
    ["+55 11 8765-4321"],
    ["1187654321"],
  ])("entende o formato digitado %s", (input) => {
    const result = normalizeBrazilianPhone(input);
    expect(result.ok && result.value.e164).toBe("+5511987654321");
  });

  it("celular do DDD 55 (RS) não confunde o DDD com o código do país", () => {
    const result = normalizeBrazilianPhone("55987654321");
    expect(result.ok && result.value.e164).toBe("+5555987654321");
  });
});

describe("telefone brasileiro: fixo", () => {
  it("fixo não ganha 9º dígito e não tem variante", () => {
    const result = normalizeBrazilianPhone("551132345678");
    expect(result).toMatchObject({
      ok: true,
      value: {
        e164: "+551132345678",
        kind: "landline",
        withNinthDigit: "+551132345678",
        withoutNinthDigit: "+551132345678",
        lookupCandidates: ["+551132345678"],
      },
    });
  });

  it("aceita fixo digitado com máscara", () => {
    const result = normalizeBrazilianPhone("(11) 3234-5678");
    expect(result.ok && result.value.e164).toBe("+551132345678");
  });
});

describe("telefone brasileiro: inválidos", () => {
  it.each([
    ["", "empty"],
    ["abc", "empty"],
    ["12345", "length"],
    ["+1 415 555 2671", "number"], // 11 dígitos sem código de país: lido como nacional
    ["5511987654321999", "length"],
    ["1087654321", "area_code"],
    ["2087654321", "area_code"],
    ["11887654321", "number"], // 9 dígitos que não começam com 9
    ["1101234567", "number"], // assinante de 8 dígitos começando com 0
  ])("rejeita %j (%s)", (input, reason) => {
    expect(normalizeBrazilianPhone(input)).toEqual({
      ok: false,
      error: { code: "InvalidPhone", reason },
    });
  });
});

describe("wa_id", () => {
  it("é o E.164 sem o +", () => {
    expect(toWaId("+5511987654321")).toBe("5511987654321");
  });
});
