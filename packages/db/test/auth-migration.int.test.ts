import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid";
import { asTenant, attempt, startTestDatabase, type TestDatabase } from "./database";
import { AUTH_TABLES, createTenant, TABLES, type TenantFixture } from "./fixtures";
import { migrateAll, migrateUpTo } from "./staged-migrations";

const NO_PRIVILEGE = "42501";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

let db: TestDatabase;
let a: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
});

afterAll(async () => {
  await db?.stop();
});

/** Roda `fn` numa transação do pool `auth` sem `app.tenant_id` e sempre desfaz. */
async function asAuth<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await db.auth.connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

describe("meta: tabelas de autenticação", () => {
  it("TABLES inclui as quatro tabelas novas e AUTH_TABLES as lista", () => {
    expect([...AUTH_TABLES]).toEqual(["sessions", "accounts", "verifications", "auth_audit"]);
    for (const table of AUTH_TABLES) expect(TABLES as readonly string[]).toContain(table);
  });
});

describe("users com phone_e164 opcional", () => {
  it("aceita phone_e164 nulo e mantém unicidade quando existe", async () => {
    await db.admin.query("insert into users (id, name) values ($1, 'Sem telefone 1')", [uuidv7()]);
    await db.admin.query("insert into users (id, name) values ($1, 'Sem telefone 2')", [uuidv7()]);
    const phone = "+5511988887777";
    await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Com', $2)", [
      uuidv7(),
      phone,
    ]);
    const duplicate = await db.admin
      .query("insert into users (id, name, phone_e164) values ($1, 'Outro', $2)", [uuidv7(), phone])
      .then(
        () => "ok",
        (error: { code?: string }) => error.code,
      );
    expect(duplicate).toBe(UNIQUE_VIOLATION);
  });

  it("tem os padrões de e-mail verificado e de tentativas de senha", async () => {
    const { rows } = await db.admin.query(
      "select email_verified, failed_password_attempts, password_locked_until, last_login_at from users where id = $1",
      [a.userId],
    );
    expect(rows[0]).toEqual({
      email_verified: false,
      failed_password_attempts: 0,
      password_locked_until: null,
      last_login_at: null,
    });
  });
});

describe("users.email normalizado", () => {
  it("e-mail com maiúsculas ou espaços nas pontas é recusado (23514); minúsculo entra", async () => {
    for (const email of ["A@x.com", " a@x.com", "a@x.com "]) {
      const result = await db.admin
        .query("insert into users (id, name, email) values ($1, 'X', $2)", [uuidv7(), email])
        .then(
          () => "ok",
          (error: { code?: string }) => error.code,
        );
      expect(result, email).toBe(CHECK_VIOLATION);
    }
    await db.admin.query("insert into users (id, name, email) values ($1, 'X', 'a@x.com')", [
      uuidv7(),
    ]);
  });
});

describe("migração 0012: e-mails antigos", () => {
  it("normaliza e-mails já gravados antes de criar o CHECK", async () => {
    const legacy = await db.createEmptyDatabase("legacy_emails");
    await migrateUpTo(legacy, "0011_auth");
    const id = uuidv7();
    await legacy.query("insert into users (id, name, email) values ($1, 'Antigo', $2)", [
      id,
      "  Dono@Ex.COM ",
    ]);
    await migrateAll(legacy);
    const { rows } = await legacy.query("select email from users where id = $1", [id]);
    expect(rows[0]).toEqual({ email: "dono@ex.com" });
  });

  it("dois e-mails que só diferem por caixa: a migração para (índice único) em vez de juntar contas", async () => {
    const legacy = await db.createEmptyDatabase("legacy_email_clash");
    await migrateUpTo(legacy, "0011_auth");
    for (const email of ["a@ex.com", "A@ex.com"]) {
      await legacy.query("insert into users (id, name, email) values ($1, 'X', $2)", [
        uuidv7(),
        email,
      ]);
    }
    const result = await migrateAll(legacy).then(
      () => "ok",
      (error: { cause?: { code?: string }; code?: string }) => error.cause?.code ?? error.code,
    );
    expect(result).toBe(UNIQUE_VIOLATION);
  });
});

describe("sessions.keep_connected (RF02.R5)", () => {
  it("nasce falso: sem 'manter conectado' por padrão", async () => {
    const id = uuidv7();
    await db.admin.query(
      "insert into sessions (id, user_id, token, expires_at) values ($1, $2, $3, now())",
      [id, a.userId, `token.${id}`],
    );
    const { rows } = await db.admin.query("select keep_connected from sessions where id = $1", [
      id,
    ]);
    expect(rows[0]).toEqual({ keep_connected: false });
  });
});

