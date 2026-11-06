import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid";
import { asTenant, attempt, startTestDatabase, type TestDatabase } from "./database";
import { createTenant } from "./fixtures";
import { migrateAll, migrateUpTo } from "./staged-migrations";

const CHECK_VIOLATION = "23514";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe("migração dos campos do lançamento (RF12.R21, R22, DD-02, DD-08, DD-13, RF24)", () => {
  it("lançamentos antigos ganham data de pagamento e as receitas sem canal vão para 'Não informado'", async () => {
    const legacy = await db.createEmptyDatabase("legacy_entries");
    await migrateUpTo(legacy, "0008_units_and_catalog_fields");

    const tenantId = uuidv7();
    const unitId = uuidv7();
    const userId = uuidv7();
    const channelId = uuidv7();
    const expenseId = uuidv7();
    const revenueNoChannelId = uuidv7();
    const revenueWithChannelId = uuidv7();
    await legacy.query("insert into tenants (id, name) values ($1, 'Legado')", [tenantId]);
    await legacy.query("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
      unitId,
      tenantId,
    ]);
    await legacy.query(
      "insert into users (id, name, phone_e164) values ($1, 'Dono', '+5511977770000')",
      [userId],
    );
    await legacy.query(
      "insert into sales_channels (id, tenant_id, name, type) values ($1, $2, 'Salão', 'dine_in')",
      [channelId, tenantId],
    );
    const insert = (id: string, type: string, channel: string | null, day: string) =>
      legacy.query(
        `insert into entries (id, tenant_id, unit_id, type, occurred_on, description,
           amount_cents, net_cents, sales_channel_id, created_by)
         values ($1, $2, $3, $4, $5, 'Antigo', 1000, 1000, $6, $7)`,
        [id, tenantId, unitId, type, day, channel, userId],
      );
    await insert(expenseId, "expense", null, "2026-09-10");
    await insert(revenueNoChannelId, "revenue", null, "2026-09-11");
    await insert(revenueWithChannelId, "revenue", channelId, "2026-09-12");

    await migrateAll(legacy);

    const { rows } = await legacy.query<{
      id: string;
      paid_on: string;
      orders: number | null;
      channel_name: string | null;
    }>(
      `select e.id, to_char(e.paid_on, 'YYYY-MM-DD') as paid_on, e.orders, c.name as channel_name
       from entries e left join sales_channels c on c.id = e.sales_channel_id`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(expenseId)).toMatchObject({ paid_on: "2026-09-10", channel_name: null });
    expect(byId.get(revenueNoChannelId)).toMatchObject({
      paid_on: "2026-09-11",
      channel_name: "Não informado",
    });
    expect(byId.get(revenueWithChannelId)).toMatchObject({
      paid_on: "2026-09-12",
      channel_name: "Salão",
    });
    expect(byId.get(expenseId)?.orders).toBeNull();
  });

  it("receita sem canal e pedidos inválidos são recusados pelo banco", async () => {
    const f = await createTenant(db.admin);
    const insert = (type: string, channel: string | null, orders: number | null) =>
      asTenant(db.app, f.tenantId, (client) =>
        attempt(
          client,
          `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
             amount_cents, net_cents, sales_channel_id, orders, created_by)
           values ($1, $2, $3, $4, '2026-11-01', '2026-11-01', 'Teste', 1000, 1000, $5, $6, $7)`,
          [uuidv7(), f.tenantId, f.unitId, type, channel, orders, f.userId],
        ),
      );
    expect(await insert("revenue", null, null)).toEqual({ error: CHECK_VIOLATION });
    expect(await insert("revenue", f.salesChannelId, 0)).toEqual({ error: CHECK_VIOLATION });
    expect(await insert("revenue", f.salesChannelId, 32)).toEqual({ rows: 1 });
    expect(await insert("expense", null, null)).toEqual({ rows: 1 });
  });

  it("o motivo da exclusão tem até 200 caracteres", async () => {
    const f = await createTenant(db.admin);
    const update = (reason: string) =>
      asTenant(db.app, f.tenantId, (client) =>
        attempt(client, "update entries set delete_reason = $1 where id = $2", [reason, f.entryId]),
      );
    expect(await update("x".repeat(200))).toEqual({ rows: 1 });
    expect(await update("x".repeat(201))).toEqual({ error: CHECK_VIOLATION });
  });

  it("o histórico aceita o canal de origem 'email'", async () => {
    const f = await createTenant(db.admin);
    const result = await asTenant(db.app, f.tenantId, (client) =>
      attempt(
        client,
        `insert into entry_versions (id, tenant_id, entry_id, version, action, after, changed_by, channel)
         values ($1, $2, $3, 50, 'update', '{}', $4, 'email')`,
        [uuidv7(), f.tenantId, f.entryId, f.userId],
      ),
    );
    expect(result).toEqual({ rows: 1 });
  });
});
