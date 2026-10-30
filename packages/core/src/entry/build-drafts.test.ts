import { describe, expect, it } from "vitest";
import { type Money, money } from "../money";
import { buildDrafts, normalizeUnit, type RecentEntry } from "./build-drafts";
import { type CatalogSnapshot, resolveFeeRule } from "./catalog";
import type { ExtractedEntry } from "./extraction";
import type { ReadyEntry } from "./interpret";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error("centavos inválidos");
  return result.value;
};

const CATALOG: CatalogSnapshot = {
  categories: [
    { id: "cat-carnes", name: "Carnes e peixes", kind: "expense" },
    { id: "cat-outras-d", name: "Outras despesas", kind: "expense" },
    { id: "cat-salao", name: "Salão", kind: "revenue" },
    { id: "cat-outras-r", name: "Outras receitas", kind: "revenue" },
  ],
  suppliers: [{ id: "forn-atacadao", name: "Atacadão", aliases: ["atacadao loja 2"] }],
  paymentMethods: [
    { id: "pg-pix", name: "Pix", feePercentBp: 0, feeFixedCents: 0 },
    { id: "pg-credito", name: "Crédito", feePercentBp: 320, feeFixedCents: 0 },
  ],
  salesChannels: [
    { id: "canal-salao", name: "Salão", feePercentBp: 0 },
    { id: "canal-ifood", name: "iFood", feePercentBp: 2300 },
  ],
  units: [{ id: "unit-1", name: "Centro" }],
};

const ready = (overrides: Partial<ExtractedEntry> = {}, amount = 45000): ReadyEntry => ({
  extracted: {
    type: "expense",
    description: "Camarão",
    occurred_on: null,
    quantity: null,
    quantity_unit: null,
    unit_price_cents: null,
    total_cents: amount,
    category_hint: null,
    supplier_hint: null,
    payment_method_hint: null,
    sales_channel_hint: null,
    missing_fields: [],
    ...overrides,
  },
  amountCents: m(amount),
  occurredOn: "2026-10-30",
  description: overrides.description ?? "Camarão",
  flags: [],
});

let counter = 0;
const base = {
  catalog: CATALOG,
  unitId: "unit-1",
  inboundMessageId: "msg-1",
  recent: [] as RecentEntry[],
  newId: () => `novo-${++counter}`,
};

const plan = (entries: ReadyEntry[], extra: Partial<typeof base> = {}) =>
  buildDrafts(entries, { ...base, ...extra });

