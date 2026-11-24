import { describe, expect, it } from "vitest";
import { findNameCollision, validateAliases, validateCatalogName } from "./names";

describe("validateCatalogName", () => {
  const bounds = { min: 2, max: 40 };
  it("apara e aceita", () => {
    expect(validateCatalogName("  Crédito ", bounds)).toEqual({ ok: true, value: "Crédito" });
  });
  it("recusa curto e longo", () => {
    for (const v of ["a", " b ", "x".repeat(41)]) {
      const r = validateCatalogName(v, bounds);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("InvalidName");
    }
  });
});

describe("validateAliases", () => {
  const bounds = { max: 10, maxLength: 40 };
  it("apara, descarta vazio e deduplica pelo normalizado", () => {
    const r = validateAliases([" VR ", "", "vr", "Maquininha", "  "], bounds);
    expect(r).toEqual({ ok: true, value: ["VR", "Maquininha"] });
  });
  it("recusa 11 apelidos", () => {
    const many = Array.from({ length: 11 }, (_, i) => `apelido${i}`);
    const r = validateAliases(many, bounds);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("AliasesTooMany");
  });
  it("recusa apelido comprido", () => {
    const r = validateAliases(["x".repeat(41)], bounds);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("AliasTooLong");
  });
});

describe("findNameCollision", () => {
  const existing = [
    { id: "1", name: "Crédito", aliases: ["cartão"] },
    { id: "2", name: "Pix", aliases: [] },
  ];
  it("compara sem caixa nem acento", () => {
    expect(findNameCollision({ name: "credito", aliases: [] }, existing)).toBe("1");
    expect(
      findNameCollision({ name: "CENTRO", aliases: [] }, [
        { id: "9", name: "centro", aliases: [] },
      ]),
    ).toBe("9");
  });
  it("apelido novo colide com nome e com apelido de outra", () => {
    expect(findNameCollision({ name: "Outro", aliases: ["PIX"] }, existing)).toBe("2");
    expect(findNameCollision({ name: "Outro", aliases: ["Cartao"] }, existing)).toBe("1");
  });
  it("nome novo colide com apelido de outra", () => {
    expect(findNameCollision({ name: "cartao", aliases: [] }, existing)).toBe("1");
  });
  it("ignora o próprio id", () => {
    expect(
      findNameCollision({ id: "1", name: "Crédito", aliases: ["cartão"] }, existing),
    ).toBeNull();
  });
  it("sem colisão devolve null", () => {
    expect(findNameCollision({ name: "Vale", aliases: ["VR"] }, existing)).toBeNull();
  });
});
