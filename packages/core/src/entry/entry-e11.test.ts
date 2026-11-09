import { describe, expect, it } from "vitest";
import { type Money, money } from "../money";
import { buildDrafts } from "./build-drafts";
import type { CatalogSnapshot } from "./catalog";
import {
  createEntry,
  type Entry,
  type EntryDraft,
  editEntry,
  markEntryReviewed,
  RESTORE_WINDOW_DAYS,
  restoreEntry,
  softDeleteEntry,
} from "./entry";
import type { ExtractedEntry, ExtractionResult } from "./extraction";
import { INVESTMENT_QUESTION_THRESHOLD_CENTS, interpretExtraction } from "./interpret";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error("centavos inválidos");
  return result.value;
};

const TODAY = "2026-11-06";
const UUID = "0190a000-0000-7000-8000-000000000001";
const ACTOR = "0190a000-0000-7000-8000-0000000000aa";
const AT = new Date("2026-11-06T15:00:00Z");

function extracted(overrides: Partial<ExtractedEntry> = {}): ExtractedEntry {
  return {
    type: "expense",
    description: "Carne",
    occurred_on: null,
    paid_on: null,
    orders: null,
    asset_kind: null,
    asset_decision: null,
    quantity: null,
    quantity_unit: null,
    unit_price_cents: null,
    total_cents: 60000,
    category_hint: null,
    supplier_hint: null,
    payment_method_hint: null,
    sales_channel_hint: null,
    missing_fields: [],
    ...overrides,
  };
}

function register(...entries: ExtractedEntry[]): ExtractionResult {
  return { intent: "register", entries, question: null, unit_hint: null };
}

function interpretOne(overrides: Partial<ExtractedEntry>) {
  const result = interpretExtraction(register(extracted(overrides)), TODAY);
  if (result.kind !== "register") throw new Error("esperava register");
  return result;
}

describe("data de pagamento e pedidos na interpretação (RF12.R21, R22)", () => {
  it("'paguei a carne 600, vence dia 20': competência hoje e pagamento dia 20 (RF12.CA11)", () => {
    const { ready } = interpretOne({ paid_on: "2026-11-20" });
    expect(ready[0]).toMatchObject({ occurredOn: TODAY, paidOn: "2026-11-20" });
  });

  it("sem data de pagamento, ela é igual à de competência (RF12.CA11)", () => {
    const { ready } = interpretOne({ occurred_on: "2026-11-03" });
    expect(ready[0]).toMatchObject({ occurredOn: "2026-11-03", paidOn: "2026-11-03" });
  });

  it("pedidos vêm só da receita e precisam ser inteiros maiores que zero (RF12.CA14)", () => {
    expect(interpretOne({ type: "revenue", orders: 32 }).ready[0]?.orders).toBe(32);
    expect(interpretOne({ type: "revenue", orders: 0 }).ready[0]?.orders).toBeNull();
    expect(interpretOne({ type: "revenue", orders: 2.5 }).ready[0]?.orders).toBeNull();
    expect(interpretOne({ type: "expense", orders: 5 }).ready[0]?.orders).toBeNull();
  });
});

