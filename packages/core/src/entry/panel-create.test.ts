import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "./catalog";
import { OLD_DATE_DAYS } from "./interpret";
import { type PanelCreateInput, preparePanelCreate } from "./panel-create";
import { PANEL_FUTURE_DAYS } from "./panel-edit";
import { QUANTITY_UNITS, toQuantityUnit } from "./quantity-units";

const TODAY = "2026-11-16";

const catalog = {
  categories: [
    { id: "cat-vendas", name: "Vendas", kind: "revenue" },
    { id: "cat-insumos", name: "Insumos", kind: "expense", requiresQuantity: true },
    { id: "cat-gas", name: "Gás", kind: "expense" },
    { id: "cat-inativa", name: "Antiga", kind: "expense", status: "inactive" },
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
    { id: "salao", name: "Salão", type: "dine_in", aliases: [], status: "active", feePercentBp: 0 },
    { id: "ifood", name: "iFood", type: "app", aliases: [], status: "active", feePercentBp: 2300 },
    { id: "velho", name: "Velho", type: "other", aliases: [], status: "inactive", feePercentBp: 0 },
  ],
  units: [
    { id: "u1", name: "Centro", aliases: [], status: "active", defaultSalesChannelId: null },
    { id: "u2", name: "Norte", aliases: [], status: "inactive", defaultSalesChannelId: null },
  ],
} as unknown as CatalogSnapshot;

const expenseInput = (over: Partial<PanelCreateInput> = {}): PanelCreateInput => ({
  type: "expense",
  occurredOn: "2026-11-15",
  description: "Botijão de gás",
  amountCents: 12000,
  categoryId: "cat-gas",
  unitId: "u1",
  supplier: null,
  paymentMethodId: null,
  salesChannelId: null,
  orders: null,
  quantity: null,
  quantityUnit: null,
  ...over,
});

const revenueInput = (over: Partial<PanelCreateInput> = {}): PanelCreateInput =>
  expenseInput({
    type: "revenue",
    description: "Almoço",
    categoryId: "cat-vendas",
    salesChannelId: "salao",
    paymentMethodId: "credito",
    ...over,
  });

const run = (
  input: PanelCreateInput,
  recent: Parameters<typeof preparePanelCreate>[0]["recent"] = [],
  today = TODAY,
) => preparePanelCreate({ input, catalog, today, recent });

