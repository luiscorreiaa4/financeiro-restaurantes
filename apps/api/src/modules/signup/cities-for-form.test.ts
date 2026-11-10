import type { BusinessDate } from "@app/core";
import { describe, expect, it } from "vitest";
import { citiesForForm } from "./cities-for-form";
import { createCreateCompany } from "./create-company";

const form = (city: string, uf = "AL") => ({
  owner: {},
  company: { tradeName: "Bar do Zé", segment: "bar" },
  unit: { name: "Centro", city, uf },
  terms: { accepted: true },
});

describe("citiesForForm", () => {
  it("carrega os municípios da UF do formulário, aceitando minúsculas e espaços", async () => {
    expect(await citiesForForm(form("x", " al "))).toContain("Maceió");
  });

  it("devolve undefined quando a UF falta ou é inválida (o erro é do uf_invalid)", async () => {
    expect(await citiesForForm(form("x", "ZZ"))).toBeUndefined();
    expect(await citiesForForm({})).toBeUndefined();
    expect(await citiesForForm({ unit: { uf: 12 } })).toBeUndefined();
  });
});

describe("município na criação de empresa (DD-29)", () => {
  const explode = () => {
    throw new Error("não podia gravar");
  };
  const create = createCreateCompany({
    repo: { createCompany: explode },
    users: { findUserPhone: async () => "+5582996585647" },
    clock: {
      now: () => new Date("2026-11-10T12:00:00Z"),
      today: () => "2026-11-10" as BusinessDate,
    },
    newId: () => "id",
  });
  const run = (city: string) =>
    create({
      userId: "u1",
      email: "dona@exemplo.com",
      form: form(city),
      ip: undefined,
      userAgent: undefined,
    });

  it("recusa município que não existe na UF e não grava nada", async () => {
    const result = await run("Cidade Inventada");
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_fields", fields: { "unit.city": "city_invalid" } },
    });
  });

  it("recusa município de outra UF", async () => {
    const result = await run("Recife");
    expect(result.ok).toBe(false);
  });
});
