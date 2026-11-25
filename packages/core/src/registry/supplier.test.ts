import { describe, expect, it } from "vitest";
import {
  isValidCpf,
  maskCpf,
  normalizeDocument,
  planSupplierMerge,
  type Supplier,
  validateSupplierPatch,
} from "./supplier";

const supplier = (overrides: Partial<Supplier> = {}): Supplier => ({
  id: "f1",
  name: "Atacadão",
  aliases: [],
  document: null,
  status: "active",
  mergedIntoId: null,
  ...overrides,
});

describe("isValidCpf", () => {
  it("aceita CPF válido e recusa dígito errado ou sequência repetida", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("1234")).toBe(false);
  });
});

describe("normalizeDocument", () => {
  it("reconhece CPF e CNPJ com ou sem máscara", () => {
    expect(normalizeDocument("529.982.247-25")).toEqual({
      ok: true,
      value: { kind: "cpf", digits: "52998224725" },
    });
    expect(normalizeDocument("11.222.333/0001-81")).toEqual({
      ok: true,
      value: { kind: "cnpj", digits: "11222333000181" },
    });
  });

  it("recusa dígitos inválidos ou tamanho errado", () => {
    expect(normalizeDocument("52998224724").ok).toBe(false);
    expect(normalizeDocument("11222333000180").ok).toBe(false);
    expect(normalizeDocument("123").ok).toBe(false);
  });
});

describe("maskCpf", () => {
  it("esconde os seis primeiros dígitos", () => {
    expect(maskCpf("12345678901")).toBe("•••.•••.789-01");
  });
});

describe("validateSupplierPatch (RF10)", () => {
  const others = [
    supplier({ id: "f2", name: "Padaria", aliases: ["pão"], document: "11222333000181" }),
  ];

  it("aplica nome, apelidos e documento normalizados", () => {
    const result = validateSupplierPatch(
      supplier(),
      { name: " Atacadão SP ", aliases: ["atacado", "ATACADO"], document: "529.982.247-25" },
      others,
    );
    expect(result).toEqual({
      ok: true,
      value: { name: "Atacadão SP", aliases: ["atacado"], document: "52998224725" },
    });
  });

  it("documento nulo limpa; inválido falha", () => {
    expect(
      validateSupplierPatch(supplier({ document: "52998224725" }), { document: null }, others),
    ).toEqual({
      ok: true,
      value: { document: null },
    });
    expect(validateSupplierPatch(supplier(), { document: "123" }, others).ok).toBe(false);
  });

  it("recusa nome curto, mais de 10 apelidos e colisão de nome ou apelido", () => {
    expect(validateSupplierPatch(supplier(), { name: "A" }, others).ok).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => `apelido ${i}`);
    expect(validateSupplierPatch(supplier(), { aliases: many }, others)).toEqual({
      ok: false,
      error: { code: "AliasesTooMany", max: 10 },
    });
    expect(validateSupplierPatch(supplier(), { aliases: ["PAO"] }, others)).toEqual({
      ok: false,
      error: { code: "NameTaken", conflictId: "f2" },
    });
  });

  it("documento de fornecedor já mesclado pode ser usado de novo", () => {
    const merged = others.map((o) => ({ ...o, mergedIntoId: "f9" }));
    const result = validateSupplierPatch(supplier(), { document: "11222333000181" }, merged);
    expect(result.ok).toBe(true);
  });

  it("documento já usado por outro fornecedor", () => {
    expect(validateSupplierPatch(supplier(), { document: "11222333000181" }, others)).toEqual({
      ok: false,
      error: { code: "DocumentTaken", conflictId: "f2" },
    });
  });

  it("fornecedor mesclado não é editável", () => {
    expect(
      validateSupplierPatch(supplier({ mergedIntoId: "f2" }), { name: "X Y" }, others),
    ).toEqual({
      ok: false,
      error: { code: "AlreadyMerged" },
    });
  });
});

describe("planSupplierMerge (RF10)", () => {
  const source = supplier({ id: "fa", name: "Atacado A", aliases: ["o atacado"] });
  const target = supplier({ id: "fb", name: "Atacado B", aliases: ["Atacadão"] });

  it("soma apelidos do destino, nome e apelidos da origem, sem repetir", () => {
    const result = planSupplierMerge({ ...source, aliases: ["o atacado", "ATACADAO"] }, target);
    expect(result).toEqual({
      ok: true,
      value: {
        target: { aliases: ["Atacadão", "Atacado A", "o atacado"], document: null },
        source: { status: "inactive", mergedIntoId: "fb" },
      },
    });
  });

  it("leva o documento da origem se o destino não tem", () => {
    const result = planSupplierMerge({ ...source, document: "11222333000181" }, target);
    expect(result.ok && result.value.target.document).toBe("11222333000181");
  });

  it("dois documentos diferentes conflitam; iguais não", () => {
    const a = { ...source, document: "11222333000181" };
    expect(planSupplierMerge(a, { ...target, document: "52998224725" })).toEqual({
      ok: false,
      error: { code: "DocumentConflict" },
    });
    expect(planSupplierMerge(a, { ...target, document: "11222333000181" }).ok).toBe(true);
  });

  it("11 apelidos somados estouram", () => {
    const full = supplier({
      id: "fb",
      name: "B",
      aliases: Array.from({ length: 10 }, (_, i) => `a${i}`),
    });
    expect(planSupplierMerge(source, full)).toEqual({
      ok: false,
      error: { code: "AliasesOverflow", max: 10 },
    });
  });

  it("mesmo fornecedor e origem já mesclada", () => {
    expect(planSupplierMerge(source, source)).toEqual({
      ok: false,
      error: { code: "SameSupplier" },
    });
    expect(planSupplierMerge({ ...source, mergedIntoId: "fz" }, target)).toEqual({
      ok: false,
      error: { code: "AlreadyMerged" },
    });
  });
});