const draftOf = (input: PanelCreateInput, recent = [] as never[]) => {
  const result = run(input, recent);
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.error.code}`);
  return result.value;
};

describe("unidades de medida do painel (RF12.R4)", () => {
  it("a lista é a do requisito", () => {
    expect(QUANTITY_UNITS).toEqual([
      "KG",
      "G",
      "L",
      "ML",
      "UN",
      "DZ",
      "CX",
      "PCT",
      "FD",
      "SC",
      "OUTRA",
    ]);
  });

  it("toQuantityUnit ignora a caixa e recusa o que não é da lista", () => {
    expect(toQuantityUnit("kg")).toBe("KG");
    expect(toQuantityUnit(" Outra ")).toBe("OUTRA");
    expect(toQuantityUnit("xx")).toBeNull();
    expect(toQuantityUnit("")).toBeNull();
  });
});

describe("criação pelo painel: datas (RF26.R2)", () => {
  it("o limite futuro é o mesmo da edição, 60 dias", () => {
    expect(PANEL_FUTURE_DAYS).toBe(60);
  });

  it("aceita competência hoje mais 60 dias", () => {
    expect(run(expenseInput({ occurredOn: "2027-01-15" })).ok).toBe(true);
  });

  it("recusa competência hoje mais 61 dias", () => {
    expect(run(expenseInput({ occurredOn: "2027-01-16" }))).toMatchObject({
      ok: false,
      error: { code: "DateTooFarAhead", maxDate: "2027-01-15" },
    });
  });

  it("usa o hoje recebido, que quem chama resolve no fuso da unidade escolhida", () => {
    // 23h30 em São Paulo é 22h30 em Manaus: o mesmo instante dá "hoje" diferente por unidade.
    const input = expenseInput({ occurredOn: "2027-01-16" });
    expect(run(input, [], "2026-11-17").ok).toBe(true);
    expect(run(input, [], "2026-11-16").ok).toBe(false);
  });

  it("mais de 60 dias atrás grava com old_date", () => {
    const draft = draftOf(expenseInput({ occurredOn: "2026-09-16" }));
    expect(draft.flags).toContain("old_date");
  });

  it("exatamente 60 dias atrás não ganha old_date", () => {
    expect(OLD_DATE_DAYS).toBe(60);
    expect(draftOf(expenseInput({ occurredOn: "2026-09-17" })).flags).not.toContain("old_date");
  });

  it("1900-01-01 grava com old_date", () => {
    expect(draftOf(expenseInput({ occurredOn: "1900-01-01" })).flags).toContain("old_date");
  });

  it("2026-02-30 vira InvalidBusinessDate no campo occurredOn", () => {
    expect(run(expenseInput({ occurredOn: "2026-02-30" }))).toMatchObject({
      ok: false,
      error: { code: "InvalidBusinessDate", field: "occurredOn" },
    });
  });

  it("pagamento inválido vira InvalidBusinessDate no campo paidOn", () => {
    expect(run(expenseInput({ paidOn: "2026-13-01" }))).toMatchObject({
      ok: false,
      error: { code: "InvalidBusinessDate", field: "paidOn" },
    });
  });

  it("pagamento omitido é igual à competência", () => {
    expect(draftOf(expenseInput()).paidOn).toBe("2026-11-15");
  });

  it("pagamento informado é mantido", () => {
    expect(draftOf(expenseInput({ paidOn: "2026-12-20" })).paidOn).toBe("2026-12-20");
  });
});

describe("criação pelo painel: categoria, canal e cadastros", () => {
  it("receita com categoria de despesa vira CategoryTypeMismatch", () => {
    expect(run(revenueInput({ categoryId: "cat-gas" }))).toMatchObject({
      ok: false,
      error: { code: "CategoryTypeMismatch", categoryId: "cat-gas" },
    });
  });

  it("despesa com categoria de receita vira CategoryTypeMismatch", () => {
    expect(run(expenseInput({ categoryId: "cat-vendas" }))).toMatchObject({
      ok: false,
      error: { code: "CategoryTypeMismatch" },
    });
  });

  it("receita sem canal vira SalesChannelRequired", () => {
    expect(run(revenueInput({ salesChannelId: null }))).toMatchObject({
      ok: false,
      error: { code: "SalesChannelRequired" },
    });
  });

  it("categoria que exige quantidade sem quantidade vira QuantityRequired", () => {
    expect(run(expenseInput({ categoryId: "cat-insumos" }))).toMatchObject({
      ok: false,
      error: { code: "QuantityRequired" },
    });
  });

  it("quantidade e unidade de medida andam juntas", () => {
    expect(run(expenseInput({ quantity: 2, quantityUnit: null }))).toMatchObject({
      ok: false,
      error: { code: "QuantityRequired" },
    });
    expect(run(expenseInput({ quantity: null, quantityUnit: "KG" }))).toMatchObject({
      ok: false,
      error: { code: "QuantityRequired" },
    });
  });

  it("categoria com quantidade e unidade grava os dois", () => {
    const draft = draftOf(
      expenseInput({ categoryId: "cat-insumos", quantity: 2.5, quantityUnit: "KG" }),
    );
    expect(draft).toMatchObject({ quantity: 2.5, quantityUnit: "KG" });
  });

  it("unidade inativa vira UnitInactive", () => {
    expect(run(expenseInput({ unitId: "u2" }))).toMatchObject({
      ok: false,
      error: { code: "UnitInactive", unitId: "u2" },
    });
  });

  it("unidade inexistente vira UnknownReference unit", () => {
    expect(run(expenseInput({ unitId: "zzz" }))).toMatchObject({
      ok: false,
      error: { code: "UnknownReference", field: "unit" },
    });
  });

  it("categoria ausente, inativa ou de outra empresa vira UnknownReference category", () => {
    for (const categoryId of ["nao-existe", "cat-inativa"]) {
      expect(run(expenseInput({ categoryId }))).toMatchObject({
        ok: false,
        error: { code: "UnknownReference", field: "category" },
      });
    }
  });

  it("forma de pagamento inativa ou ausente vira UnknownReference payment_method", () => {
    for (const paymentMethodId of ["velha", "nao-existe"]) {
      expect(run(expenseInput({ paymentMethodId }))).toMatchObject({
        ok: false,
        error: { code: "UnknownReference", field: "payment_method" },
      });
    }
  });

  it("canal inativo ou ausente vira UnknownReference sales_channel", () => {
    for (const salesChannelId of ["velho", "nao-existe"]) {
      expect(run(revenueInput({ salesChannelId }))).toMatchObject({
        ok: false,
        error: { code: "UnknownReference", field: "sales_channel" },
      });
    }
  });

  it("fornecedor inexistente vira UnknownReference supplier", () => {
    expect(run(expenseInput({ supplier: { id: "nao-existe" } }))).toMatchObject({
      ok: false,
      error: { code: "UnknownReference", field: "supplier" },
    });
  });

  it("fornecedor existente entra no rascunho", () => {
    expect(draftOf(expenseInput({ supplier: { id: "forn-1" } })).supplierId).toBe("forn-1");
  });
});

describe("criação pelo painel: descrição (RF12.R3)", () => {
  it("descrição só com CPF vira DescriptionEmpty", () => {
    expect(run(expenseInput({ description: "123.456.789-09" }))).toMatchObject({
      ok: false,
      error: { code: "DescriptionEmpty" },
    });
  });

  it("descrição com CPF e texto grava sem o CPF", () => {
    expect(draftOf(expenseInput({ description: "Gás do João 123.456.789-09" })).description).toBe(
      "Gás do João",
    );
  });
});

describe("criação pelo painel: taxa e rascunho", () => {
  it("a taxa da receita vem da forma de pagamento", () => {
    expect(draftOf(revenueInput())).toMatchObject({ feePercentBp: 320, feeFixedCents: 0 });
  });

  it("o canal aplicativo substitui a taxa da forma (P06)", () => {
    expect(draftOf(revenueInput({ salesChannelId: "ifood" }))).toMatchObject({
      feePercentBp: 2300,
      feeFixedCents: 0,
    });
  });

  it("despesa não tem taxa", () => {
    expect(draftOf(expenseInput({ paymentMethodId: "credito" }))).toMatchObject({
      feePercentBp: 0,
      feeFixedCents: 0,
      salesChannelId: null,
    });
  });

  it("o rascunho não tem mensagem de origem nem sinais de revisão de cadastro", () => {
    const draft = draftOf(revenueInput());
    expect(draft.inboundMessageId).toBeNull();
    expect(draft.flags).toEqual([]);
    expect(draft).toMatchObject({ unitId: "u1", amountCents: 12000, orders: null });
  });

  it("pedidos da receita seguem para o rascunho", () => {
    expect(draftOf(revenueInput({ orders: 12 })).orders).toBe(12);
  });
});

describe("criação pelo painel: duplicidade (RF26.R4)", () => {
  const same = {
    inboundMessageId: null,
    amountCents: 12000,
    supplierId: null,
    description: "botijão de gas",
    occurredOn: "2026-11-15",
  };

  it("marca possible_duplicate quando recent tem igual", () => {
    expect(draftOf(expenseInput(), [same] as never[]).flags).toEqual(["possible_duplicate"]);
  });

  it("não marca quando nada é igual", () => {
    expect(
      draftOf(expenseInput(), [{ ...same, description: "Outra", amountCents: 1 }] as never[]).flags,
    ).toEqual([]);
  });

  it("junta old_date e possible_duplicate", () => {
    const flags = draftOf(expenseInput({ occurredOn: "2026-01-01" }), [
      { ...same, occurredOn: "2026-01-01" },
    ] as never[]).flags;
    expect(flags).toEqual(["old_date", "possible_duplicate"]);
  });
});