describe("investimento acima do limite pergunta antes de gravar (RF12.R23, DD-09)", () => {
  it("o limite fica numa constante única: R$ 1.500,00", () => {
    expect(INVESTMENT_QUESTION_THRESHOLD_CENTS).toBe(150_000);
  });

  it("'comprei um forno 2.800' fica pendente com a pergunta de investimento (RF12.CA13)", () => {
    const { ready, pending } = interpretOne({
      description: "Forno",
      asset_kind: "equipment",
      total_cents: 280_000,
    });
    expect(ready).toHaveLength(0);
    expect(pending[0]?.reasons).toEqual(["investment_choice"]);
  });

  it("'ar-condicionado 1.200' é gravado direto como despesa (RF12.CA13)", () => {
    const { ready, pending } = interpretOne({ asset_kind: "equipment", total_cents: 120_000 });
    expect(pending).toHaveLength(0);
    expect(ready).toHaveLength(1);
  });

  it("exatamente R$ 1.500,00 não passa do limite", () => {
    const { pending } = interpretOne({ asset_kind: "renovation", total_cents: 150_000 });
    expect(pending).toHaveLength(0);
  });

  it("depois da resposta do colaborador a pergunta não se repete", () => {
    const { ready } = interpretOne({
      asset_kind: "equipment",
      asset_decision: "investment",
      total_cents: 280_000,
    });
    expect(ready).toHaveLength(1);
  });

  it("receita nunca gera a pergunta", () => {
    const { pending } = interpretOne({
      type: "revenue",
      asset_kind: "equipment",
      total_cents: 280_000,
    });
    expect(pending).toHaveLength(0);
  });
});

const PAYMENT = {
  type: "other",
  aliases: [],
  status: "active",
  isDefaultCard: false,
  feePercentBp: 0,
  feeFixedCents: 0,
} as const;
const CHANNEL = { type: "other", aliases: [], status: "active", feePercentBp: 0 } as const;

const CATALOG: CatalogSnapshot = {
  categories: [
    { id: "cat-carnes", name: "Carnes", kind: "expense" },
    { id: "cat-outras-d", name: "Outras despesas", kind: "expense" },
    { id: "cat-equip", name: "Equipamentos", kind: "investment" },
    { id: "cat-vendas", name: "Vendas", kind: "revenue" },
    { id: "cat-outras-r", name: "Outras receitas", kind: "revenue" },
  ],
  suppliers: [],
  paymentMethods: [{ ...PAYMENT, id: "pg-pix", name: "Pix", type: "pix" }],
  salesChannels: [
    { ...CHANNEL, id: "canal-salao", name: "Salão", type: "dine_in" },
    { ...CHANNEL, id: "canal-ifood", name: "iFood", type: "app", feePercentBp: 2300 },
    { ...CHANNEL, id: "canal-ni", name: "Não informado", type: "other" },
  ],
  units: [
    {
      id: "unit-1",
      name: "Centro",
      aliases: [],
      status: "active",
      defaultSalesChannelId: "canal-salao",
    },
  ],
};

let counter = 0;
function plan(overrides: Partial<ExtractedEntry>, catalog: CatalogSnapshot = CATALOG) {
  const interpretation = interpretOne(overrides);
  const { drafts } = buildDrafts(interpretation.ready, {
    catalog,
    unitId: "unit-1",
    inboundMessageId: "msg-1",
    recent: [],
    newId: () => `novo-${++counter}`,
  });
  const draft = drafts[0]?.draft;
  if (!draft) throw new Error("sem rascunho");
  return draft;
}

