import { describe, expect, it } from "vitest";
import {
  type CatalogSnapshot,
  type CatalogUnit,
  findSupplier,
  findUnit,
  pickUnit,
  resolveSupplierChoice,
} from "./catalog";

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

describe("pickUnit (DE-25)", () => {
  const COZINHA = unit({ id: "u3", name: "Cozinha" });
  const snapshot = catalog([COZINHA, MATRIZ, PRAIA]);
  const base = { catalog: snapshot, citedUnitId: null, hint: null, defaultUnitId: null };

  it("a unidade citada no texto vale mais que a dica da IA e que a padrão", () => {
    const picked = pickUnit({
      ...base,
      citedUnitId: "u2",
      hint: "centro",
      defaultUnitId: "u1",
      accessibleIds: ["u1", "u2"],
    });
    expect(picked).toBe("u2");
  });

  it("a dica da IA vale mais que a padrão, pelo nome ou apelido", () => {
    const picked = pickUnit({
      ...base,
      hint: "Litoral",
      defaultUnitId: "u1",
      accessibleIds: ["u1", "u2"],
    });
    expect(picked).toBe("u2");
  });

  it("dica sem casamento ou fora do acesso cai na padrão", () => {
    expect(
      pickUnit({ ...base, hint: "cozinha2", defaultUnitId: "u1", accessibleIds: ["u1", "u2"] }),
    ).toBe("u1");
    expect(pickUnit({ ...base, hint: "litoral", defaultUnitId: "u1", accessibleIds: ["u1"] })).toBe(
      "u1",
    );
  });

  it("unidade citada fora do acesso não vale", () => {
    expect(
      pickUnit({ ...base, citedUnitId: "u2", defaultUnitId: "u1", accessibleIds: ["u1"] }),
    ).toBe("u1");
  });

  it("padrão fora do acesso não vale", () => {
    expect(pickUnit({ ...base, defaultUnitId: "u3", accessibleIds: ["u1", "u2"] })).toBe("u1");
  });

  it("sem padrão, usa a primeira unidade ativa a que o colaborador tem acesso, nunca a primeira do cadastro", () => {
    // A primeira do cadastro (Cozinha) está fora do acesso.
    expect(pickUnit({ ...base, accessibleIds: ["u1", "u2"] })).toBe("u1");
  });

  it("unidade padrão inativa é devolvida para o lançamento ser recusado (RF04.R5)", () => {
    const inactive = unit({ ...PRAIA, status: "inactive" });
    const picked = pickUnit({
      ...base,
      catalog: catalog([MATRIZ, inactive]),
      defaultUnitId: "u2",
      accessibleIds: ["u1", "u2"],
    });
    expect(picked).toBe("u2");
  });

  it("sem nenhuma unidade de acesso devolve nulo", () => {
    expect(pickUnit({ ...base, accessibleIds: [] })).toBeNull();
  });
});

describe("findSupplier (RF12.R7)", () => {
  const supplier = { id: "f1", name: "Atacadão", aliases: ["atacadao sp"] };
  const withSuppliers = { ...catalog([]), suppliers: [supplier] };

  it("acha o fornecedor pelo nome ou pelo apelido, sem caixa nem acento", () => {
    expect(findSupplier(withSuppliers, "  ATACADAO ")).toBe(supplier);
    expect(findSupplier(withSuppliers, "Atacadao SP")).toBe(supplier);
  });

  it("sem casamento devolve nulo", () => {
    expect(findSupplier(withSuppliers, "Padaria")).toBeNull();
  });
});

describe("resolveSupplierChoice (RF12.R7, RF10)", () => {
  const withSuppliers: CatalogSnapshot = {
    ...catalog([]),
    suppliers: [{ id: "s1", name: "Atacadão", aliases: ["atacadao sul"] }],
  };
  const newId = () => "novo-id";

  it("ausente ou nulo não associa fornecedor", () => {
    expect(resolveSupplierChoice(withSuppliers, null, newId)).toEqual({ supplierId: null });
  });

  it("id é repassado, mesmo que não exista (a validação é do domínio)", () => {
    expect(resolveSupplierChoice(withSuppliers, { id: "zzz" }, newId)).toEqual({
      supplierId: "zzz",
    });
  });

  it("nome igual a um cadastrado, em outra caixa e com espaços, associa o existente", () => {
    expect(resolveSupplierChoice(withSuppliers, { name: "  ATACADAO  " }, newId)).toEqual({
      supplierId: "s1",
    });
    expect(resolveSupplierChoice(withSuppliers, { name: "Atacadao Sul" }, newId)).toEqual({
      supplierId: "s1",
    });
  });

  it("nome desconhecido cria um fornecedor novo com o id dado", () => {
    expect(resolveSupplierChoice(withSuppliers, { name: "Padaria Pão" }, newId)).toEqual({
      supplierId: "novo-id",
      newSupplier: { id: "novo-id", name: "Padaria Pão" },
    });
  });
});
