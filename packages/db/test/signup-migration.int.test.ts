import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid";
import { asTenant, attempt, startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

/**
 * Migration do autocadastro (F1b, RF01): colunas novas de `tenants`, `signup_verifications` e o
 * papel `app_auth` gravando a conta nova numa transação só, com INSERT e sem SELECT nem RETURNING.
 */

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

/** Transação do papel `app_auth` (sem `app.tenant_id`) que sempre desfaz. */
async function asAuth<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.auth.connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Transação do papel `app_auth` que confirma no fim (para conferir pelo admin). */
async function asAuthCommitted(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await db.auth.connect();
  try {
    await client.query("begin");
    await fn(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Resultado de um comando: "ok" ou o código SQLSTATE com o nome da restrição. */
async function outcome(
  run: () => Promise<unknown>,
): Promise<"ok" | { code?: string; constraint?: string }> {
  try {
    await run();
    return "ok";
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    return { code, constraint };
  }
}

let cnpjCounter = 0;
/** CNPJ só com dígitos, diferente a cada chamada (o banco não confere dígito verificador). */
const nextCnpj = () => String(10_000_000_000_000 + ++cnpjCounter * 7919);

const insertTenant = (client: pg.PoolClient | pg.Pool, id: string, cnpj: string | null) =>
  client.query("insert into tenants (id, name, cnpj) values ($1, 'Novo', $2)", [id, cnpj]);

describe("tenants: campos do autocadastro (RF01)", () => {
  it("nasce com status active e aceita os campos do cadastro", async () => {
    const id = uuidv7();
    await db.admin.query(
      `insert into tenants (id, name, legal_name, cnpj, segment, revenue_range, trial_started_at,
         trial_ends_at, terms_accepted_at, terms_version, privacy_version, dpa_version, terms_accepted_by)
       values ($1, 'Bar do Zé', 'Zé Ltda', $2, 'bar', 'up_to_30k', now(), now() + interval '14 days',
         now(), '2026-11-09', '2026-11-09', '2026-11-09', $3)`,
      [id, nextCnpj(), a.userId],
    );
    const { rows } = await db.admin.query("select status, plan from tenants where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "active", plan: "trial" });
  });

  it.each([
    ["status", "'paused'"],
    ["segment", "'boate'"],
    ["revenue_range", "'muito'"],
    ["cnpj", "'12.345.678/0001-90'"],
    ["cnpj", "'1234567800019'"],
    ["cnpj", "'12abc34501de35'"],
    ["cnpj", "'12ABC34501DEAB'"],
  ])("%s fora do domínio é recusado (23514)", async (column, value) => {
    const result = await outcome(() =>
      db.admin.query(`insert into tenants (id, name, ${column}) values ($1, 'X', ${value})`, [
        uuidv7(),
      ]),
    );
    expect(result).toMatchObject({ code: CHECK_VIOLATION });
  });

  it("cnpj alfanumérico em maiúsculas é aceito", async () => {
    const result = await outcome(() => insertTenant(db.admin, uuidv7(), "12ABC34501DE35"));
    expect(result).toBe("ok");
  });

  it("terms_accepted_by aponta para users (23503 se não existe)", async () => {
    const result = await outcome(() =>
      db.admin.query("insert into tenants (id, name, terms_accepted_by) values ($1, 'X', $2)", [
        uuidv7(),
        uuidv7(),
      ]),
    );
    expect(result).toMatchObject({ code: "23503" });
  });
});

describe("CNPJ único entre contas não encerradas (RF01.R3, CA04)", () => {
  it("second tenant with same cnpj fails with 23505 on tenants_cnpj_open_unique", async () => {
    const cnpj = nextCnpj();
    await insertTenant(db.admin, uuidv7(), cnpj);
    const result = await asAuth((client) => outcome(() => insertTenant(client, uuidv7(), cnpj)));
    expect(result).toEqual({ code: UNIQUE_VIOLATION, constraint: "tenants_cnpj_open_unique" });
  });

  it("same cnpj allowed when the first tenant is closed", async () => {
    const cnpj = nextCnpj();
    await db.admin.query(
      "insert into tenants (id, name, cnpj, status) values ($1, 'Antiga', $2, 'closed')",
      [uuidv7(), cnpj],
    );
    const result = await asAuth((client) => outcome(() => insertTenant(client, uuidv7(), cnpj)));
    expect(result).toBe("ok");
  });

  it("canceled (ainda não encerrada) continua bloqueando o CNPJ", async () => {
    const cnpj = nextCnpj();
    await db.admin.query(
      "insert into tenants (id, name, cnpj, status) values ($1, 'Cancelada', $2, 'canceled')",
      [uuidv7(), cnpj],
    );
    const result = await outcome(() => insertTenant(db.admin, uuidv7(), cnpj));
    expect(result).toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("two tenants with null cnpj are allowed", async () => {
    await insertTenant(db.admin, uuidv7(), null);
    const result = await asAuth((client) => outcome(() => insertTenant(client, uuidv7(), null)));
    expect(result).toBe("ok");
  });
});

describe("papel app_auth no autocadastro", () => {
  it("app_auth can insert tenant, unit, user, membership, channels, payment methods and tax_settings in one transaction", async () => {
    const ids = {
      tenant: uuidv7(),
      user: uuidv7(),
      account: uuidv7(),
      channel: uuidv7(),
      otherChannel: uuidv7(),
      unit: uuidv7(),
      membership: uuidv7(),
      membershipUnit: uuidv7(),
      pix: uuidv7(),
      card: uuidv7(),
      tax: uuidv7(),
      verification: uuidv7(),
    };
    const email = `dono.${ids.user}@exemplo.com`;
    await asAuthCommitted(async (client) => {
      await client.query(
        `insert into signup_verifications (id, email, kind, code_hash, ip, expires_at)
         values ($1, $2, 'code', 'hash', '127.0.0.1', now() + interval '10 minutes')`,
        [ids.verification, email],
      );
      await client.query(
        `insert into users (id, name, email, phone_e164, email_verified)
         values ($1, 'Dona Nova', $2, $3, true)`,
        [ids.user, email, `+55119${String(ids.user).replace(/\D/g, "").slice(-8)}`],
      );
      await client.query(
        `insert into accounts (id, account_id, provider_id, user_id, password)
         values ($1, $2::text, 'credential', $2::uuid, 'salt:hash')`,
        [ids.account, ids.user],
      );
      await client.query(
        `insert into tenants (id, name, legal_name, cnpj, segment, revenue_range, status, trial_started_at,
           trial_ends_at, terms_accepted_at, terms_version, privacy_version, dpa_version, terms_accepted_by)
         values ($1, 'Cantina Nova', 'Cantina Nova Ltda', $2, 'restaurant', 'prefer_not_to_say', 'active',
           now(), now() + interval '14 days', now(), '2026-11-09', '2026-11-09', '2026-11-09', $3)`,
        [ids.tenant, nextCnpj(), ids.user],
      );
      await client.query(
        `insert into sales_channels (id, tenant_id, name, type) values
           ($1, $3, 'Salão', 'dine_in'), ($2, $3, 'iFood', 'app')`,
        [ids.channel, ids.otherChannel, ids.tenant],
      );
      await client.query(
        `insert into units (id, tenant_id, name, city, uf, timezone, default_sales_channel_id)
         values ($1, $2, 'Cantina Nova', 'Recife', 'PE', 'America/Recife', $3)`,
        [ids.unit, ids.tenant, ids.channel],
      );
      await client.query(
        `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, default_unit_id)
         values ($1, $2, $3, 'owner', true, true, $4)`,
        [ids.membership, ids.tenant, ids.user, ids.unit],
      );
      await client.query(
        `insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)`,
        [ids.membershipUnit, ids.tenant, ids.membership, ids.unit],
      );
      await client.query(
        `insert into payment_methods (id, tenant_id, name, type, is_default_card) values
           ($1, $3, 'Pix', 'pix', false), ($2, $3, 'Crédito', 'credit', true)`,
        [ids.pix, ids.card, ids.tenant],
      );
      await client.query(
        `insert into tax_settings (id, tenant_id, valid_from, enabled, regime, created_by)
         values ($1, $2, '2026-11-09', false, 'not_sure', $3)`,
        [ids.tax, ids.tenant, ids.user],
      );
      for (const event of [
        "signup_code_sent",
        "signup_verified",
        "signup_completed",
        "company_created",
      ]) {
        await client.query(
          "insert into auth_audit (id, user_id, email_hash, event) values ($1, $2, 'h', $3)",
          [uuidv7(), ids.user, event],
        );
      }
    });

    const { rows } = await db.admin.query(
      `select t.status, t.plan, u.default_sales_channel_id, m.role, m.all_units, m.panel_access,
              (select count(*)::int from sales_channels where tenant_id = t.id) as channels,
              (select count(*)::int from payment_methods where tenant_id = t.id) as payment_methods,
              (select count(*)::int from membership_units where tenant_id = t.id) as membership_units,
              (select count(*)::int from tax_settings where tenant_id = t.id) as tax_settings
         from tenants t join units u on u.tenant_id = t.id join memberships m on m.tenant_id = t.id
        where t.id = $1`,
      [ids.tenant],
    );
    expect(rows).toEqual([
      {
        status: "active",
        plan: "trial",
        default_sales_channel_id: ids.channel,
        role: "owner",
        all_units: true,
        panel_access: true,
        channels: 2,
        payment_methods: 2,
        membership_units: 1,
        tax_settings: 1,
      },
    ]);
  });

  it("insert into units with default_sales_channel_id succeeds when channels are inserted first", async () => {
    await asAuth(async (client) => {
      const tenant = uuidv7();
      const channel = uuidv7();
      await insertTenant(client, tenant, null);
      await client.query(
        "insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Salão')",
        [channel, tenant],
      );
      expect(
        await attempt(
          client,
          "insert into units (id, tenant_id, name, default_sales_channel_id) values ($1, $2, 'Matriz', $3)",
          [uuidv7(), tenant, channel],
        ),
      ).toEqual({ rows: 1 });
      // A chave composta continua barrando canal de outro tenant (sem leitura do app_auth).
      expect(
        await attempt(
          client,
          "insert into units (id, tenant_id, name, default_sales_channel_id) values ($1, $2, 'Filial', $3)",
          [uuidv7(), tenant, a.salesChannelId],
        ),
      ).toEqual({ error: "23503" });
    });
  });

  it("membership_units/units insert with RLS forced works without RETURNING", async () => {
    await asAuth(async (client) => {
      const tenant = uuidv7();
      const unit = uuidv7();
      const membership = uuidv7();
      await insertTenant(client, tenant, null);
      expect(
        await attempt(client, "insert into units (id, tenant_id, name) values ($1, $2, 'U')", [
          unit,
          tenant,
        ]),
      ).toEqual({ rows: 1 });
      expect(
        await attempt(
          client,
          "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, 'manager')",
          [membership, tenant, a.userId],
        ),
      ).toEqual({ rows: 1 });
      expect(
        await attempt(
          client,
          "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
          [uuidv7(), tenant, membership, unit],
        ),
      ).toEqual({ rows: 1 });
      // Com RETURNING o papel precisaria de SELECT, que ele não tem.
      expect(
        await attempt(
          client,
          "insert into units (id, tenant_id, name) values ($1, $2, 'V') returning id",
          [uuidv7(), tenant],
        ),
      ).toEqual({ error: NO_PRIVILEGE });
    });
  });

  it("app_auth cannot select from tenants, units, payment_methods, sales_channels", async () => {
    await asAuth(async (client) => {
      for (const table of [
        "tenants",
        "units",
        "payment_methods",
        "sales_channels",
        "membership_units",
        "tax_settings",
      ]) {
        expect(await attempt(client, `select 1 from ${table} limit 1`), table).toEqual({
          error: NO_PRIVILEGE,
        });
      }
    });
  });

  it("app_auth não altera nem apaga tabelas de cliente", async () => {
    await asAuth(async (client) => {
      for (const statement of [
        "update tenants set name = 'X'",
        "delete from tenants",
        "update units set name = 'X'",
        "delete from memberships",
        "delete from payment_methods",
      ]) {
        expect(await attempt(client, statement), statement).toEqual({ error: NO_PRIVILEGE });
      }
    });
  });

  it("app_auth grava, lê e consome signup_verifications", async () => {
    await asAuth(async (client) => {
      const id = uuidv7();
      await client.query(
        `insert into signup_verifications (id, email, kind, ip, expires_at)
         values ($1, 'aviso@exemplo.com', 'notice', '10.0.0.1', now() + interval '10 minutes')`,
        [id],
      );
      const seen = await client.query(
        "select attempts, consumed_at from signup_verifications where id = $1",
        [id],
      );
      expect(seen.rows).toEqual([{ attempts: 0, consumed_at: null }]);
      expect(
        await attempt(
          client,
          "update signup_verifications set attempts = attempts + 1, consumed_at = now() where id = $1",
          [id],
        ),
      ).toEqual({ rows: 1 });
      expect(await attempt(client, "delete from signup_verifications where id = $1", [id])).toEqual(
        { rows: 1 },
      );
    });
  });

  it("signup_verifications: kind fora da lista, código sem hash e aviso com hash são recusados", async () => {
    for (const [kind, codeHash] of [
      ["sms", "h"],
      ["code", null],
      ["notice", "h"],
    ] as const) {
      const result = await outcome(() =>
        db.admin.query(
          `insert into signup_verifications (id, email, kind, code_hash, expires_at)
           values ($1, 'x@exemplo.com', $2, $3, now())`,
          [uuidv7(), kind, codeHash],
        ),
      );
      expect(result, `${kind}/${codeHash}`).toMatchObject({ code: CHECK_VIOLATION });
    }
  });
});

describe("app and app_ingest cannot touch signup_verifications", () => {
  it("app and app_ingest cannot touch signup_verifications", async () => {
    const statements = [
      "select 1 from signup_verifications",
      "insert into signup_verifications (id, email, kind, expires_at) values (gen_random_uuid(), 'x@x.com', 'notice', now())",
      "update signup_verifications set attempts = 0",
      "delete from signup_verifications",
    ];
    await asTenant(db.app, a.tenantId, async (client) => {
      for (const statement of statements) {
        expect(await attempt(client, statement), statement).toEqual({ error: NO_PRIVILEGE });
      }
    });
    const ingest = await db.ingest.connect();
    try {
      await ingest.query("begin");
      for (const statement of statements) {
        expect(await attempt(ingest, statement), statement).toEqual({ error: NO_PRIVILEGE });
      }
    } finally {
      await ingest.query("rollback").catch(() => undefined);
      ingest.release();
    }
  });
});