describe("canal da receita e canal padrão da unidade (RF12.R9, RF09.Obs3, DD-08)", () => {
  it("receita sem canal vai para o canal padrão da unidade com CANAL_A_REVISAR (RF12.CA12)", () => {
    const draft = plan({ type: "revenue", description: "Vendas", total_cents: 80_000 });
    expect(draft).toMatchObject({ salesChannelId: "canal-salao" });
    expect(draft.flags).toContain("channel_to_review");
  });

  it("receita com canal citado fica nele, sem sinal", () => {
    const draft = plan({ type: "revenue", sales_channel_hint: "iFood" });
    expect(draft).toMatchObject({ salesChannelId: "canal-ifood" });
    expect(draft.flags).not.toContain("channel_to_review");
  });

  it("canal citado que não existe cai no padrão, com sinal", () => {
    const draft = plan({ type: "revenue", sales_channel_hint: "mesa quatro" });
    expect(draft).toMatchObject({ salesChannelId: "canal-salao" });
    expect(draft.flags).toContain("channel_to_review");
  });

  it("empresa com um só canal ativo usa esse canal, sem sinal", () => {
    const catalog: CatalogSnapshot = {
      ...CATALOG,
      salesChannels: CATALOG.salesChannels.map((channel) => ({
        ...channel,
        status: channel.id === "canal-salao" ? ("active" as const) : ("inactive" as const),
      })),
      units: CATALOG.units.map((unit) => ({ ...unit, defaultSalesChannelId: null })),
    };
    const draft = plan({ type: "revenue" }, catalog);
    expect(draft).toMatchObject({ salesChannelId: "canal-salao" });
    expect(draft.flags).not.toContain("channel_to_review");
  });

  it("unidade sem canal padrão e vários canais cai em 'Não informado', com sinal", () => {
    const catalog: CatalogSnapshot = {
      ...CATALOG,
      units: CATALOG.units.map((unit) => ({ ...unit, defaultSalesChannelId: null })),
    };
    const draft = plan({ type: "revenue" }, catalog);
    expect(draft).toMatchObject({ salesChannelId: "canal-ni" });
    expect(draft.flags).toContain("channel_to_review");
  });

  it("despesa nunca recebe canal nem sinal de canal", () => {
    const draft = plan({ type: "expense" });
    expect(draft.salesChannelId).toBeNull();
    expect(draft.flags).not.toContain("channel_to_review");
  });

  it("a taxa segue o canal escolhido: canal padrão aplicativo usa a comissão", () => {
    const catalog: CatalogSnapshot = {
      ...CATALOG,
      units: CATALOG.units.map((unit) => ({ ...unit, defaultSalesChannelId: "canal-ifood" })),
    };
    expect(plan({ type: "revenue", total_cents: 20_000 }, catalog).feePercentBp).toBe(2300);
  });
});

describe("rascunho leva data de pagamento, pedidos e a decisão de investimento", () => {
  it("propaga paidOn e orders para o rascunho", () => {
    const draft = plan({ type: "revenue", orders: 32, paid_on: "2026-11-08" });
    expect(draft).toMatchObject({ orders: 32, paidOn: "2026-11-08" });
  });

  it("decisão 'investimento' usa categoria do tipo investimento", () => {
    const draft = plan({
      description: "Forno",
      asset_kind: "equipment",
      asset_decision: "investment",
      total_cents: 280_000,
    });
    expect(draft.categoryId).toBe("cat-equip");
  });

  it("decisão 'despesa' mantém a categoria de despesa", () => {
    const draft = plan({
      description: "Forno",
      category_hint: "Carnes",
      asset_kind: "equipment",
      asset_decision: "expense",
      total_cents: 280_000,
    });
    expect(draft.categoryId).toBe("cat-carnes");
  });
});

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    unitId: "unit-1",
    type: "expense",
    occurredOn: "2026-11-03",
    description: "Carne",
    quantity: null,
    quantityUnit: null,
    amountCents: m(60_000),
    feePercentBp: 0,
    feeFixedCents: 0,
    categoryId: null,
    supplierId: null,
    paymentMethodId: null,
    salesChannelId: null,
    inboundMessageId: "msg-1",
    ...overrides,
  };
}

function create(overrides: Partial<EntryDraft> = {}): Entry {
  const result = createEntry(draft(overrides), {
    id: UUID,
    tenantId: "t1",
    actorId: ACTOR,
    channel: "whatsapp",
    at: AT,
  });
  if (!result.ok) throw new Error(`createEntry falhou: ${result.error.code}`);
  return result.value.entry;
}

