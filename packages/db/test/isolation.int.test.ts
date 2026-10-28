import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "../src/client";
import { asTenant, attempt, startTestDatabase, type TestDatabase } from "./database";
import { createTenant, insertsFor, TABLES, type TenantFixture } from "./fixtures";

const RLS_VIOLATION_OR_NO_PRIVILEGE = "42501";

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

/** Como identificar as linhas do tenant `f` em cada tabela (tenants e users não têm tenant_id). */
function ownedBy(table: string, f: TenantFixture): { where: string; params: unknown[] } {
  if (table === "tenants") return { where: "id = $1", params: [f.tenantId] };
  if (table === "users") return { where: "id = $1", params: [f.userId] };
  return { where: "tenant_id = $1", params: [f.tenantId] };
}

async function publicTables(): Promise<string[]> {
  const { rows } = await db.admin.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
  );
  return rows.map((row) => row.relname);
}

describe("isolamento entre tenants, tabela por tabela", () => {
  it("a matriz de testes cobre exatamente as tabelas que existem no banco", async () => {
    expect([...TABLES]).toEqual(await publicTables());
    expect(Object.keys(insertsFor(b)).sort()).toEqual([...TABLES]);
  });

  describe.each([...TABLES])("%s", (table) => {
    it("tenant A não lê linhas do tenant B, mas lê as próprias", async () => {
      const foreign = ownedBy(table, b);
      const own = ownedBy(table, a);
      await asTenant(db.app, a.tenantId, async (client) => {
        const seenForeign = await client.query(
          `select count(*)::int as n from ${table} where ${foreign.where}`,
          foreign.params,
        );
        expect(seenForeign.rows[0].n).toBe(0);
        const seenOwn = await client.query(
          `select count(*)::int as n from ${table} where ${own.where}`,
          own.params,
        );
        expect(seenOwn.rows[0].n).toBeGreaterThan(0);
      });
      // Controle: as linhas do tenant B existem de fato (o teste não é vazio).
      const real = await db.admin.query(
        `select count(*)::int as n from ${table} where ${foreign.where}`,
        foreign.params,
      );
      expect(real.rows[0].n).toBeGreaterThan(0);
    });

    it("tenant A não altera nem apaga linhas do tenant B", async () => {
      const foreign = ownedBy(table, b);
      await asTenant(db.app, a.tenantId, async (client) => {
        for (const statement of [
          `update ${table} set id = id where ${foreign.where}`,
          `delete from ${table} where ${foreign.where}`,
        ]) {
          const result = await attempt(client, statement, foreign.params);
          // Zero linhas afetadas (RLS) ou privilégio negado (tabela só de acréscimo).
          if ("rows" in result) expect(result.rows, statement).toBe(0);
          else expect(result.error, statement).toBe(RLS_VIOLATION_OR_NO_PRIVILEGE);
        }
      });
      const after = await db.admin.query(
        `select count(*)::int as n from ${table} where ${foreign.where}`,
        foreign.params,
      );
      expect(after.rows[0].n).toBeGreaterThan(0);
    });

    it("tenant A não insere linhas para o tenant B", async () => {
      const { sql, params } = insertsFor(b)[table] ?? { sql: "", params: [] };
      await asTenant(db.app, a.tenantId, async (client) => {
        expect(await attempt(client, sql, params)).toEqual({
          error: RLS_VIOLATION_OR_NO_PRIVILEGE,
        });
      });
    });
  });
});

