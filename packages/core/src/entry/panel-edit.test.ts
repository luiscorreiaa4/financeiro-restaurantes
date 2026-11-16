import { describe, expect, it } from "vitest";
import { type Money, money } from "../money";
import type { CatalogSnapshot } from "./catalog";
import { createEntry, type Entry } from "./entry";
import { PANEL_FUTURE_DAYS, preparePanelEdit } from "./panel-edit";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error("centavos inválidos");
  return result.value;
};

const TODAY = "2026-11-16";
const CAT_REC = "cat-vendas";
const CAT_QTD = "cat-insumos";
const CAT_OFF = "cat-inativa";

const catalog: CatalogSnapshot = {
  categories: [
    { id: CAT_REC, name: "Vendas", kind: "revenue" },
    { id: CAT_QTD, name: "Insumos", kind: "expense", requiresQuantity: true },
    { id: CAT_OFF, name: "Antiga", kind: "expense", status: "inactive" },
  ],
  suppliers: [{ id: "forn-1", name: "Atacadão", aliases: [] }],
  paymentMethods: [
    {
      id: "pix",
      name: "Pix",
      type: "pix",
      aliases: [],
      status: "active",
      isDefaultCard: false,
      feePercentBp: 0,
      feeFixedCents: 0,
    },
    {
      id: "credito",
      name: "Crédito",
      type: "credit",
      aliases: [],
      status: "active",
      isDefaultCard: true,
      feePercentBp: 320,
      feeFixedCents: 0,
    },
    {
      id: "velha",
      name: "Velha",
      type: "other",
      aliases: [],
      status: "inactive",
      isDefaultCard: false,
      feePercentBp: 0,
      feeFixedCents: 0,
    },
  ],
  salesChannels: [
    {
      id: "salao",
      name: "Salão",
      type: "dine_in",
      aliases: [],
      status: "active",
      feePercentBp: 0,
    },
    {
      id: "ifood",
      name: "iFood",
      type: "app",
      aliases: [],
      status: "active",
      feePercentBp: 2300,
    },
  ],
  units: [{ id: "u1", name: "Centro", aliases: [], status: "active", defaultSalesChannelId: null }],
} as unknown as CatalogSnapshot;

function revenue(): Entry {
  const result = createEntry(
    {
      unitId: "u1",
      type: "revenue",
      occurredOn: "2026-11-10",
      description: "Almoço",
      quantity: null,
      quantityUnit: null,
      amountCents: m(10000),
      feePercentBp: 320,
      feeFixedCents: 0,
      categoryId: CAT_REC,
      supplierId: null,
      paymentMethodId: "credito",
      salesChannelId: "salao",
      inboundMessageId: null,
    },
    {
      actorId: "01890a5d-ac96-774b-bcce-b302099a8059",
      channel: "web",
      at: new Date("2026-11-10T12:00:00Z"),
      id: "01890a5d-ac96-774b-bcce-b302099a8057",
      tenantId: "01890a5d-ac96-774b-bcce-b302099a8058",
    },
  );
  if (!result.ok) throw new Error("criação falhou");
  return result.value.entry;
}

const run = (patch: Parameters<typeof preparePanelEdit>[0]["patch"], entry = revenue()) =>
  preparePanelEdit({ entry, patch, catalog, today: TODAY });

describe("edição pelo painel: data de competência futura (RF23.R1)", () => {
  it("o limite é de 60 dias", () => {
    expect(PANEL_FUTURE_DAYS).toBe(60);
  });

  it("aceita hoje mais 60 dias", () => {
    // 2026-11-16 + 60 dias = 2027-01-15
    const result = run({ occurredOn: "2027-01-15" });
    expect(result.ok).toBe(true);
  });

  it("recusa hoje mais 61 dias", () => {
    const result = run({ occurredOn: "2027-01-16" });
    expect(result).toMatchObject({ ok: false, error: { code: "DateTooFarAhead" } });
  });

  it("conta os dias por data de negócio, sem depender do fuso da máquina", () => {
    // 2026-12-31 + 60 dias cruza a virada do ano: 2027-03-01
    const ok = preparePanelEdit({
      entry: revenue(),
      patch: { occurredOn: "2027-03-01" },
      catalog,
      today: "2026-12-31",
    });
    const bad = preparePanelEdit({
      entry: revenue(),
      patch: { occurredOn: "2027-03-02" },
      catalog,
      today: "2026-12-31",
    });
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });

  it("aceita data passada", () => {
    expect(run({ occurredOn: "2025-01-01" }).ok).toBe(true);
  });

  it("recusa data de competência que não é uma data válida", () => {
    expect(run({ occurredOn: "2026-02-30" })).toMatchObject({
      ok: false,
      error: { code: "InvalidBusinessDate" },
    });
  });
});

