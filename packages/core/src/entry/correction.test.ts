import { describe, expect, it } from "vitest";
import { money } from "../money";
import type { CatalogSnapshot } from "./catalog";
import {
  type CorrectionChanges,
  type CorrectionResult,
  CorrectionResultSchema,
  planCorrection,
} from "./correction";
import { createEntry, type Entry, editEntry } from "./entry";

const m = (cents: number) => {
  const result = money(cents);
  if (!result.ok) throw new Error("centavos inválidos");
  return result.value;
};

const TODAY = "2026-10-30";
const CATALOG: CatalogSnapshot = {
  categories: [
    { id: "cat-carnes", name: "Carnes e peixes", kind: "expense" },
    { id: "cat-salao", name: "Salão", kind: "revenue" },
  ],
  suppliers: [],
  paymentMethods: [
    { id: "pg-pix", name: "Pix", feePercentBp: 0, feeFixedCents: 0 },
    { id: "pg-credito", name: "Crédito", feePercentBp: 320, feeFixedCents: 0 },
  ],
  salesChannels: [
    { id: "canal-salao", name: "Salão", feePercentBp: 0 },
    { id: "canal-ifood", name: "iFood", feePercentBp: 2300 },
  ],
  units: [],
};

function entry(
  position: number,
  overrides: Partial<Parameters<typeof createEntry>[0]> = {},
): Entry {
  const created = createEntry(
    {
      unitId: "unit-1",
      type: "expense",
      occurredOn: "2026-10-30",
      description: `Item ${position}`,
      quantity: null,
      quantityUnit: null,
      amountCents: m(10000),
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: null,
      supplierId: null,
      paymentMethodId: null,
      salesChannelId: null,
      inboundMessageId: "in-1",
      ...overrides,
    },
    {
      id: `0190a000-0000-7000-8000-00000000000${position}`,
      tenantId: "t",
      actorId: "u",
      channel: "whatsapp",
      at: new Date("2026-10-30T12:00:00Z"),
    },
  );
  if (!created.ok) throw new Error("core recusou");
  return created.value.entry;
}

const noChanges: CorrectionChanges = {
  description: null,
  occurred_on: null,
  quantity: null,
  quantity_unit: null,
  total_cents: null,
  category_hint: null,
  payment_method_hint: null,
  sales_channel_hint: null,
};
const correct = (
  changes: Partial<CorrectionChanges>,
  targets: number[] = [],
): CorrectionResult => ({
  intent: "correct",
  targets,
  changes: { ...noChanges, ...changes },
  question: null,
});