describe("montagem dos rascunhos de lançamento", () => {
  it("casa categoria, fornecedor e forma por nome sem diferenciar acento nem caixa", () => {
    const { drafts, newSuppliers } = plan([
      ready({
        category_hint: "carnes e PEIXES",
        supplier_hint: "ATACADÃO",
        payment_method_hint: "pix",
      }),
    ]);
    expect(drafts[0]?.draft).toMatchObject({
      categoryId: "cat-carnes",
      supplierId: "forn-atacadao",
      paymentMethodId: "pg-pix",
      flags: [],
    });
    expect(newSuppliers).toEqual([]);
  });

  it("casa fornecedor pelo apelido", () => {
    const { drafts } = plan([ready({ supplier_hint: "Atacadão loja 2" })]);
    expect(drafts[0]?.draft.supplierId).toBe("forn-atacadao");
  });

  it("sem categoria usa 'Outras despesas' e marca para revisão, sem perguntar", () => {
    const { drafts } = plan([ready({ category_hint: "coisa estranha" })]);
    expect(drafts[0]?.draft).toMatchObject({
      categoryId: "cat-outras-d",
      flags: ["category_to_review"],
    });
  });

  it("receita sem categoria usa 'Outras receitas' e categoria de despesa não vale para receita", () => {
    const { drafts } = plan([ready({ type: "revenue", category_hint: "Carnes e peixes" })]);
    expect(drafts[0]?.draft).toMatchObject({
      categoryId: "cat-outras-r",
      flags: ["category_to_review"],
    });
  });

  it("cria fornecedor novo uma única vez por mensagem", () => {
    const { drafts, newSuppliers } = plan([
      ready({ supplier_hint: "Ceasa" }),
      ready({ supplier_hint: "ceasa" }, 1000),
    ]);
    expect(newSuppliers).toHaveLength(1);
    expect(newSuppliers[0]?.name).toBe("Ceasa");
    expect(drafts[0]?.draft.supplierId).toBe(drafts[1]?.draft.supplierId);
  });

  it("'cartão' sem especificar usa a forma padrão (Crédito) e aplica a taxa só na receita", () => {
    const revenue = plan([ready({ type: "revenue", payment_method_hint: "cartão" }, 10000)])
      .drafts[0]?.draft;
    expect(revenue).toMatchObject({ paymentMethodId: "pg-credito", feePercentBp: 320 });

    const expense = plan([ready({ payment_method_hint: "cartão" }, 10000)]).drafts[0]?.draft;
    expect(expense).toMatchObject({
      paymentMethodId: "pg-credito",
      feePercentBp: 0,
      feeFixedCents: 0,
    });
  });

  it("comissão do canal substitui a taxa da forma de pagamento (P06, CA01 do RF09)", () => {
    const draft = plan([
      ready(
        { type: "revenue", sales_channel_hint: "iFood", payment_method_hint: "crédito" },
        20000,
      ),
    ]).drafts[0]?.draft;
    expect(draft).toMatchObject({ salesChannelId: "canal-ifood", feePercentBp: 2300 });
  });

  it("canal só vale em receita", () => {
    const draft = plan([ready({ sales_channel_hint: "iFood" })]).drafts[0]?.draft;
    expect(draft?.salesChannelId).toBeNull();
  });

  it("forma de pagamento ausente ou desconhecida fica sem forma", () => {
    expect(plan([ready()]).drafts[0]?.draft.paymentMethodId).toBeNull();
    expect(
      plan([ready({ payment_method_hint: "fiado" })]).drafts[0]?.draft.paymentMethodId,
    ).toBeNull();
  });

  it("guarda a posição na mensagem e a origem", () => {
    const { drafts } = plan([ready(), ready({}, 100)]);
    expect(drafts.map((item) => item.position)).toEqual([0, 1]);
    expect(drafts[0]?.draft.inboundMessageId).toBe("msg-1");
  });

  it("repete a descrição e a data de outra mensagem recente: possível duplicidade (CA08)", () => {
    const recent: RecentEntry[] = [
      {
        inboundMessageId: "msg-0",
        amountCents: 8000,
        supplierId: null,
        description: "gás",
        occurredOn: "2026-10-30",
      },
    ];
    const { drafts } = plan([ready({ description: "Gás" }, 8000)], { recent });
    expect(drafts[0]?.draft.flags).toContain("possible_duplicate");
  });

  it("mesmo valor e fornecedor de outra mensagem também é duplicidade", () => {
    const recent: RecentEntry[] = [
      {
        inboundMessageId: "msg-0",
        amountCents: 45000,
        supplierId: "forn-atacadao",
        description: "outra coisa",
        occurredOn: "2026-10-29",
      },
    ];
    const { drafts } = plan([ready({ supplier_hint: "Atacadão" })], { recent });
    expect(drafts[0]?.draft.flags).toContain("possible_duplicate");
  });

  it("não acusa duplicidade contra a própria mensagem (reprocessamento)", () => {
    const recent: RecentEntry[] = [
      {
        inboundMessageId: "msg-1",
        amountCents: 45000,
        supplierId: null,
        description: "Camarão",
        occurredOn: "2026-10-30",
      },
    ];
    expect(plan([ready()], { recent }).drafts[0]?.draft.flags).not.toContain("possible_duplicate");
  });
});

describe("unidade de medida (RF12.R4)", () => {
  it("normaliza apelidos para o código da unidade", () => {
    expect(normalizeUnit("quilos")).toBe("KG");
    expect(normalizeUnit("Kg.")).toBe("KG");
    expect(normalizeUnit("dúzia")).toBe("DZ");
    expect(normalizeUnit("caixas")).toBe("CX");
  });

  it("unidade desconhecida vira OUTRA e ausente fica nula", () => {
    expect(normalizeUnit("balde")).toBe("OUTRA");
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit("  ")).toBeNull();
  });
});

describe("regra de taxa da receita (RF08.R3, RF09.R4, P06)", () => {
  const card = { feePercentBp: 320, feeFixedCents: 30 };

  it("usa a taxa da forma quando o canal não tem comissão", () => {
    expect(resolveFeeRule({ paymentMethod: card, salesChannel: { feePercentBp: 0 } })).toEqual(
      card,
    );
  });

  it("canal com comissão substitui a forma e nunca soma", () => {
    expect(resolveFeeRule({ paymentMethod: card, salesChannel: { feePercentBp: 2300 } })).toEqual({
      feePercentBp: 2300,
      feeFixedCents: 0,
    });
  });

  it("sem forma nem canal não há taxa", () => {
    expect(resolveFeeRule({ paymentMethod: null, salesChannel: null })).toEqual({
      feePercentBp: 0,
      feeFixedCents: 0,
    });
  });
});
