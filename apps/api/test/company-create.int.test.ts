import { createHash } from "node:crypto";
import { resolveSender } from "@app/core";
import {
  createAuthStore,
  createDatabase,
  createPool,
  createSenderDirectory,
  createSignupRepo,
  createSignupStore,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createBackgroundTasks } from "../src/infra/auth/background-tasks";
import { createAuth, createAuthGateway } from "../src/infra/auth/create-auth";
import { createSystemClock } from "../src/infra/clock";
import { createMemoryEmailSender } from "../src/infra/email/memory-email-sender";
import {
  type AuthGateway,
  createCheckSession,
  createSessionBlocked,
} from "../src/modules/auth/check-session";
import { createCreateAccount } from "../src/modules/signup/create-account";
import { createCreateCompany } from "../src/modules/signup/create-company";
import { createRequestSignupCode } from "../src/modules/signup/request-signup-code";
import { createVerifySignupCode } from "../src/modules/signup/verify-signup-code";

const ORIGIN = "http://localhost:3000";
const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";

let db: TestDatabase;
let authPool: ReturnType<typeof createPool>;
let ingestPool: ReturnType<typeof createPool>;
let gateway: AuthGateway;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  db = await startTestDatabase();
  authPool = createPool(db.urls.auth);
  ingestPool = createPool(db.urls.ingest);
  const clock = createSystemClock();
  const authDb = createDatabase(authPool);
  const store = createAuthStore(authDb, clock);
  const signupStore = createSignupStore(authDb, clock);
  const email = createMemoryEmailSender();
  const tasks = createBackgroundTasks({ onError: () => undefined, onDrop: () => undefined });
  gateway = createAuthGateway(
    createAuth({
      pool: authPool,
      store,
      email,
      clock,
      secret: SECRET,
      baseUrl: ORIGIN,
      trustedOrigins: [ORIGIN],
      secureCookies: true,
      background: tasks,
    }),
  );
  const repo = createSignupRepo(authDb);
  const checkSession = createCheckSession({ gateway, access: store, clock });
  app = buildApp(
    { LOG_LEVEL: "warn" },
    {
      auth: {
        gateway,
        checkSession,
        sessionBlocked: createSessionBlocked({ gateway, access: store }),
      },
      signup: {
        requestCode: createRequestSignupCode({
          store: signupStore,
          users: store,
          audit: store,
          email,
          clock,
          background: tasks,
          loginUrl: `${ORIGIN}/login`,
        }),
        verifyCode: createVerifySignupCode({ store: signupStore, audit: store, clock }),
        createAccount: createCreateAccount({
          repo,
          receipts: signupStore,
          gateway,
          clock,
          newId: uuidv7,
        }),
        companies: {
          checkSession,
          createCompany: createCreateCompany({ repo, users: store, clock, newId: uuidv7 }),
        },
      },
    },
  );
});

afterAll(async () => {
  await app?.close();
  await authPool?.end();
  await ingestPool?.end();
  await db?.stop();
});

// ---------- apoio ----------

let counter = 0;
const unique = () => {
  counter += 1;
  return `${counter}${uuidv7().slice(-6)}`;
};

/** Celular novo e válido em E.164: DDD 11, nono dígito, 8 dígitos aleatórios. */
function newPhoneE164(): string {
  return `+55119${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
}
/** Mesmo número no formato que a pessoa digita. */
const typed = (e164: string) => `(11) ${e164.slice(5, 10)}-${e164.slice(10)}`;

function newCnpj(): string {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const check = (length: number) => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += (digits[i] as number) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  digits.push(check(12));
  digits.push(check(13));
  return digits.join("");
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

interface SeededUser {
  userId: string;
  email: string;
  tenantId: string;
  cookie: string;
}

/**
 * Usuário com um vínculo ativo numa empresa já existente e uma sessão aberta. `phone: null`
 * simula o contador convidado só por e-mail (DD-20).
 */
async function seedUser(
  options: { role?: string; phone?: string | null; createdAt?: Date } = {},
): Promise<SeededUser> {
  const userId = uuidv7();
  const tenantId = uuidv7();
  const email = `pessoa${unique()}@ex.com`;
  const phone = options.phone === undefined ? newPhoneE164() : options.phone;
  const createdAt = options.createdAt ?? new Date(Date.now() - 60_000);
  await db.admin.query(
    "insert into users (id, name, email, phone_e164, email_verified) values ($1, 'Pessoa', $2, $3, true)",
    [userId, email, phone],
  );
  await db.admin.query("insert into tenants (id, name) values ($1, $2)", [
    tenantId,
    `Antiga ${unique()}`,
  ]);
  await db.admin.query(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, created_at)
     values ($1, $2, $3, $4, true, true, $5)`,
    [uuidv7(), tenantId, userId, options.role ?? "owner", createdAt],
  );
  const cookies = await gateway.openSession({ userId });
  return { userId, email, tenantId, cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
}

