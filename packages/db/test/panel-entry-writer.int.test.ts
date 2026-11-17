import { createEntry, type EntryChange, type EntryDraft, money } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "../src/client";
import { loadCatalogIn } from "../src/entry-store";
import {
  findByClientRequest,
  insertPanelEntry,
  isUniqueViolation,
} from "../src/panel-entry-writer";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

const CONSTRAINT = "entries_client_request_unique";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;
let otherUserId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
  otherUserId = uuidv7();
  await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Outro', $2)", [
    otherUserId,
    `+5511${String(800000000 + Math.floor(Math.random() * 1e6))}`,
  ]);
});

afterAll(async () => {
  await db?.stop();
});

const appDb = () => createDatabase(db.app);

function panelChange(f: TenantFixture, actorId = f.userId, over: Partial<EntryDraft> = {}) {
  const amount = money(4500);
  if (!amount.ok) throw new Error("centavos inválidos");
  const created = createEntry(
    {
      unitId: f.unitId,
      type: "expense",
      occurredOn: "2026-11-10",
      description: "Feira",
      quantity: null,
      quantityUnit: null,
      amountCents: amount.value,
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: f.categoryId,
      supplierId: null,
      paymentMethodId: null,
      salesChannelId: null,
      inboundMessageId: null,
      flags: [],
      ...over,
    },
    { id: uuidv7(), tenantId: f.tenantId, actorId, channel: "web", at: new Date() },
  );
  if (!created.ok) throw new Error(`core recusou: ${created.error.code}`);
  return created.value;
}

function insert(
  f: TenantFixture,
  change: EntryChange,
  extra: { clientRequestId: string; newSuppliers?: readonly { id: string; name: string }[] },
) {
  return withTenant(appDb(), f.tenantId, (tx) => insertPanelEntry(tx, f.tenantId, change, extra));
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("esperava falha");
}

describe("insertPanelEntry", () => {
  it("dois lançamentos do painel sem mensagem não colidem", async () => {
    await insert(a, panelChange(a), { clientRequestId: uuidv7() });
    await insert(a, panelChange(a), { clientRequestId: uuidv7() });
  });

  it("grava posição 0, a chave e a versão 1 com canal web e antes nulo", async () => {
    const change = panelChange(a);
    const key = uuidv7();
    await insert(a, change, { clientRequestId: key });
    const row = await db.admin.query(
      "select position, client_request_id, inbound_message_id from entries where id = $1",
      [change.entry.id],
    );
    expect(row.rows[0]).toMatchObject({
      position: 0,
      client_request_id: key,
      inbound_message_id: null,
    });
    const version = await db.admin.query(
      "select version, action, channel, before from entry_versions where entry_id = $1",
      [change.entry.id],
    );
    expect(version.rows).toEqual([{ version: 1, action: "create", channel: "web", before: null }]);
    expect(JSON.stringify(change.version.after)).not.toContain(key);
  });

  it("mesma chave do mesmo usuário colide e isUniqueViolation reconhece", async () => {
    const key = uuidv7();
    await insert(a, panelChange(a), { clientRequestId: key });
    const error = await caught(insert(a, panelChange(a), { clientRequestId: key }));
    expect(isUniqueViolation(error, CONSTRAINT)).toBe(true);
    expect(isUniqueViolation(error, "outra_constraint")).toBe(false);
    expect(isUniqueViolation(new Error("x"), CONSTRAINT)).toBe(false);
    expect(isUniqueViolation(null, CONSTRAINT)).toBe(false);
  });

  it("mesma chave de outro usuário ou de outra empresa não colide", async () => {
    const key = uuidv7();
    await insert(a, panelChange(a), { clientRequestId: key });
    await insert(a, panelChange(a, otherUserId), { clientRequestId: key });
    await insert(b, panelChange(b), { clientRequestId: key });
  });

  it("o CHECK recusa chave junto com mensagem de origem", async () => {
    const change = panelChange(a, a.userId, { inboundMessageId: a.inboundMessageId });
    const error = await caught(insert(a, change, { clientRequestId: uuidv7() }));
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain(
      "entries_origin_exclusive_check",
    );
    expect(isUniqueViolation(error, "entries_origin_exclusive_check")).toBe(false);
  });

  it("a falha do 23505 desfaz o fornecedor novo da mesma transação", async () => {
    const key = uuidv7();
    await insert(a, panelChange(a), { clientRequestId: key });
    const supplierId = uuidv7();
    const error = await caught(
      insert(a, panelChange(a, a.userId, { supplierId }), {
        clientRequestId: key,
        newSuppliers: [{ id: supplierId, name: "Feira Nova da Corrida" }],
      }),
    );
    expect(isUniqueViolation(error, CONSTRAINT)).toBe(true);
    const found = await db.admin.query("select 1 from suppliers where id = $1", [supplierId]);
    expect(found.rowCount).toBe(0);
  });

  it("grava o fornecedor novo junto do lançamento quando não há colisão", async () => {
    const supplierId = uuidv7();
    const change = panelChange(a, a.userId, { supplierId });
    await insert(a, change, {
      clientRequestId: uuidv7(),
      newSuppliers: [{ id: supplierId, name: "Fornecedor Novo" }],
    });
    const found = await db.admin.query("select name, tenant_id from suppliers where id = $1", [
      supplierId,
    ]);
    expect(found.rows).toEqual([{ name: "Fornecedor Novo", tenant_id: a.tenantId }]);
  });
});

describe("findByClientRequest", () => {
  it("acha só a chave do próprio usuário na própria empresa", async () => {
    const key = uuidv7();
    const change = panelChange(a);
    await insert(a, change, { clientRequestId: key });
    const look = (f: TenantFixture, userId: string, k: string) =>
      withTenant(appDb(), f.tenantId, (tx) => findByClientRequest(tx, userId, k));
    expect(await look(a, a.userId, key)).toBe(change.entry.id);
    expect(await look(a, otherUserId, key)).toBeNull();
    expect(await look(b, a.userId, key)).toBeNull();
    expect(await look(a, a.userId, uuidv7())).toBeNull();
  });
});

describe("loadCatalogIn", () => {
  it("devolve o catálogo do tenant dentro da transação", async () => {
    const catalog = await withTenant(appDb(), a.tenantId, (tx) => loadCatalogIn(tx, a.tenantId));
    expect(catalog.units.map((u) => u.id)).toContain(a.unitId);
    expect(catalog.units.map((u) => u.id)).not.toContain(b.unitId);
    expect(catalog.categories.map((c) => c.id)).toContain(a.categoryId);
  });
});