describe("correção por reply (RF17)", () => {
  it("com um só lançamento na confirmação, corrige o valor sem precisar citar o item", () => {
    const outcome = planCorrection(correct({ total_cents: 40000 }), [entry(1)], CATALOG, TODAY);
    expect(outcome).toMatchObject({ kind: "ready", patches: [{ patch: { amountCents: 40000 } }] });
  });

  it("com vários lançamentos e nenhum citado, pergunta qual (R2)", () => {
    const outcome = planCorrection(
      correct({ total_cents: 40000 }),
      [entry(1), entry(2)],
      CATALOG,
      TODAY,
    );
    expect(outcome).toEqual({ kind: "ask_which", count: 2 });
  });

  it("corrige só o item citado: 'o 2 foi 400'", () => {
    const entries = [entry(1), entry(2), entry(3)];
    const outcome = planCorrection(correct({ total_cents: 40000 }, [2]), entries, CATALOG, TODAY);
    if (outcome.kind !== "ready") throw new Error("esperava ready");
    expect(outcome.patches.map(({ entry: target }) => target.description)).toEqual(["Item 2"]);
  });

  it("ignora posição que não existe e pergunta qual quando sobra nada", () => {
    const outcome = planCorrection(
      correct({ total_cents: 40000 }, [9]),
      [entry(1), entry(2)],
      CATALOG,
      TODAY,
    );
    expect(outcome).toEqual({ kind: "ask_which", count: 2 });
  });

  it("recusa data futura pelo WhatsApp", () => {
    const outcome = planCorrection(
      correct({ occurred_on: "2026-11-02" }),
      [entry(1)],
      CATALOG,
      TODAY,
    );
    expect(outcome).toEqual({ kind: "rejected", reason: "future_date" });
  });

  it("mantém a taxa da gravação original quando a forma e o canal não mudam", () => {
    const revenue = entry(1, { type: "revenue", feePercentBp: 500 });
    const outcome = planCorrection(correct({ total_cents: 20000 }), [revenue], CATALOG, TODAY);
    if (outcome.kind !== "ready") throw new Error("esperava ready");
    expect(outcome.patches[0]?.patch.feePercentBp).toBeUndefined();
    const edited = editEntry(revenue, outcome.patches[0]?.patch ?? {}, {
      actorId: "u",
      channel: "whatsapp",
      at: new Date("2026-10-30T13:00:00Z"),
    });
    expect(edited.ok && edited.value.entry.feeCents).toBe(1000);
  });

  it("recalcula a taxa quando a forma de pagamento muda em uma receita", () => {
    const revenue = entry(1, { type: "revenue", paymentMethodId: "pg-pix" });
    const outcome = planCorrection(
      correct({ payment_method_hint: "crédito" }),
      [revenue],
      CATALOG,
      TODAY,
    );
    if (outcome.kind !== "ready") throw new Error("esperava ready");
    expect(outcome.patches[0]?.patch).toMatchObject({
      paymentMethodId: "pg-credito",
      feePercentBp: 320,
    });
  });

  it("trocar para canal com comissão substitui a taxa da forma", () => {
    const revenue = entry(1, { type: "revenue", paymentMethodId: "pg-credito", feePercentBp: 320 });
    const outcome = planCorrection(
      correct({ sales_channel_hint: "iFood" }),
      [revenue],
      CATALOG,
      TODAY,
    );
    if (outcome.kind !== "ready") throw new Error("esperava ready");
    expect(outcome.patches[0]?.patch).toMatchObject({
      salesChannelId: "canal-ifood",
      feePercentBp: 2300,
    });
  });

  it("despesa não ganha taxa ao trocar a forma de pagamento", () => {
    const outcome = planCorrection(
      correct({ payment_method_hint: "crédito" }),
      [entry(1)],
      CATALOG,
      TODAY,
    );
    if (outcome.kind !== "ready") throw new Error("esperava ready");
    expect(outcome.patches[0]?.patch.feePercentBp).toBeUndefined();
  });

  it("avisa categoria que não existe em vez de inventar", () => {
    const outcome = planCorrection(
      correct({ category_hint: "Coisa estranha", total_cents: 100 }),
      [entry(1)],
      CATALOG,
      TODAY,
    );
    expect(outcome).toMatchObject({ kind: "ready", unresolved: ["category"] });
  });

  it("recusa quando nada aplicável mudou", () => {
    const outcome = planCorrection(
      correct({ category_hint: "Coisa estranha" }),
      [entry(1)],
      CATALOG,
      TODAY,
    );
    expect(outcome).toEqual({ kind: "rejected", reason: "no_change" });
  });

  it("repassa a pergunta da IA e o fora de escopo", () => {
    const unclear: CorrectionResult = {
      intent: "unclear",
      targets: [],
      changes: noChanges,
      question: "O que mudou?",
    };
    expect(planCorrection(unclear, [entry(1)], CATALOG, TODAY)).toEqual({
      kind: "ask",
      question: "O que mudou?",
    });
    expect(
      planCorrection(
        { ...unclear, intent: "out_of_scope", question: null },
        [entry(1)],
        CATALOG,
        TODAY,
      ),
    ).toEqual({ kind: "out_of_scope" });
  });

  it("descrição da correção também perde CPF", () => {
    const outcome = planCorrection(
      correct({ description: "Pagamento 123.456.789-09 João" }),
      [entry(1)],
      CATALOG,
      TODAY,
    );
    expect(outcome).toMatchObject({
      kind: "ready",
      patches: [{ patch: { description: "Pagamento João" } }],
    });
  });
});

describe("schema da correção", () => {
  it("exige pergunta quando a intenção é unclear", () => {
    expect(
      CorrectionResultSchema.safeParse({
        intent: "unclear",
        targets: [],
        changes: noChanges,
        question: null,
      }).success,
    ).toBe(false);
  });

  it("aceita correção de valor e rejeita total com casas decimais", () => {
    expect(CorrectionResultSchema.safeParse(correct({ total_cents: 100 })).success).toBe(true);
    expect(CorrectionResultSchema.safeParse(correct({ total_cents: 10.5 })).success).toBe(false);
  });
});