describe("edição pelo painel: taxas copiadas (RF23.Obs4)", () => {
  it("trocar só a descrição não mexe nas taxas copiadas", () => {
    const result = run({ description: "Jantar" });
    expect(result).toEqual({ ok: true, value: { description: "Jantar" } });
  });

  it("trocar o valor não recopia as taxas (o líquido é recalculado fora, pelo editEntry)", () => {
    const result = run({ amountCents: 20000 });
    expect(result).toEqual({ ok: true, value: { amountCents: 20000 } });
  });

  it("trocar a forma de pagamento recopia a taxa da nova forma", () => {
    const result = run({ paymentMethodId: "pix" });
    expect(result).toEqual({
      ok: true,
      value: { paymentMethodId: "pix", feePercentBp: 0, feeFixedCents: 0 },
    });
  });

  it("trocar para um canal de aplicativo troca a taxa pela comissão do canal", () => {
    const result = run({ salesChannelId: "ifood" });
    expect(result).toEqual({
      ok: true,
      value: { salesChannelId: "ifood", feePercentBp: 2300, feeFixedCents: 0 },
    });
  });

  it("enviar a mesma forma que o lançamento já tem não recopia a taxa", () => {
    const result = run({ paymentMethodId: "credito", description: "Jantar" });
    expect(result).toEqual({
      ok: true,
      value: { paymentMethodId: "credito", description: "Jantar" },
    });
  });

  it("limpar a forma de pagamento recopia sem taxa de forma", () => {
    const result = run({ paymentMethodId: null });
    expect(result).toEqual({
      ok: true,
      value: { paymentMethodId: null, feePercentBp: 0, feeFixedCents: 0 },
    });
  });

  it("despesa nunca ganha taxa ao trocar a forma de pagamento", () => {
    const expense: Entry = {
      ...revenue(),
      type: "expense",
      salesChannelId: null,
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: null,
    };
    const result = run({ paymentMethodId: "credito" }, expense);
    expect(result).toEqual({ ok: true, value: { paymentMethodId: "credito" } });
  });

  it("trocar o tipo para receita junto da forma já recopia a taxa", () => {
    const expense: Entry = {
      ...revenue(),
      type: "expense",
      salesChannelId: null,
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: null,
    };
    const result = run({ type: "revenue", salesChannelId: "ifood" }, expense);
    expect(result).toMatchObject({
      ok: true,
      value: { type: "revenue", salesChannelId: "ifood", feePercentBp: 2300 },
    });
  });
});

describe("edição pelo painel: troca só do tipo (RF23.Obs4)", () => {
  it("trocar só o tipo para receita copia a taxa da forma e do canal atuais", () => {
    const expense: Entry = {
      ...revenue(),
      type: "expense",
      salesChannelId: "ifood",
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: null,
    };
    const result = run({ type: "revenue" }, expense);
    expect(result).toEqual({
      ok: true,
      value: { type: "revenue", feePercentBp: 2300, feeFixedCents: 0 },
    });
  });

  it("trocar só o tipo para despesa zera as taxas copiadas", () => {
    const result = run({ type: "expense" });
    expect(result).toEqual({
      ok: true,
      value: { type: "expense", feePercentBp: 0, feeFixedCents: 0 },
    });
  });

  it("enviar o mesmo tipo não mexe nas taxas", () => {
    const result = run({ type: "revenue", description: "Jantar" });
    expect(result).toEqual({
      ok: true,
      value: { type: "revenue", description: "Jantar" },
    });
  });
});

describe("edição pelo painel: quantidade exigida pela categoria (RF12.R4)", () => {
  const expense = (overrides: Partial<Entry> = {}): Entry => ({
    ...revenue(),
    type: "expense",
    salesChannelId: null,
    feePercentBp: 0,
    feeFixedCents: 0,
    categoryId: null,
    ...overrides,
  });

  it("recusa trocar para categoria que exige quantidade sem informar a quantidade", () => {
    expect(run({ categoryId: CAT_QTD }, expense())).toMatchObject({
      ok: false,
      error: { code: "QuantityRequired" },
    });
  });

  it("aceita a categoria que exige quantidade com quantidade e unidade no mesmo patch", () => {
    const result = run({ categoryId: CAT_QTD, quantity: 5, quantityUnit: "kg" }, expense());
    expect(result.ok).toBe(true);
  });

  it("aceita quando o lançamento já tinha quantidade e unidade", () => {
    const entry = expense({ quantity: 3, quantityUnit: "kg" });
    expect(run({ categoryId: CAT_QTD }, entry).ok).toBe(true);
  });

  it("recusa limpar a quantidade de lançamento em categoria que a exige", () => {
    const entry = expense({ categoryId: CAT_QTD, quantity: 3, quantityUnit: "kg" });
    expect(run({ quantity: null }, entry)).toMatchObject({
      ok: false,
      error: { code: "QuantityRequired" },
    });
  });

  it("editar só a descrição de lançamento antigo sem quantidade não é barrado", () => {
    const entry = expense({ categoryId: CAT_QTD });
    expect(run({ description: "Ajuste" }, entry).ok).toBe(true);
  });
});

describe("edição pelo painel: referências no catálogo", () => {
  it.each([
    ["categoria inexistente", { categoryId: "nao-existe" }, "category"],
    ["categoria inativa", { categoryId: CAT_OFF }, "category"],
    ["forma de pagamento inexistente", { paymentMethodId: "nao-existe" }, "payment_method"],
    ["forma de pagamento inativa", { paymentMethodId: "velha" }, "payment_method"],
    ["canal inexistente", { salesChannelId: "nao-existe" }, "sales_channel"],
    ["fornecedor inexistente", { supplier: { id: "nao-existe" } }, "supplier"],
    ["unidade inexistente", { unitId: "nao-existe" }, "unit"],
  ] as const)("recusa %s", (_nome, patch, field) => {
    expect(run(patch)).toMatchObject({
      ok: false,
      error: { code: "UnknownReference", field },
    });
  });

  it("aceita fornecedor existente e devolve o supplierId", () => {
    expect(run({ supplier: { id: "forn-1" } })).toEqual({
      ok: true,
      value: { supplierId: "forn-1" },
    });
  });

  it("limpar o fornecedor devolve supplierId nulo", () => {
    expect(run({ supplier: null })).toEqual({ ok: true, value: { supplierId: null } });
  });

  it("não valida referência que o patch não toca (lançamento antigo com cadastro desativado)", () => {
    const entry = { ...revenue(), paymentMethodId: "velha" };
    expect(run({ description: "Ajuste" }, entry).ok).toBe(true);
  });
});
