import { describe, expect, it } from "vitest";
import { type CatalogSnapshot, type CatalogUnit, findUnit } from "./catalog";

const unit = (overrides: Partial<CatalogUnit> & Pick<CatalogUnit, "id" | "name">): CatalogUnit => ({
  aliases: [],
  status: "active",
  defaultSalesChannelId: null,
  ...overrides,
});

const catalog = (units: CatalogUnit[]): CatalogSnapshot => ({
  categories: [],
  suppliers: [],
  paymentMethods: [],
  salesChannels: [],
  units,
});

const MATRIZ = unit({ id: "u1", name: "Matriz", aliases: ["centro"] });
const PRAIA = unit({ id: "u2", name: "Praia", aliases: ["litoral"] });

describe("findUnit (DE-25)", () => {
  it("acha a unidade pelo nome ou pelo apelido, sem caixa nem acento", () => {
    const snapshot = catalog([MATRIZ, PRAIA]);
    const all = ["u1", "u2"];
    expect(findUnit(snapshot, "Litoral", all)).toBe(PRAIA);
    expect(findUnit(snapshot, " PRAIA ", all)).toBe(PRAIA);
    expect(findUnit(snapshot, "Centro", all)).toBe(MATRIZ);
  });

  it("não devolve unidade fora do acesso do vínculo", () => {
    expect(findUnit(catalog([MATRIZ, PRAIA]), "litoral", ["u1"])).toBeNull();
  });

  it("não devolve unidade inativa", () => {
    const inactive = unit({ ...PRAIA, status: "inactive" });
    expect(findUnit(catalog([MATRIZ, inactive]), "litoral", ["u1", "u2"])).toBeNull();
  });

  it("sem casamento devolve nulo", () => {
    expect(findUnit(catalog([MATRIZ, PRAIA]), "cozinha", ["u1", "u2"])).toBeNull();
  });
});
