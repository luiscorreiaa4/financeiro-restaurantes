import { describe, expect, it } from "vitest";
import {
  assertUnitAcceptsEntries,
  ensureNotLastActiveUnit,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
  type UnitInput,
  type UnitRecord,
  validateUnit,
} from "./unit";

const CENTRO: UnitRecord = {
  id: "u-centro",
  name: "Centro",
  aliases: ["loja 1"],
  status: "active",
};

function input(overrides: Partial<UnitInput> = {}): UnitInput {
  return {
    name: "Praia",
    aliases: ["litoral"],
    cnpj: null,
    city: "Maceió",
    uf: "AL",
    others: [CENTRO],
    ...overrides,
  };
}

describe("validateUnit (RF04.R1 a R3)", () => {
  it("aceita a unidade com os dados certos e devolve o nome limpo", () => {
    const result = validateUnit(input({ name: "  Praia  " }));
    expect(result).toMatchObject({ ok: true, value: { name: "Praia", uf: "AL" } });
  });

  it("recusa nome duplicado sem diferenciar maiúsculas e acentos (RF04.CA01)", () => {
    const result = validateUnit(input({ name: "centro" }));
    expect(result).toEqual({
      ok: false,
      error: { code: "InvalidUnit", field: "name", reason: "duplicate" },
    });
    expect(validateUnit(input({ name: "CÊNTRO" })).ok).toBe(false);
  });

  it("recusa nome curto ou longo demais", () => {
    expect(validateUnit(input({ name: "A" })).ok).toBe(false);
    expect(validateUnit(input({ name: "x".repeat(61) })).ok).toBe(false);
    expect(validateUnit(input({ name: "x".repeat(60) })).ok).toBe(true);
  });

  it("a própria unidade pode manter o nome ao ser editada", () => {
    const result = validateUnit(input({ name: "Centro", others: [] }));
    expect(result.ok).toBe(true);
  });

  it("aceita até 5 apelidos de até 30 caracteres", () => {
    expect(validateUnit(input({ aliases: ["a1", "a2", "a3", "a4", "a5"] })).ok).toBe(true);
    expect(validateUnit(input({ aliases: ["a1", "a2", "a3", "a4", "a5", "a6"] }))).toEqual({
      ok: false,
      error: { code: "InvalidUnit", field: "aliases", reason: "too_many" },
    });
    expect(validateUnit(input({ aliases: ["x".repeat(31)] }))).toMatchObject({
      ok: false,
      error: { field: "aliases", reason: "invalid" },
    });
  });

  it("apelido repetido na empresa é recusado, inclusive igual ao nome de outra unidade", () => {
    expect(validateUnit(input({ aliases: ["Loja 1"] }))).toMatchObject({
      ok: false,
      error: { field: "aliases", reason: "duplicate" },
    });
    expect(validateUnit(input({ aliases: ["centro"] }))).toMatchObject({
      ok: false,
      error: { field: "aliases", reason: "duplicate" },
    });
    expect(validateUnit(input({ aliases: ["litoral", "LITORAL"] }))).toMatchObject({
      ok: false,
      error: { field: "aliases", reason: "duplicate" },
    });
  });

  it("CNPJ é opcional, mas válido quando informado", () => {
    expect(validateUnit(input({ cnpj: null })).ok).toBe(true);
    expect(validateUnit(input({ cnpj: "11.222.333/0001-81" }))).toMatchObject({
      ok: true,
      value: { cnpj: "11222333000181" },
    });
    expect(validateUnit(input({ cnpj: "11.222.333/0001-82" }))).toEqual({
      ok: false,
      error: { code: "InvalidUnit", field: "cnpj", reason: "invalid" },
    });
  });

  it("município e UF são obrigatórios e a UF precisa existir", () => {
    expect(validateUnit(input({ city: " " }))).toMatchObject({
      ok: false,
      error: { field: "city", reason: "required" },
    });
    expect(validateUnit(input({ uf: "XX" }))).toMatchObject({
      ok: false,
      error: { field: "uf", reason: "invalid" },
    });
    expect(validateUnit(input({ uf: "sp" }))).toMatchObject({ ok: true, value: { uf: "SP" } });
  });

  it("com a lista oficial do IBGE, recusa município fora dela e grava a grafia oficial", () => {
    const cities = ["Maceió", "Marechal Deodoro"];
    expect(validateUnit(input({ city: "Cidade Inventada", cities }))).toMatchObject({
      ok: false,
      error: { field: "city", reason: "invalid" },
    });
    expect(validateUnit(input({ city: "maceio", cities }))).toMatchObject({
      ok: true,
      value: { city: "Maceió" },
    });
  });
});

describe("isValidCnpj", () => {
  it("confere os dígitos verificadores e recusa sequências repetidas", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });

  it("aceita o CNPJ alfanumérico (exemplo oficial do Serpro), com ou sem pontuação e em minúsculas", () => {
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12.abc.345/01de-35")).toBe(true);
    expect(isValidCnpj("12.ABC.345/01DE-34")).toBe(false);
  });

  it("recusa letra nos dígitos verificadores", () => {
    expect(isValidCnpj("12ABC34501DEAB")).toBe(false);
  });
});

describe("normalizeCnpj e formatCnpj", () => {
  it("normaliza para maiúsculas sem pontuação", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(normalizeCnpj(" 11.222.333/0001-81 ")).toBe("11222333000181");
  });

  it("formata 14 posições e devolve o resto como veio", () => {
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatCnpj("1122")).toBe("1122");
  });
});

describe("unidade inativa (RF04.R5)", () => {
  const praia: UnitRecord = { id: "u-praia", name: "Praia", aliases: [], status: "active" };

  it("não deixa inativar a última unidade ativa (RF04.CA02)", () => {
    expect(ensureNotLastActiveUnit([CENTRO], "u-centro")).toEqual({
      ok: false,
      error: { code: "LastActiveUnit" },
    });
  });

  it("deixa inativar quando sobra outra ativa", () => {
    expect(ensureNotLastActiveUnit([CENTRO, praia], "u-centro").ok).toBe(true);
  });

  it("unidade já inativa não conta como ativa", () => {
    const inactive: UnitRecord = { ...praia, status: "inactive" };
    expect(ensureNotLastActiveUnit([CENTRO, inactive], "u-centro").ok).toBe(false);
  });

  it("unidade inativa não recebe lançamento (RF04.CA03)", () => {
    expect(assertUnitAcceptsEntries({ ...praia, status: "inactive" })).toEqual({
      ok: false,
      error: { code: "UnitInactive", unitId: "u-praia" },
    });
    expect(assertUnitAcceptsEntries(praia).ok).toBe(true);
  });
});