describe("lançamento: data de pagamento, pedidos e canal (entry)", () => {
  it("paidOn é a data de competência quando não informada", () => {
    expect(create().paidOn).toBe("2026-11-03");
    expect(create({ paidOn: "2026-11-20" }).paidOn).toBe("2026-11-20");
  });

  it("pedidos opcionais, só em receita e maiores que zero", () => {
    expect(create({ type: "revenue", salesChannelId: "c1", orders: 32 }).orders).toBe(32);
    expect(create().orders).toBeNull();
    const zero = createEntry(draft({ type: "revenue", salesChannelId: "c1", orders: 0 }), {
      id: UUID,
      tenantId: "t1",
      actorId: ACTOR,
      channel: "whatsapp",
      at: AT,
    });
    expect(zero).toEqual({ ok: false, error: { code: "InvalidOrders", value: 0 } });
    const expense = createEntry(draft({ orders: 3 }), {
      id: UUID,
      tenantId: "t1",
      actorId: ACTOR,
      channel: "whatsapp",
      at: AT,
    });
    expect(expense).toMatchObject({ ok: false, error: { code: "InvalidOrders" } });
  });

  it("receita sem canal é recusada (DD-08)", () => {
    const result = createEntry(draft({ type: "revenue", salesChannelId: null }), {
      id: UUID,
      tenantId: "t1",
      actorId: ACTOR,
      channel: "whatsapp",
      at: AT,
    });
    expect(result).toEqual({ ok: false, error: { code: "SalesChannelRequired" } });
  });

  it("editar a data de pagamento gera versão", () => {
    const entry = create();
    const edited = editEntry(
      entry,
      { paidOn: "2026-11-30" },
      { actorId: ACTOR, channel: "web", at: AT },
    );
    expect(edited).toMatchObject({
      ok: true,
      value: { entry: { paidOn: "2026-11-30", version: 2 } },
    });
  });
});

describe("marcar como revisado (RF12.R13)", () => {
  it("tira os sinais e registra a versão", () => {
    const entry = create({ flags: ["category_to_review", "channel_to_review"] });
    const result = markEntryReviewed(entry, { actorId: ACTOR, channel: "web", at: AT });
    expect(result).toMatchObject({
      ok: true,
      value: {
        entry: { flags: [], version: 2 },
        version: {
          action: "update",
          before: { flags: ["category_to_review", "channel_to_review"] },
        },
      },
    });
  });

  it("sem sinais não há o que revisar", () => {
    const result = markEntryReviewed(create(), { actorId: ACTOR, channel: "web", at: AT });
    expect(result).toEqual({ ok: false, error: { code: "NothingToChange" } });
  });
});

describe("exclusão rastreável e restauração (RF24)", () => {
  it("guarda quem excluiu, o motivo e até quando é restaurável (30 dias)", () => {
    expect(RESTORE_WINDOW_DAYS).toBe(30);
    const result = softDeleteEntry(
      create(),
      { actorId: ACTOR, channel: "web", at: AT },
      { reason: "lançado duas vezes" },
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        entry: {
          deletedBy: ACTOR,
          deleteReason: "lançado duas vezes",
          restorableUntil: "2026-12-06",
        },
        version: { action: "delete" },
      },
    });
  });

  it("sem motivo informado, o motivo fica nulo", () => {
    const result = softDeleteEntry(create(), { actorId: ACTOR, channel: "web", at: AT });
    expect(result).toMatchObject({ ok: true, value: { entry: { deleteReason: null } } });
  });

  it("motivo acima de 200 caracteres é recusado (RF24.R1)", () => {
    const result = softDeleteEntry(
      create(),
      { actorId: ACTOR, channel: "web", at: AT },
      { reason: "x".repeat(201) },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "InvalidDeleteReason" } });
  });

  it("restaurar limpa os dados da exclusão e volta aos valores anteriores", () => {
    const deleted = softDeleteEntry(create(), { actorId: ACTOR, channel: "web", at: AT });
    if (!deleted.ok) throw new Error("exclusão falhou");
    const restored = restoreEntry(deleted.value.entry, { actorId: ACTOR, channel: "web", at: AT });
    expect(restored).toMatchObject({
      ok: true,
      value: {
        entry: { deletedAt: null, deletedBy: null, deleteReason: null, restorableUntil: null },
        version: { action: "restore" },
      },
    });
  });
});