interface FormOptions {
  phone?: string;
  cnpj?: string;
  tradeName?: string;
}

function form(options: FormOptions = {}) {
  return {
    ...(options.phone === undefined ? {} : { owner: { phone: options.phone } }),
    company: {
      tradeName: options.tradeName ?? `Nova ${unique()}`,
      legalName: "",
      cnpj: options.cnpj ?? "",
      segment: "restaurant",
      taxRegime: "",
      revenueRange: "",
    },
    unit: { name: "Praia", city: "Maceió", uf: "AL" },
    terms: { accepted: true },
  };
}

function postCompany(body: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url: "/api/companies",
    remoteAddress: "10.9.1.1",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": "vitest",
      ...(cookie === undefined ? {} : { cookie }),
    },
    payload: JSON.stringify(body),
  });
}

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const { rows } = await db.admin.query(`select count(*)::int as n from ${sqlText}`, params);
  return rows[0].n;
}

// ---------- casos ----------

describe("criar outra empresa com usuário logado (F1b, RF01)", () => {
  it("without a session → 401 and nothing written", async () => {
    const body = form();
    const response = await postCompany(body);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: expect.any(String), message: expect.any(String) });
    expect(await count("tenants where name = $1", [body.company.tradeName])).toBe(0);
  });

  it("with a session creates tenant, unit, defaults and an owner membership for the current user; no new user row", async () => {
    const user = await seedUser({ role: "manager" });
    const usersBefore = await count("users", []);
    const accountsBefore = await count("accounts", []);
    const body = form();
    const response = await postCompany(body, user.cookie);
    expect(response.statusCode).toBe(201);
    const { tenantId } = response.json();
    expect(tenantId).toEqual(expect.any(String));
    expect(tenantId).not.toBe(user.tenantId);

    const tenant = (
      await db.admin.query(
        "select name, plan, status, terms_accepted_by, terms_version from tenants where id = $1",
        [tenantId],
      )
    ).rows[0];
    expect(tenant).toMatchObject({
      name: body.company.tradeName,
      plan: "trial",
      status: "active",
      terms_accepted_by: user.userId,
      terms_version: expect.any(String),
    });
    const units = (
      await db.admin.query("select id, name from units where tenant_id = $1", [tenantId])
    ).rows;
    expect(units).toEqual([{ id: expect.any(String), name: "Praia" }]);
    expect(await count("payment_methods where tenant_id = $1", [tenantId])).toBe(6);
    expect(await count("sales_channels where tenant_id = $1", [tenantId])).toBe(5);

    const memberships = (
      await db.admin.query(
        `select user_id, role, all_units, panel_access, status, default_unit_id
           from memberships where tenant_id = $1`,
        [tenantId],
      )
    ).rows;
    expect(memberships).toEqual([
      {
        user_id: user.userId,
        role: "owner",
        all_units: true,
        panel_access: true,
        status: "active",
        default_unit_id: units[0].id,
      },
    ]);
    // O vínculo antigo (gerente) não muda.
    expect(
      await count("memberships where user_id = $1 and tenant_id = $2 and role = 'manager'", [
        user.userId,
        user.tenantId,
      ]),
    ).toBe(1);

    expect(await count("users", [])).toBe(usersBefore);
    expect(await count("accounts", [])).toBe(accountsBefore);
    expect(
      await count(
        "auth_audit where user_id = $1 and event = 'company_created' and email_hash = $2",
        [user.userId, sha256(user.email)],
      ),
    ).toBe(1);
  });

  it("user without phone (accountant) must send a phone; it is saved; without it → 400 phone_required", async () => {
    const accountant = await seedUser({ role: "accountant", phone: null });
    const missing = form();
    const refused = await postCompany(missing, accountant.cookie);
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: "INVALID_FIELDS",
      fields: { "owner.phone": "phone_required" },
    });
    expect(await count("tenants where name = $1", [missing.company.tradeName])).toBe(0);

    const phone = newPhoneE164();
    const accepted = await postCompany(form({ phone: typed(phone) }), accountant.cookie);
    expect(accepted.statusCode).toBe(201);
    const { rows } = await db.admin.query("select phone_e164 from users where id = $1", [
      accountant.userId,
    ]);
    expect(rows[0].phone_e164).toBe(phone);
  });

  it("phone of another user → PHONE_TAKEN and nothing written", async () => {
    const other = await seedUser();
    const { rows } = await db.admin.query("select phone_e164 from users where id = $1", [
      other.userId,
    ]);
    const accountant = await seedUser({ role: "accountant", phone: null });
    const body = form({ phone: typed(rows[0].phone_e164) });
    const response = await postCompany(body, accountant.cookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "PHONE_TAKEN", message: expect.any(String) });
    expect(await count("tenants where name = $1", [body.company.tradeName])).toBe(0);
    const phone = await db.admin.query("select phone_e164 from users where id = $1", [
      accountant.userId,
    ]);
    expect(phone.rows[0].phone_e164).toBeNull();
  });

  it("user who already has a phone keeps it even if the form sends another", async () => {
    const user = await seedUser();
    const before = (
      await db.admin.query("select phone_e164 from users where id = $1", [user.userId])
    ).rows[0].phone_e164;
    const response = await postCompany(form({ phone: typed(newPhoneE164()) }), user.cookie);
    expect(response.statusCode).toBe(201);
    const after = (
      await db.admin.query("select phone_e164 from users where id = $1", [user.userId])
    ).rows[0].phone_e164;
    expect(after).toBe(before);
  });

  it("new membership has preferred_at set and the channel's active-company rule picks the new company", async () => {
    const user = await seedUser({ createdAt: new Date(Date.now() - 86_400_000) });
    const { rows } = await db.admin.query("select phone_e164 from users where id = $1", [
      user.userId,
    ]);
    const directory = createSenderDirectory(createDatabase(ingestPool));
    const before = resolveSender(await directory.findMemberships([rows[0].phone_e164]));
    expect(before.kind === "known" && before.sender.tenantId).toBe(user.tenantId);

    const response = await postCompany(form(), user.cookie);
    expect(response.statusCode).toBe(201);
    const { tenantId } = response.json();
    const membership = (
      await db.admin.query(
        "select preferred_at from memberships where tenant_id = $1 and user_id = $2",
        [tenantId, user.userId],
      )
    ).rows[0];
    expect(membership.preferred_at).toBeInstanceOf(Date);

    const after = resolveSender(await directory.findMemberships([rows[0].phone_e164]));
    expect(after.kind === "known" && after.sender.tenantId).toBe(tenantId);
  });

  it("same cnpj as another open tenant → CNPJ_TAKEN", async () => {
    const cnpj = newCnpj();
    await db.admin.query("insert into tenants (id, name, cnpj) values ($1, 'Dona do CNPJ', $2)", [
      uuidv7(),
      cnpj,
    ]);
    const user = await seedUser();
    const body = form({ cnpj });
    const response = await postCompany(body, user.cookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "CNPJ_TAKEN", message: expect.any(String) });
    expect(await count("tenants where cnpj = $1", [cnpj])).toBe(1);
    expect(await count("tenants where name = $1", [body.company.tradeName])).toBe(0);
    expect(await count("memberships where user_id = $1", [user.userId])).toBe(1);
  });

  it("a user with an inactive membership elsewhere can still create a company", async () => {
    const user = await seedUser();
    const oldTenant = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, $2)", [
      oldTenant,
      `Desligada ${unique()}`,
    ]);
    await db.admin.query(
      `insert into memberships (id, tenant_id, user_id, role, status, deactivated_at)
       values ($1, $2, $3, 'staff', 'deactivated', now())`,
      [uuidv7(), oldTenant, user.userId],
    );
    const response = await postCompany(form(), user.cookie);
    expect(response.statusCode).toBe(201);
    expect(
      await count("memberships where user_id = $1 and role = 'owner' and tenant_id = $2", [
        user.userId,
        response.json().tenantId,
      ]),
    ).toBe(1);
  });
});
