import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { migrateAll, migrateUpTo } from "./staged-migrations";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe("migração das unidades e dos cadastros de apoio (RF04, RF07, RF08, RF09)", () => {
  it("converte os dados existentes sem perder nada e cria os cadastros 'Não informado'", async () => {
    const legacy = await db.createEmptyDatabase("legacy_catalog");
    await migrateUpTo(legacy, "0007_drop_membership_unit_id");

    const tenantId = uuidv7();
    const unitId = uuidv7();
    const salao = uuidv7();
    const ifood = uuidv7();
    const pix = uuidv7();
    const credito = uuidv7();
    await legacy.query("insert into tenants (id, name) values ($1, 'Legado')", [tenantId]);
    await legacy.query("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
      unitId,
      tenantId,
    ]);
    await legacy.query(
      `insert into sales_channels (id, tenant_id, name, fee_percent_bp) values
         ($1, $3, 'Salão', 0), ($2, $3, 'iFood', 2300)`,
      [salao, ifood, tenantId],
    );
    await legacy.query(
      `insert into payment_methods (id, tenant_id, name) values ($1, $3, 'Pix'), ($2, $3, 'Crédito')`,
      [pix, credito, tenantId],
    );

    await migrateAll(legacy);

    const unit = await legacy.query(
      "select status, aliases, city, uf, cnpj, default_sales_channel_id from units where id = $1",
      [unitId],
    );
    expect(unit.rows[0]).toEqual({
      status: "active",
      aliases: [],
      city: null,
      uf: null,
      cnpj: null,
      default_sales_channel_id: salao,
    });

    const channels = await legacy.query<{ name: string; type: string; status: string }>(
      "select name, type, status from sales_channels where tenant_id = $1 order by name",
      [tenantId],
    );
    expect(channels.rows).toEqual([
      { name: "iFood", type: "app", status: "active" },
      { name: "Não informado", type: "other", status: "active" },
      { name: "Salão", type: "dine_in", status: "active" },
    ]);

    const methods = await legacy.query<{ name: string; type: string; is_default_card: boolean }>(
      "select name, type, is_default_card from payment_methods where tenant_id = $1 order by name",
      [tenantId],
    );
    expect(methods.rows).toEqual([
      { name: "Crédito", type: "credit", is_default_card: true },
      { name: "Não informada", type: "other", is_default_card: false },
      { name: "Pix", type: "pix", is_default_card: false },
    ]);
  });

  it("a forma de cartão padrão é única por empresa", async () => {
    const t = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, 'Cartões')", [t]);
    await db.admin.query(
      `insert into payment_methods (id, tenant_id, name, type, is_default_card)
       values ($1, $2, 'Crédito', 'credit', true)`,
      [uuidv7(), t],
    );
    await expect(
      db.admin.query(
        `insert into payment_methods (id, tenant_id, name, type, is_default_card)
         values ($1, $2, 'Débito', 'debit', true)`,
        [uuidv7(), t],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("o canal padrão da unidade precisa ser da mesma empresa", async () => {
    const t1 = uuidv7();
    const t2 = uuidv7();
    const unit = uuidv7();
    const foreignChannel = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, 'T1'), ($2, 'T2')", [t1, t2]);
    await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'U')", [
      unit,
      t1,
    ]);
    await db.admin.query(
      "insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Salão')",
      [foreignChannel, t2],
    );
    await expect(
      db.admin.query("update units set default_sales_channel_id = $1 where id = $2", [
        foreignChannel,
        unit,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejeita tipo de forma de pagamento, tipo de canal e UF fora da lista", async () => {
    const t = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, 'Checks')", [t]);
    await expect(
      db.admin.query(
        "insert into payment_methods (id, tenant_id, name, type) values ($1, $2, 'X', 'cripto')",
        [uuidv7(), t],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.admin.query(
        "insert into sales_channels (id, tenant_id, name, type) values ($1, $2, 'X', 'drone')",
        [uuidv7(), t],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.admin.query("insert into units (id, tenant_id, name, uf) values ($1, $2, 'U', 'XX')", [
        uuidv7(),
        t,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
