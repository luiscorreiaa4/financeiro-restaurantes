import { describe, expect, it } from "vitest";
import { type Money, money } from "../money";
import {
  type ChangeContext,
  createEntry,
  type Entry,
  type EntryDraft,
  softDeleteEntry,
} from "./entry";
import { planFeeReapplication } from "./fee-reapply";

const m = (cents: number): Money => {
  const r = money(cents);
  if (!r.ok) throw new Error("centavos inválidos");
  return r.value;
};

const TENANT = "01890a5d-ac96-774b-bcce-b302099a8058";
const USER = "01890a5d-ac96-774b-bcce-b302099a8059";
const ctx: ChangeContext = { actorId: USER, channel: "web", at: new Date("2026-11-23T12:00:00Z") };

let seq = 0;
const make = (overrides: Partial<EntryDraft> = {}): Entry => {
  seq += 1;
  const result = createEntry(
    {
      unitId: "01890a5d-ac96-774b-bcce-b302099a805b",
      type: "revenue",
      occurredOn: "2026-10-27",
      description: "Vendas",
      quantity: null,
      quantityUnit: null,
      amountCents: m(10000),
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: null,
      supplierId: null,
      paymentMethodId: "pm-credit",
      salesChannelId: "ch-salon",
      inboundMessageId: "01890a5d-ac96-774b-bcce-b302099a805c",
      ...overrides,
    },
    {
      actorId: USER,
      channel: "whatsapp",
      at: new Date("2026-10-27T15:00:00Z"),
      id: `01890a5d-ac96-774b-bcce-b302099a${(8100 + seq).toString(16).padStart(4, "0")}`,
      tenantId: TENANT,
    },
  );
  if (!result.ok) throw new Error(`falhou: ${result.error.code}`);
  return result.value.entry;
};

const catalog = {
  paymentMethods: new Map([
    ["pm-credit", { feePercentBp: 320, feeFixedCents: 0 }],
    ["pm-150", { feePercentBp: 150, feeFixedCents: 0 }],
    ["pm-125-50", { feePercentBp: 125, feeFixedCents: 50 }],
    ["pm-fixed-big", { feePercentBp: 0, feeFixedCents: 20000 }],
  ]),
  salesChannels: new Map([
    ["ch-salon", { type: "dine_in" as const, feePercentBp: 0 }],
    ["ch-ifood", { type: "app" as const, feePercentBp: 2300 }],
    ["ch-app-free", { type: "app" as const, feePercentBp: 0 }],
  ]),
};

