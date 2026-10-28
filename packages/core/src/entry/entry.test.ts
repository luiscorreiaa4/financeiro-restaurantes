import { describe, expect, it } from "vitest";
import { type Money, money } from "../money";
import {
  type ChangeContext,
  createEntry,
  type Entry,
  type EntryDraft,
  editEntry,
  softDeleteEntry,
} from "./entry";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error(`centavos inválidos: ${cents}`);
  return result.value;
};

const ENTRY_ID = "01890a5d-ac96-774b-bcce-b302099a8057";
const TENANT_ID = "01890a5d-ac96-774b-bcce-b302099a8058";
const USER_ID = "01890a5d-ac96-774b-bcce-b302099a8059";
const OTHER_USER_ID = "01890a5d-ac96-774b-bcce-b302099a805a";

const t1 = new Date("2026-10-27T15:00:00Z");
const t2 = new Date("2026-10-27T16:00:00Z");
const t3 = new Date("2026-10-27T17:00:00Z");

const whatsapp = (at: Date, actorId = USER_ID): ChangeContext => ({
  actorId,
  channel: "whatsapp",
  at,
});

const draft = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  unitId: "01890a5d-ac96-774b-bcce-b302099a805b",
  type: "revenue",
  occurredOn: "2026-10-27",
  description: "Vendas do almoço",
  quantity: null,
  quantityUnit: null,
  amountCents: m(10000),
  feePercentBp: 320,
  feeFixedCents: 0,
  categoryId: null,
  supplierId: null,
  paymentMethodId: null,
  salesChannelId: null,
  inboundMessageId: "01890a5d-ac96-774b-bcce-b302099a805c",
  ...overrides,
});

function created(overrides: Partial<EntryDraft> = {}): Entry {
  const result = createEntry(draft(overrides), {
    ...whatsapp(t1),
    id: ENTRY_ID,
    tenantId: TENANT_ID,
  });
  if (!result.ok) throw new Error(`criação falhou: ${result.error.code}`);
  return result.value.entry;
}

