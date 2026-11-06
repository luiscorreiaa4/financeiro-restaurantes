import { describe, expect, it } from "vitest";
import { type CategoryRecord, type NewSubcategoryInput, validateSubcategory } from "./category";

const CARNES: CategoryRecord = {
  id: "c-carnes",
  parentId: null,
  origin: "system",
  name: "Carnes",
  kind: "expense",
  nature: "variable",
  dreGroup: "cmv",
  isSensitive: false,
  requiresQuantity: true,
  status: "active",
};

const SALARIOS: CategoryRecord = {
  ...CARNES,
  id: "c-salarios",
  name: "Salários",
  nature: "fixed",
  dreGroup: "pessoal",
  isSensitive: true,
  requiresQuantity: false,
};

function input(overrides: Partial<NewSubcategoryInput> = {}): NewSubcategoryInput {
  return {
    name: "Frutos do mar",
    parent: CARNES,
    siblings: [],
    nature: null,
    isSensitive: false,
    supportWords: [],
    ...overrides,
  };
}

describe("validateSubcategory (RF07)", () => {
  it("herda tipo, grupo do DRE e exige quantidade da categoria pai (RF07.CA02)", () => {
    expect(validateSubcategory(input())).toEqual({
      ok: true,
      value: {
        name: "Frutos do mar",
        parentId: "c-carnes",
        kind: "expense",
        nature: "variable",
        dreGroup: "cmv",
        isSensitive: false,
        requiresQuantity: true,
        supportWords: [],
        origin: "company",
        status: "active",
      },
    });
  });

  it("a subcategoria pode trocar a natureza, só em despesa (RF07.R4)", () => {
    expect(validateSubcategory(input({ nature: "fixed" }))).toMatchObject({
      ok: true,
      value: { nature: "fixed" },
    });
    const revenue: CategoryRecord = {
      ...CARNES,
      kind: "revenue",
      nature: null,
      dreGroup: "receita_bruta",
    };
    expect(validateSubcategory(input({ parent: revenue, nature: "fixed" }))).toMatchObject({
      ok: false,
      error: { code: "InvalidCategory", field: "nature" },
    });
  });

  it("subcategoria de categoria sensível é sempre sensível (RF07.CA03)", () => {
    const result = validateSubcategory(
      input({ name: "13º salário", parent: SALARIOS, isSensitive: false }),
    );
    expect(result).toMatchObject({ ok: true, value: { isSensitive: true } });
  });

  it("recusa nome duplicado entre irmãs, sem diferenciar maiúsculas e acentos (RF07.R1)", () => {
    const sibling = { name: "Frutos do Mar" };
    expect(validateSubcategory(input({ siblings: [sibling] }))).toEqual({
      ok: false,
      error: { code: "InvalidCategory", field: "name", reason: "duplicate" },
    });
    expect(validateSubcategory(input({ name: "F" })).ok).toBe(false);
  });

  it("no máximo dois níveis: não cria subcategoria de subcategoria (RF07.R2)", () => {
    const child: CategoryRecord = { ...CARNES, id: "c-filha", parentId: "c-carnes" };
    expect(validateSubcategory(input({ parent: child }))).toEqual({
      ok: false,
      error: { code: "InvalidCategory", field: "parent", reason: "too_deep" },
    });
  });

  it("categoria da empresa é sempre filha de uma categoria padrão (RF07.R2)", () => {
    const own: CategoryRecord = { ...CARNES, origin: "company" };
    expect(validateSubcategory(input({ parent: own }))).toMatchObject({
      ok: false,
      error: { field: "parent", reason: "not_system" },
    });
  });

  it("não cria sob categoria inativa", () => {
    const inactive: CategoryRecord = { ...CARNES, status: "inactive" };
    expect(validateSubcategory(input({ parent: inactive }))).toMatchObject({
      ok: false,
      error: { field: "parent", reason: "inactive" },
    });
  });

  it("palavras de apoio: até 30, cada uma com até 40 caracteres (RF07.R8)", () => {
    const words = Array.from({ length: 30 }, (_, i) => `palavra${i}`);
    expect(validateSubcategory(input({ supportWords: words })).ok).toBe(true);
    expect(validateSubcategory(input({ supportWords: [...words, "mais uma"] }))).toMatchObject({
      ok: false,
      error: { field: "supportWords", reason: "too_many" },
    });
    expect(validateSubcategory(input({ supportWords: ["x".repeat(41)] }))).toMatchObject({
      ok: false,
      error: { field: "supportWords", reason: "invalid" },
    });
  });
});