describe("planFeeReapplication", () => {
  it("320 bp em receita de 10000 com taxa antiga 0: delta -320", () => {
    const plan = planFeeReapplication([make()], catalog, ctx);
    expect(plan.matched).toBe(1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.entry.feeCents).toBe(320);
    expect(plan.deltaNetCents).toBe(-320);
  });

  it("canal aplicativo com comissão manda sobre a forma (P06): lançamento já correto não muda", () => {
    const entry = make({ salesChannelId: "ch-ifood", feePercentBp: 2300 });
    const plan = planFeeReapplication([entry], catalog, ctx);
    expect(plan.matched).toBe(0);
    expect(plan.changes).toEqual([]);
    expect(plan.deltaNetCents).toBe(0);
  });

  it("despesa nunca muda", () => {
    const plan = planFeeReapplication(
      [make({ type: "expense", salesChannelId: null })],
      catalog,
      ctx,
    );
    expect(plan.matched).toBe(0);
    expect(plan.changes).toEqual([]);
  });

  it("lançamento excluído é ignorado", () => {
    const deleted = softDeleteEntry(make(), ctx);
    if (!deleted.ok) throw new Error("exclusão falhou");
    const plan = planFeeReapplication([deleted.value.entry], catalog, ctx);
    expect(plan.matched).toBe(0);
    expect(plan.skipped).toBe(0);
    expect(plan.changes).toEqual([]);
  });

  it("idempotente: rodar sobre o resultado não gera mudança", () => {
    const first = planFeeReapplication([make(), make({ amountCents: m(5000) })], catalog, ctx);
    expect(first.changes).toHaveLength(2);
    const second = planFeeReapplication(
      first.changes.map((c) => c.entry),
      catalog,
      ctx,
    );
    expect(second.matched).toBe(0);
    expect(second.changes).toEqual([]);
    expect(second.deltaNetCents).toBe(0);
  });

  it("taxa que sobe gera delta negativo somado; taxa que cai, positivo", () => {
    const high = make({ feePercentBp: 1000 });
    const low = make();
    const plan = planFeeReapplication([high, low], catalog, ctx);
    // high: 1000 -> 320 (+680); low: 0 -> 320 (-320)
    expect(plan.deltaNetCents).toBe(360);
  });

  it("forma nula (sem forma de pagamento) significa sem taxa", () => {
    const entry = make({ feePercentBp: 320, paymentMethodId: null, salesChannelId: "ch-salon" });
    const plan = planFeeReapplication([entry], catalog, ctx);
    expect(plan.changes[0]?.entry.feePercentBp).toBe(0);
  });

  it("id de forma não nulo ausente do catálogo: pula, conta em skipped e preserva a taxa", () => {
    const entry = make({ paymentMethodId: "pm-sumiu", feePercentBp: 500 });
    const plan = planFeeReapplication([entry], catalog, ctx);
    expect(plan.skipped).toBe(1);
    expect(plan.matched).toBe(0);
    expect(plan.changes).toEqual([]);
    expect(plan.deltaNetCents).toBe(0);
    expect(entry.feePercentBp).toBe(500);
  });

  it("id de canal não nulo ausente do catálogo: pula e conta em skipped", () => {
    const plan = planFeeReapplication([make({ salesChannelId: "ch-sumiu" })], catalog, ctx);
    expect(plan.skipped).toBe(1);
    expect(plan.changes).toEqual([]);
  });

  it("taxa nova maior que o valor: pula e conta em skipped", () => {
    const entry = make({ paymentMethodId: "pm-fixed-big" });
    const plan = planFeeReapplication([entry], catalog, ctx);
    expect(plan.skipped).toBe(1);
    expect(plan.matched).toBe(0);
    expect(plan.changes).toEqual([]);
    expect(plan.deltaNetCents).toBe(0);
  });

  it("lançamento já correto não conta em nada", () => {
    const first = planFeeReapplication([make()], catalog, ctx);
    const second = planFeeReapplication(
      first.changes.map((c) => c.entry),
      catalog,
      ctx,
    );
    expect(second).toEqual({ changes: [], matched: 0, skipped: 0, deltaNetCents: 0 });
  });

  it("arredonda meio para cima: 333 a 150 bp = 4,995 vira 5", () => {
    const plan = planFeeReapplication(
      [make({ amountCents: m(333), paymentMethodId: "pm-150" })],
      catalog,
      ctx,
    );
    expect(plan.changes[0]?.entry.feeCents).toBe(5);
    expect(plan.deltaNetCents).toBe(-5);
  });

  it("percentual mais taxa fixa: 10000 a 125 bp + 50 = 175", () => {
    const plan = planFeeReapplication([make({ paymentMethodId: "pm-125-50" })], catalog, ctx);
    expect(plan.changes[0]?.entry.feeCents).toBe(175);
    expect(plan.deltaNetCents).toBe(-175);
  });

  it("não altera os lançamentos recebidos", () => {
    const entry = make();
    const before = JSON.stringify(entry);
    planFeeReapplication([Object.freeze(entry)], catalog, ctx);
    expect(JSON.stringify(entry)).toBe(before);
  });

  it("P06 inverso: canal de aplicativo com comissão 0 usa a taxa da forma", () => {
    const entry = make({ salesChannelId: "ch-app-free" });
    const plan = planFeeReapplication([entry], catalog, ctx);
    expect(plan.changes[0]?.entry.feePercentBp).toBe(320);
  });
});