describe("criação de lançamento", () => {
  it("calcula taxa e líquido no domínio e começa na versão 1", () => {
    const entry = created();
    expect(entry.feeCents).toBe(320);
    expect(entry.netCents).toBe(9680);
    expect(entry.version).toBe(1);
    expect(entry.deletedAt).toBeNull();
    expect(entry.createdBy).toBe(USER_ID);
  });

  it("registra a versão de criação com quem, quando, canal e sem estado anterior", () => {
    const result = createEntry(draft(), {
      ...whatsapp(t1),
      id: ENTRY_ID,
      tenantId: TENANT_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toMatchObject({
      entryId: ENTRY_ID,
      tenantId: TENANT_ID,
      version: 1,
      action: "create",
      before: null,
      changedBy: USER_ID,
      channel: "whatsapp",
      changedAt: t1,
    });
    expect(result.value.version.after).toBe(result.value.entry);
  });

  it("guarda a origem: lançamento pelo WhatsApp sem mensagem de origem é rejeitado", () => {
    const result = createEntry(draft({ inboundMessageId: null }), {
      ...whatsapp(t1),
      id: ENTRY_ID,
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, error: { code: "OriginMissing" } });
  });

  it("aceita lançamento pelo painel sem mensagem de origem", () => {
    const result = createEntry(draft({ inboundMessageId: null }), {
      actorId: USER_ID,
      channel: "web",
      at: t1,
      id: ENTRY_ID,
      tenantId: TENANT_ID,
    });
    expect(result.ok).toBe(true);
  });

  it("rejeita valor zero", () => {
    const result = createEntry(draft({ amountCents: m(0) }), {
      ...whatsapp(t1),
      id: ENTRY_ID,
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, error: { code: "AmountNotPositive" } });
  });

  it("rejeita data de negócio inexistente", () => {
    const result = createEntry(draft({ occurredOn: "2026-02-30" }), {
      ...whatsapp(t1),
      id: ENTRY_ID,
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "InvalidBusinessDate", value: "2026-02-30" },
    });
  });

  it("rejeita id que não seja UUID v7", () => {
    const result = createEntry(draft(), {
      ...whatsapp(t1),
      id: "d3b07384-d9a0-4c8e-9f3b-0f9d1a2b3c4d", // UUID v4
      tenantId: TENANT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("InvalidId");
  });

  it("rejeita quantidade zero, negativa ou com mais de 3 casas", () => {
    for (const quantity of [0, -1, 1.2345]) {
      const result = createEntry(draft({ quantity }), {
        ...whatsapp(t1),
        id: ENTRY_ID,
        tenantId: TENANT_ID,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejeita taxa fixa maior que o valor", () => {
    const result = createEntry(draft({ amountCents: m(10), feeFixedCents: 50 }), {
      ...whatsapp(t1),
      id: ENTRY_ID,
      tenantId: TENANT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FeeExceedsAmount");
  });
});

describe("edição com versão", () => {
  it("altera o valor, recalcula taxa e líquido e guarda antes e depois", () => {
    const original = created();
    const result = editEntry(original, { amountCents: m(20000) }, whatsapp(t2, OTHER_USER_ID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entry, version } = result.value;
    expect(entry.amountCents).toBe(20000);
    expect(entry.feeCents).toBe(640);
    expect(entry.netCents).toBe(19360);
    expect(entry.version).toBe(2);
    expect(entry.updatedAt).toBe(t2);
    expect(entry.createdAt).toBe(t1);

    expect(version).toMatchObject({
      version: 2,
      action: "update",
      changedBy: OTHER_USER_ID,
      channel: "whatsapp",
      changedAt: t2,
    });
    expect(version.before?.amountCents).toBe(10000);
    expect(version.after.amountCents).toBe(20000);
  });

  it("não altera o lançamento original (imutável)", () => {
    const original = created();
    editEntry(original, { description: "Outra coisa" }, whatsapp(t2));
    expect(original.description).toBe("Vendas do almoço");
    expect(original.version).toBe(1);
  });

  it("rejeita edição que não muda nada, sem gerar versão", () => {
    const original = created();
    const result = editEntry(original, { description: original.description }, whatsapp(t2));
    expect(result).toEqual({ ok: false, error: { code: "NothingToChange" } });
  });

  it("rejeita edição que deixa o lançamento inválido", () => {
    const original = created();
    expect(editEntry(original, { amountCents: m(0) }, whatsapp(t2)).ok).toBe(false);
    expect(editEntry(original, { occurredOn: "27/10/2026" }, whatsapp(t2)).ok).toBe(false);
  });

  it("não edita lançamento apagado", () => {
    const deleted = softDeleteEntry(created(), whatsapp(t2));
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    const result = editEntry(deleted.value.entry, { description: "x" }, whatsapp(t3));
    expect(result).toEqual({ ok: false, error: { code: "EntryDeleted" } });
  });
});

describe("soft delete (desfazer)", () => {
  it("marca deletedAt, mantém o lançamento e registra a versão", () => {
    const original = created();
    const result = softDeleteEntry(original, whatsapp(t2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.entry.deletedAt).toBe(t2);
    expect(result.value.entry.amountCents).toBe(10000);
    expect(result.value.entry.version).toBe(2);
    expect(result.value.version).toMatchObject({ action: "delete", version: 2, changedAt: t2 });
    expect(result.value.version.before?.deletedAt).toBeNull();
    expect(result.value.version.after.deletedAt).toBe(t2);
  });

  it("desfazer duas vezes é recusado na segunda", () => {
    const first = softDeleteEntry(created(), whatsapp(t2));
    if (!first.ok) throw new Error("primeira exclusão falhou");
    const second = softDeleteEntry(first.value.entry, whatsapp(t3));
    expect(second).toEqual({ ok: false, error: { code: "EntryAlreadyDeleted" } });
  });
});