describe("papel app_auth", () => {
  it("app_auth lê e grava users sem app.tenant_id", async () => {
    await asAuth(async (client) => {
      const seen = await client.query("select id from users where id = $1", [a.userId]);
      expect(seen.rowCount).toBe(1);
      const updated = await client.query(
        "update users set email_verified = true, last_login_at = now() where id = $1",
        [a.userId],
      );
      expect(updated.rowCount).toBe(1);
    });
  });

  it("app_auth lê memberships sem tenant", async () => {
    await asAuth(async (client) => {
      const seen = await client.query("select id from memberships where user_id = $1", [a.userId]);
      expect(seen.rowCount).toBe(1);
      expect(
        await attempt(client, "update memberships set status = 'deactivated' where user_id = $1", [
          a.userId,
        ]),
      ).toEqual({ error: NO_PRIVILEGE });
    });
  });

  it("app_auth lê e grava sessions, accounts e verifications sem tenant", async () => {
    await asAuth(async (client) => {
      const sessionId = uuidv7();
      await client.query(
        `insert into sessions (id, user_id, token, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
        [sessionId, a.userId, `tok-${sessionId}`],
      );
      expect(
        (await client.query("select 1 from sessions where id = $1", [sessionId])).rowCount,
      ).toBe(1);
      expect((await client.query("delete from sessions where id = $1", [sessionId])).rowCount).toBe(
        1,
      );
      expect((await client.query("select 1 from accounts")).rowCount).toBeGreaterThan(0);
      expect((await client.query("select 1 from verifications")).rowCount).toBeGreaterThan(0);
    });
  });

  it("app_auth não lê tabelas de cliente (menor privilégio)", async () => {
    await asAuth(async (client) => {
      for (const table of ["entries", "tenants", "inbound_messages", "units", "audit_log"]) {
        expect(await attempt(client, `select 1 from ${table} limit 1`), table).toEqual({
          error: NO_PRIVILEGE,
        });
      }
      expect(await attempt(client, "delete from users")).toEqual({ error: NO_PRIVILEGE });
    });
  });

  it("app_auth acrescenta e lê auth_audit, mas não altera nem apaga", async () => {
    await asAuth(async (client) => {
      await client.query(
        "insert into auth_audit (id, user_id, email_hash, event) values ($1, $2, 'h', 'login')",
        [uuidv7(), a.userId],
      );
      expect((await client.query("select 1 from auth_audit")).rowCount).toBeGreaterThan(0);
      expect(await attempt(client, "update auth_audit set ip = '1.1.1.1'")).toEqual({
        error: NO_PRIVILEGE,
      });
      expect(await attempt(client, "delete from auth_audit")).toEqual({ error: NO_PRIVILEGE });
    });
  });

  it("event fora da lista é recusado em auth_audit", async () => {
    const result = await db.admin
      .query("insert into auth_audit (id, event) values ($1, 'invalido')", [uuidv7()])
      .then(
        () => "ok",
        (error: { code?: string }) => error.code,
      );
    expect(result).toBe(CHECK_VIOLATION);
  });
});

describe("papéis app e app_ingest não acessam tabelas de autenticação", () => {
  it.each([...AUTH_TABLES])("%s: app e app_ingest recebem erro de privilégio", async (table) => {
    await asTenant(db.app, a.tenantId, async (client) => {
      expect(await attempt(client, `select 1 from ${table}`)).toEqual({ error: NO_PRIVILEGE });
      expect(await attempt(client, `delete from ${table}`)).toEqual({ error: NO_PRIVILEGE });
    });
    const ingest = await db.ingest.connect();
    try {
      await ingest.query("begin");
      expect(await attempt(ingest, `select 1 from ${table}`)).toEqual({ error: NO_PRIVILEGE });
    } finally {
      await ingest.query("rollback").catch(() => undefined);
      ingest.release();
    }
  });

  it.each([...AUTH_TABLES])("%s: FORCE RLS ligado e política só para app_auth", async (table) => {
    const { rows } = await db.admin.query<{ roles: string[]; force: boolean }>(
      `select (select array_agg(distinct r::text) from pg_policies p, unnest(p.roles) r
                where p.schemaname = 'public' and p.tablename = c.relname) as roles,
              c.relforcerowsecurity as force
         from pg_class c where c.relname = $1 and c.relkind = 'r'`,
      [table],
    );
    expect(rows[0]?.force).toBe(true);
    expect(rows[0]?.roles).toEqual(["app_auth"]);
  });
});
