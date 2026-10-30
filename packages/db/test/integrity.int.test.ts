import { fileURLToPath } from "node:url";
import { createEntry, type EntryDraft, isUuidV7, money } from "@app/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, entries, entryVersions } from "../schema";
import { createDatabase, withTenant } from "../src/client";
import { seedSystemCategories } from "../src/system-categories";
import { uuidv7 } from "../src/uuid";
import { asTenant, attempt, startTestDatabase, type TestDatabase } from "./database";
import { createTenant, TABLES, type TenantFixture } from "./fixtures";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NO_PRIVILEGE = "42501";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
});

afterAll(async () => {
  await db?.stop();
});

/** INSERT de lançamento do tenant A; `overrides` troca colunas para provocar cada erro. */
function insertEntry(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: uuidv7(),
    tenant_id: a.tenantId,
    unit_id: a.unitId,
    type: "expense",
    occurred_on: "2026-10-27",
    description: "Teste",
    amount_cents: 1000,
    fee_cents: 0,
    net_cents: 1000,
    created_by: a.userId,
    position: 0,
    ...overrides,
  };
  const columns = Object.keys(row);
  return {
    sql: `insert into entries (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    params: Object.values(row),
  };
}

async function tryInsertEntry(overrides: Record<string, unknown>) {
  const { sql: statement, params } = insertEntry(overrides);
  return asTenant(db.app, a.tenantId, (client) => attempt(client, statement, params));
}

describe("idempotência da mensagem", () => {
  it("rejeita o mesmo wa_message_id duas vezes", async () => {
    await expect(
      db.ingest.query(
        "insert into inbound_messages (id, wa_message_id, type, raw) values ($1, $2, 'text', '{}')",
        [uuidv7(), a.waMessageId],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("ON CONFLICT DO NOTHING ignora a duplicata sem erro (webhook reenviado pela Meta)", async () => {
    const result = await db.ingest.query(
      `insert into inbound_messages (id, wa_message_id, type, raw) values ($1, $2, 'text', '{}')
       on conflict (wa_message_id) do nothing`,
      [uuidv7(), a.waMessageId],
    );
    expect(result.rowCount).toBe(0);
  });

  it("reprocessar a mensagem não duplica o lançamento da mesma posição", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      const one = insertEntry({ inbound_message_id: a.inboundMessageId, position: 5 });
      expect(await attempt(client, one.sql, one.params)).toEqual({ rows: 1 });
      const again = insertEntry({ inbound_message_id: a.inboundMessageId, position: 5 });
      expect(await attempt(client, again.sql, again.params)).toEqual({ error: UNIQUE_VIOLATION });
      const other = insertEntry({ inbound_message_id: a.inboundMessageId, position: 6 });
      expect(await attempt(client, other.sql, other.params)).toEqual({ rows: 1 });
    });
  });

  it("lançamentos sem mensagem de origem (painel) não colidem entre si", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      for (let i = 0; i < 2; i++) {
        const { sql: statement, params } = insertEntry();
        expect(await attempt(client, statement, params)).toEqual({ rows: 1 });
      }
    });
  });
});

describe("referências nunca cruzam tenants", () => {
  it.each([
    ["unidade", "unit_id", () => b.unitId],
    ["fornecedor", "supplier_id", () => b.supplierId],
    ["forma de pagamento", "payment_method_id", () => b.paymentMethodId],
    ["canal de venda", "sales_channel_id", () => b.salesChannelId],
    ["mensagem de origem", "inbound_message_id", () => b.inboundMessageId],
    ["categoria", "category_id", () => b.categoryId],
  ])("lançamento do tenant A não aponta para %s do tenant B", async (_nome, column, value) => {
    // position 99: evita colidir com o lançamento existente do tenant B na unicidade
    // (inbound_message_id, position), que o Postgres checa antes da chave estrangeira.
    const result = await tryInsertEntry({ [column]: value(), position: 99 });
    expect(result).toEqual({ error: FOREIGN_KEY_VIOLATION });
  });

  it("aceita as referências do próprio tenant e categoria do sistema", async () => {
    const systemId = uuidv7();
    await db.admin.query(
      "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, null, 'Sistema', 'expense', 'outras')",
      [systemId],
    );
    expect(
      await tryInsertEntry({
        supplier_id: a.supplierId,
        payment_method_id: a.paymentMethodId,
        sales_channel_id: a.salesChannelId,
        category_id: a.categoryId,
      }),
    ).toEqual({ rows: 1 });
    expect(await tryInsertEntry({ category_id: systemId })).toEqual({ rows: 1 });
  });

  it("trocar a categoria de um lançamento existente para a de outro tenant também falha", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      const result = await attempt(client, "update entries set category_id = $1 where id = $2", [
        b.categoryId,
        a.entryId,
      ]);
      expect(result).toEqual({ error: FOREIGN_KEY_VIOLATION });
    });
  });
});

describe("regras de consistência do dinheiro no banco", () => {
  it.each([
    ["valor zero", { amount_cents: 0, net_cents: 0 }],
    ["valor negativo", { amount_cents: -100, net_cents: -100 }],
    [
      "líquido diferente de valor menos taxa",
      { amount_cents: 1000, fee_cents: 100, net_cents: 1000 },
    ],
    ["taxa maior que o valor", { amount_cents: 1000, fee_cents: 1500, net_cents: -500 }],
    ["taxa percentual acima de 100%", { fee_percent_bp: 10001 }],
    ["quantidade zero", { quantity: 0 }],
    ["confiança da IA acima de 1", { ai_confidence: 1.5 }],
    ["tipo inválido", { type: "transfer" }],
  ])("recusa %s", async (_nome, overrides) => {
    expect(await tryInsertEntry(overrides)).toEqual({ error: CHECK_VIOLATION });
  });

  it("guarda valores acima de 2^31 centavos sem perder precisão", async () => {
    const amount = 9_000_000_000_000; // R$ 90 bilhões: exige bigint
    const id = uuidv7();
    const { sql: statement, params } = insertEntry({ id, amount_cents: amount, net_cents: amount });
    await asTenant(db.app, a.tenantId, async (client) => {
      expect(await attempt(client, statement, params)).toEqual({ rows: 1 });
      const { rows } = await client.query("select amount_cents from entries where id = $1", [id]);
      expect(BigInt(rows[0].amount_cents)).toBe(BigInt(amount));
    });
  });

  it("recusa papel de membership fora de owner/manager/staff", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      const result = await attempt(
        client,
        "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, 'admin')",
        [uuidv7(), a.tenantId, b.userId],
      );
      expect(result).toEqual({ error: CHECK_VIOLATION });
    });
  });
});

describe("nada é apagado de verdade", () => {
  it("o app faz soft delete (update de deleted_at), mas não apaga o lançamento", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      const soft = await attempt(client, "update entries set deleted_at = now() where id = $1", [
        a.entryId,
      ]);
      expect(soft).toEqual({ rows: 1 });
      const hard = await attempt(client, "delete from entries where id = $1", [a.entryId]);
      expect(hard).toEqual({ error: NO_PRIVILEGE });
    });
  });

  it("entry_versions, ai_usage e audit_log só aceitam acréscimo", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      for (const table of ["entry_versions", "ai_usage", "audit_log"]) {
        for (const statement of [`update ${table} set id = id`, `delete from ${table}`]) {
          expect(await attempt(client, statement), statement).toEqual({ error: NO_PRIVILEGE });
        }
      }
      const next = await attempt(
        client,
        `insert into entry_versions (id, tenant_id, entry_id, version, action, after, changed_by, channel)
         values ($1, $2, $3, 2, 'update', '{}', $4, 'web')`,
        [uuidv7(), a.tenantId, a.entryId, a.userId],
      );
      expect(next).toEqual({ rows: 1 });
      const duplicate = await attempt(
        client,
        `insert into entry_versions (id, tenant_id, entry_id, version, action, after, changed_by, channel)
         values ($1, $2, $3, 1, 'update', '{}', $4, 'web')`,
        [uuidv7(), a.tenantId, a.entryId, a.userId],
      );
      expect(duplicate).toEqual({ error: UNIQUE_VIOLATION });
    });
  });

  it("mensagens recebidas não podem ser apagadas pelo app", async () => {
    await asTenant(db.app, a.tenantId, async (client) => {
      const result = await attempt(client, "delete from inbound_messages");
      expect(result).toEqual({ error: NO_PRIVILEGE });
    });
  });
});

describe("integração com o núcleo de domínio (@app/core)", () => {
  it("grava e relê um lançamento criado pelo core, com versão e origem", async () => {
    const database = createDatabase(db.app);
    const inboundId = uuidv7();
    await db.admin.query(
      `insert into inbound_messages (id, tenant_id, user_id, wa_message_id, type, text, raw)
       values ($1, $2, $3, $4, 'text', 'vendi 100 no cartão', '{}')`,
      [inboundId, a.tenantId, a.userId, `wamid.${uuidv7()}`],
    );
    const amount = money(10_000);
    if (!amount.ok) throw new Error("valor de teste inválido");
    const draft: EntryDraft = {
      unitId: a.unitId,
      type: "revenue",
      occurredOn: "2026-10-27",
      description: "Venda no cartão",
      quantity: 2.5,
      quantityUnit: "kg",
      amountCents: amount.value,
      feePercentBp: 320,
      feeFixedCents: 0,
      categoryId: a.categoryId,
      supplierId: a.supplierId,
      paymentMethodId: a.paymentMethodId,
      salesChannelId: a.salesChannelId,
      inboundMessageId: inboundId,
    };
    const created = createEntry(draft, {
      id: uuidv7(),
      tenantId: a.tenantId,
      actorId: a.userId,
      channel: "whatsapp",
      at: new Date("2026-10-27T15:00:00.000Z"),
    });
    if (!created.ok) throw new Error(`core recusou o lançamento: ${created.error.code}`);
    const { entry, version } = created.value;
    expect(isUuidV7(entry.id)).toBe(true);

    await withTenant(database, a.tenantId, async (tx) => {
      await tx.insert(entries).values({ ...entry, flags: [...entry.flags] });
      await tx.insert(entryVersions).values({
        tenantId: version.tenantId,
        entryId: version.entryId,
        version: version.version,
        action: version.action,
        before: version.before,
        after: version.after,
        changedBy: version.changedBy,
        channel: version.channel,
        changedAt: version.changedAt,
      });
    });

    const [stored] = await withTenant(database, a.tenantId, (tx) =>
      tx.select().from(entries).where(eq(entries.id, entry.id)),
    );
    expect(stored?.amountCents).toBe(10_000);
    expect(stored?.feeCents).toBe(320);
    expect(stored?.netCents).toBe(9_680);
    expect(stored?.occurredOn).toBe("2026-10-27");
    expect(stored?.quantity).toBe(2.5);
    expect(stored?.inboundMessageId).toBe(inboundId);
    expect(stored?.deletedAt).toBeNull();

    const versions = await withTenant(database, a.tenantId, (tx) =>
      tx.select().from(entryVersions).where(eq(entryVersions.entryId, entry.id)),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, action: "create", channel: "whatsapp" });
  });
});

describe("migrations", () => {
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

  it("aplicam em banco vazio e podem ser reaplicadas sem erro", async () => {
    const fresh = await db.createEmptyDatabase("migration_check");
    const database = drizzle(fresh);
    await migrate(database, { migrationsFolder });
    await migrate(database, { migrationsFolder });
    const { rows } = await fresh.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    expect(rows.map((row) => row.relname)).toEqual([...TABLES]);
  });
});

describe("seed das categorias do sistema", () => {
  it("é idempotente, liga subcategorias ao pai e marca a folha como sensível", async () => {
    const adminDb = createDatabase(db.admin);
    await seedSystemCategories(adminDb);
    const count = async () =>
      (
        await adminDb
          .select({ n: sql<number>`count(*)::int` })
          .from(categories)
          .where(isNull(categories.tenantId))
      )[0]?.n;
    const first = await count();
    expect(first).toBeGreaterThan(10);

    await seedSystemCategories(adminDb);
    expect(await count()).toBe(first);

    const [insumos] = await adminDb
      .select()
      .from(categories)
      .where(and(isNull(categories.tenantId), eq(categories.name, "Insumos")));
    const children = await adminDb
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.parentId, insumos?.id ?? ""));
    expect(children.map((child) => child.name).sort()).toEqual(
      ["Bebidas", "Carnes", "Descartáveis", "Hortifrúti"].sort(),
    );

    const [folha] = await adminDb
      .select()
      .from(categories)
      .where(and(isNull(categories.tenantId), eq(categories.name, "Folha de pagamento")));
    expect(folha?.isSensitive).toBe(true);
  });

  it("as categorias do sistema aparecem para o tenant e continuam somente leitura", async () => {
    const database = createDatabase(db.app);
    const visible = await withTenant(database, a.tenantId, (tx) =>
      tx.select({ name: categories.name }).from(categories).where(isNull(categories.tenantId)),
    );
    expect(visible.map((row) => row.name)).toContain("Salão");
  });

  it("não aceita duas categorias do sistema com o mesmo nome", async () => {
    await expect(
      db.admin.query(
        "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, null, 'Salão', 'revenue', 'receita_bruta')",
        [uuidv7()],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });
});