describe("RLS no banco", () => {
  it("toda tabela do schema public tem RLS ligado, forçado e pelo menos uma política", async () => {
    const { rows } = await db.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: number;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname}: RLS desligado`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname}: FORCE desligado`).toBe(true);
      expect(row.policies, `${row.relname}: sem política`).toBeGreaterThan(0);
    }
  });

  it("toda tabela com tenant_id está coberta pelo meta-teste (nenhuma escapa)", async () => {
    const { rows } = await db.admin.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'tenant_id'`,
    );
    const covered = new Set<string>(TABLES);
    for (const row of rows) expect(covered.has(row.table_name), row.table_name).toBe(true);
  });

  it("os papéis da aplicação não têm BYPASSRLS nem superusuário", async () => {
    const { rows } = await db.admin.query<{
      rolname: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      "select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('app', 'app_ingest')",
    );
    expect(rows.map((row) => row.rolname).sort()).toEqual(["app", "app_ingest"]);
    for (const row of rows) {
      expect(row.rolbypassrls, row.rolname).toBe(false);
      expect(row.rolsuper, row.rolname).toBe(false);
    }
  });

  it("os papéis da aplicação não são donos de nenhuma tabela", async () => {
    const { rows } = await db.admin.query(
      `select tablename from pg_tables
       where schemaname = 'public' and tableowner in ('app', 'app_ingest')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("query sem withTenant", () => {
  it("o papel app, sem tenant definido, não vê nenhuma linha", async () => {
    for (const table of TABLES) {
      const { rows } = await db.app.query(`select count(*)::int as n from ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it("o tenant não vaza para a próxima transação que reutiliza a conexão", async () => {
    const single = new pg.Pool({ connectionString: db.app.options.connectionString, max: 1 });
    try {
      const database = createDatabase(single);
      const inside = await withTenant(database, a.tenantId, (tx) =>
        tx.execute<{ n: number }>(sql`select count(*)::int as n from entries`),
      );
      expect(inside.rows[0]?.n).toBe(1);
      // Mesma conexão, fora de withTenant: o parâmetro voltou ao valor vazio.
      const outside = await single.query("select count(*)::int as n from entries");
      expect(outside.rows[0].n).toBe(0);
    } finally {
      await single.end();
    }
  });

  it("withTenant mostra ao tenant só os próprios lançamentos", async () => {
    const database = createDatabase(db.app);
    for (const [mine, theirs] of [
      [a, b],
      [b, a],
    ] as const) {
      const { rows } = await withTenant(database, mine.tenantId, (tx) =>
        tx.execute<{ id: string }>(sql`select id from entries`),
      );
      expect(rows.map((row) => row.id)).toEqual([mine.entryId]);
      expect(rows.map((row) => row.id)).not.toContain(theirs.entryId);
    }
  });
});

describe("categorias do sistema", () => {
  it("são visíveis para qualquer tenant, mas o app não as altera nem cria", async () => {
    const systemId = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group)
       values ($1, null, 'Do sistema', 'revenue', 'receita_bruta')`,
      [systemId],
    );
    await asTenant(db.app, a.tenantId, async (client) => {
      const visible = await client.query("select 1 from categories where id = $1", [systemId]);
      expect(visible.rowCount).toBe(1);
      expect(
        await attempt(client, "update categories set name = 'X' where id = $1", [systemId]),
      ).toEqual({ rows: 0 });
      expect(await attempt(client, "delete from categories where id = $1", [systemId])).toEqual({
        rows: 0,
      });
      expect(
        await attempt(
          client,
          "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, null, 'Nova', 'expense', 'outras')",
          ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"],
        ),
      ).toEqual({ error: RLS_VIOLATION_OR_NO_PRIVILEGE });
    });
  });
});

describe("papel de ingestão (app_ingest)", () => {
  it("grava mensagem sem tenant, que nenhum tenant enxerga", async () => {
    const waMessageId = `wamid.sem-tenant-${Date.now()}`;
    await db.ingest.query(
      `insert into inbound_messages (id, wa_message_id, type, raw) values ($1, $2, 'text', '{}')`,
      ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60", waMessageId],
    );
    for (const tenant of [a, b]) {
      await asTenant(db.app, tenant.tenantId, async (client) => {
        const seen = await client.query("select 1 from inbound_messages where wa_message_id = $1", [
          waMessageId,
        ]);
        expect(seen.rowCount).toBe(0);
      });
    }
  });

  it("identifica o remetente pelo telefone e atribui a mensagem ao tenant", async () => {
    const user = await db.ingest.query<{ id: string; tenant_id: string }>(
      `select u.id, m.tenant_id from users u join memberships m on m.user_id = u.id
       where u.phone_e164 = $1`,
      [a.phone],
    );
    expect(user.rows).toEqual([{ id: a.userId, tenant_id: a.tenantId }]);

    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61";
    await db.ingest.query(
      `insert into inbound_messages (id, wa_message_id, type, raw) values ($1, 'wamid.atribuir', 'text', '{}')`,
      [id],
    );
    const updated = await db.ingest.query(
      "update inbound_messages set tenant_id = $2, user_id = $3, status = 'processing' where id = $1",
      [id, a.tenantId, a.userId],
    );
    expect(updated.rowCount).toBe(1);
    await asTenant(db.app, a.tenantId, async (client) => {
      const seen = await client.query("select 1 from inbound_messages where id = $1", [id]);
      expect(seen.rowCount).toBe(1);
    });
  });

  it("não lê nem grava dados financeiros e não apaga mensagens", async () => {
    for (const statement of [
      "select 1 from entries",
      "select 1 from categories",
      "select 1 from suppliers",
      "select 1 from entry_versions",
      "select 1 from ai_usage",
      "select 1 from audit_log",
      "select 1 from pending_questions",
      "delete from inbound_messages",
      "insert into users (id, name, phone_e164) values (gen_random_uuid(), 'X', '+5511900000001')",
    ]) {
      await expect(db.ingest.query(statement), statement).rejects.toMatchObject({ code: "42501" });
    }
  });
});
