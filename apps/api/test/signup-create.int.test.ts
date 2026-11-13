import { createHash, randomBytes } from "node:crypto";
import { TRIAL_DAYS } from "@app/core";
import {
  createAuthStore,
  createDatabase,
  createPanelAccessStore,
  createPool,
  createSignupRepo,
  createSignupStore,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createBackgroundTasks } from "../src/infra/auth/background-tasks";
import { createAuth, createAuthGateway } from "../src/infra/auth/create-auth";
import { createSystemClock } from "../src/infra/clock";
import { createMemoryEmailSender } from "../src/infra/email/memory-email-sender";
import {
  createCheckEntry,
  createCheckSession,
  createSessionBlocked,
} from "../src/modules/auth/check-session";
import { createCreateAccount } from "../src/modules/signup/create-account";
import { createRequestSignupCode } from "../src/modules/signup/request-signup-code";
import { createVerifySignupCode } from "../src/modules/signup/verify-signup-code";

const ORIGIN = "http://localhost:3000";
const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "__Secure-better-auth.session_token=";

let db: TestDatabase;
let authPool: ReturnType<typeof createPool>;
let appPool: ReturnType<typeof createPool>;
let app: ReturnType<typeof buildApp>;
/** Liga a falha injetada logo depois do INSERT da unidade (CA08). */
let failAfterUnit = false;
/** Quantas vezes o hash de senha (scrypt) rodou: comprovante falso não pode chegar lá. */
let hashCalls = 0;

beforeAll(async () => {
  db = await startTestDatabase();
  authPool = createPool(db.urls.auth);
  appPool = createPool(db.urls.app);
  const clock = createSystemClock();
  const authDb = createDatabase(authPool);
  const store = createAuthStore(authDb, clock);
  const signupStore = createSignupStore(authDb, clock);
  const email = createMemoryEmailSender();
  const tasks = createBackgroundTasks({ onError: () => undefined, onDrop: () => undefined });
  const gateway = createAuthGateway(
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
    { store, clock, background: tasks },
  );
  const repo = createSignupRepo(authDb, {
    afterUnitInsert: async () => {
      if (failAfterUnit) throw new Error("falha injetada");
    },
  });
  app = buildApp(
    { LOG_LEVEL: "warn", APP_URL: ORIGIN },
    {
      auth: {
        gateway,
        checkSession: createCheckSession({ gateway, access: store, clock }),
        sessionBlocked: createSessionBlocked({ gateway, access: store }),
        secure: true,
      },
      panel: {
        checkSession: createCheckSession({ gateway, access: store, clock }),
        checkEntry: createCheckEntry({ gateway, access: store, clock }),
        access: createPanelAccessStore(authDb),
        appDb: createDatabase(appPool),
        secure: true,
      },
      signup: {
        secure: true,
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
          gateway: {
            ...gateway,
            hashPassword: (password) => {
              hashCalls += 1;
              return gateway.hashPassword(password);
            },
          },
          clock,
          newId: uuidv7,
        }),
      },
    },
  );
});

afterAll(async () => {
  await app?.close();
  await authPool?.end();
  await appPool?.end();
  await db?.stop();
});

// ---------- apoio ----------

let counter = 0;
const unique = () => {
  counter += 1;
  return `${counter}${uuidv7().slice(-6)}`;
};
const newEmail = () => `dono${unique()}@ex.com`;

/** Celular novo e válido: DDD 11, nono dígito, 8 dígitos variando por teste. */
function newPhone(): string {
  const n = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
  return `(11) 9${n.slice(0, 4)}-${n.slice(4)}`;
}

/** CNPJ válido aleatório (dígitos verificadores calculados). */
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

/** Comprovante válido por 30 min para o e-mail, como o `/api/signup/verify` deixaria. */
async function issueReceipt(address: string): Promise<string> {
  const receipt = randomBytes(32).toString("base64url");
  await db.admin.query(
    `insert into signup_verifications
       (id, email, kind, code_hash, attempts, expires_at, receipt_hash, receipt_expires_at)
     values ($1, $2, 'code', $3, 1, now() + interval '5 minutes', $4, now() + interval '30 minutes')`,
    [uuidv7(), address, sha256("000000"), sha256(receipt)],
  );
  return receipt;
}

interface FormOptions {
  email?: string;
  phone?: string;
  password?: string;
  cnpj?: string;
  tradeName?: string;
  taxRegime?: string;
  termsAccepted?: boolean;
}

function form(options: FormOptions = {}) {
  return {
    owner: {
      name: "Maria D'Ávila",
      phone: options.phone ?? newPhone(),
      ...(options.password === undefined ? {} : { password: options.password }),
    },
    company: {
      tradeName: options.tradeName ?? `Restaurante ${unique()}`,
      legalName: "Maria Comidas Ltda",
      cnpj: options.cnpj ?? "",
      segment: "restaurant",
      taxRegime: options.taxRegime ?? "",
      revenueRange: "up_to_30k",
    },
    unit: { name: "Centro", city: "Maceió", uf: "AL" },
    terms: { accepted: options.termsAccepted ?? true },
  };
}

function postSignup(body: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/signup",
    remoteAddress: "10.9.0.1",
    headers: { "content-type": "application/json", origin: ORIGIN, "user-agent": "vitest" },
    payload: JSON.stringify(body),
  });
}

/** Cadastro completo com comprovante novo do e-mail. */
async function signup(options: FormOptions = {}) {
  const address = options.email ?? newEmail();
  const receipt = await issueReceipt(address);
  const response = await postSignup({ receipt, email: address, ...form(options) });
  return { response, email: address, receipt };
}

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers["set-cookie"];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const { rows } = await db.admin.query(`select count(*)::int as n from ${sqlText}`, params);
  return rows[0].n;
}

/** Nada de conta para este e-mail nem para este nome fantasia. */
async function expectNothingWritten(address: string, tradeName: string) {
  expect(await count("users where email = $1", [address])).toBe(0);
  expect(await count("tenants where name = $1", [tradeName])).toBe(0);
}

async function receiptConsumed(address: string): Promise<boolean> {
  const { rows } = await db.admin.query(
    "select consumed_at from signup_verifications where email = $1",
    [address],
  );
  return rows.some((r) => r.consumed_at !== null);
}

// ---------- casos ----------

describe("gravação da conta no autocadastro (RF01)", () => {
  it("CA07: after signup the tenant, one unit, an owner membership with all_units, the default payment methods and channels exist; plan trial and status active; trial_ends_at is 14 days after", async () => {
    const { response, email } = await signup({ password: "senhaForte1" });
    expect(response.statusCode).toBe(201);
    const { tenantId } = response.json();
    expect(tenantId).toEqual(expect.any(String));

    const tenant = (
      await db.admin.query(
        "select plan, status, trial_started_at, trial_ends_at, legal_name, segment, revenue_range from tenants where id = $1",
        [tenantId],
      )
    ).rows[0];
    expect(tenant).toMatchObject({
      plan: "trial",
      status: "active",
      legal_name: "Maria Comidas Ltda",
      segment: "restaurant",
      revenue_range: "up_to_30k",
    });
    expect(tenant.trial_ends_at.getTime() - tenant.trial_started_at.getTime()).toBe(
      TRIAL_DAYS * DAY_MS,
    );

    const units = (
      await db.admin.query(
        "select id, name, city, uf, timezone, default_sales_channel_id from units where tenant_id = $1",
        [tenantId],
      )
    ).rows;
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      name: "Centro",
      city: "Maceió",
      uf: "AL",
      timezone: "America/Maceio",
    });
    const defaultChannel = (
      await db.admin.query("select name from sales_channels where id = $1", [
        units[0].default_sales_channel_id,
      ])
    ).rows[0];
    expect(defaultChannel.name).toBe("Salão");

    const user = (
      await db.admin.query("select id, name, email_verified from users where email = $1", [email])
    ).rows[0];
    expect(user).toMatchObject({ name: "Maria D'Ávila", email_verified: true });
    const memberships = (
      await db.admin.query(
        "select user_id, role, all_units, panel_access, status, default_unit_id from memberships where tenant_id = $1",
        [tenantId],
      )
    ).rows;
    expect(memberships).toEqual([
      {
        user_id: user.id,
        role: "owner",
        all_units: true,
        panel_access: true,
        status: "active",
        default_unit_id: units[0].id,
      },
    ]);

    const methods = (
      await db.admin.query(
        "select name, fee_percent_bp, fee_fixed_cents, is_default_card from payment_methods where tenant_id = $1 order by name",
        [tenantId],
      )
    ).rows;
    expect(methods.map((m) => m.name).sort()).toEqual(
      ["Crédito", "Débito", "Dinheiro", "Não informada", "Pix", "Voucher"].sort(),
    );
    expect(methods.every((m) => m.fee_percent_bp === 0 && Number(m.fee_fixed_cents) === 0)).toBe(
      true,
    );
    expect(methods.filter((m) => m.is_default_card).map((m) => m.name)).toEqual(["Crédito"]);
    const channels = (
      await db.admin.query("select name from sales_channels where tenant_id = $1", [tenantId])
    ).rows;
    expect(channels.map((c) => c.name).sort()).toEqual(
      ["Delivery próprio", "Não informado", "Retirada", "Salão", "iFood"].sort(),
    );

    expect(
      await count("auth_audit where user_id = $1 and event = 'signup_completed'", [user.id]),
    ).toBe(1);
    expect(await receiptConsumed(email)).toBe(true);
  });

  it("2xx opens a new session and expires the remembered fr_ctx; a refusal does not touch it", async () => {
    const { response } = await signup();
    expect(response.statusCode).toBe(201);
    expect(setCookies(response)).toContain(
      "__Secure-fr_ctx=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure",
    );
    const refused = await signup({ termsAccepted: false });
    expect(refused.response.statusCode).toBe(400);
    expect(setCookies(refused.response).some((c) => c.includes("fr_ctx"))).toBe(false);
  });

  it("response carries a session cookie and GET /api/me with it returns the new owner", async () => {
    const { response, email } = await signup();
    expect(response.statusCode).toBe(201);
    const cookies = setCookies(response);
    const session = cookies.find((c) => c.startsWith(SESSION_COOKIE));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/;\s*Secure/i);
    // Sem "manter conectado": cookie de sessão do navegador, sem Max-Age.
    expect(session).not.toMatch(/Max-Age/i);
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email, name: "Maria D'Ávila" });
  });

  it("CA02: without a receipt nothing is written (401/400)", async () => {
    const address = newEmail();
    const body = form();
    const missing = await postSignup({ email: address, ...body });
    expect(missing.statusCode).toBe(400);
    const bogus = await postSignup({ receipt: "nao-existe", email: address, ...body });
    expect(bogus.statusCode).toBe(401);
    expect(bogus.json()).toEqual({ code: "RECEIPT_INVALID", message: expect.any(String) });
    expect(setCookies(bogus)).toEqual([]);
    await expectNothingWritten(address, body.company.tradeName);
  });

  it("comprovante falso com senha: 401 sem rodar o hash de senha (scrypt) nem gravar nada", async () => {
    const address = newEmail();
    const body = form({ password: "senhaForte1" });
    const before = hashCalls;
    const response = await postSignup({ receipt: "lixo-qualquer", email: address, ...body });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "RECEIPT_INVALID" });
    expect(hashCalls).toBe(before);
    await expectNothingWritten(address, body.company.tradeName);

    // Comprovante bom: aí sim o hash roda.
    const ok = await signup({ password: "senhaForte1" });
    expect(ok.response.statusCode).toBe(201);
    expect(hashCalls).toBe(before + 1);
  });

  it("CA04: two simultaneous signups with the same cnpj create exactly one tenant; the other gets CNPJ_TAKEN", async () => {
    const cnpj = newCnpj();
    const [a, b] = await Promise.all([signup({ cnpj }), signup({ cnpj })]);
    const statuses = [a.response.statusCode, b.response.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.response.statusCode === 409 ? a : b;
    expect(loser.response.json()).toEqual({ code: "CNPJ_TAKEN", message: expect.any(String) });
    expect(await count("tenants where cnpj = $1", [cnpj])).toBe(1);
    expect(await count("users where email = $1", [loser.email])).toBe(0);
    expect(await receiptConsumed(loser.email)).toBe(false);
  });

  it("CA05: phone already used → PHONE_TAKEN and nothing is written; the message does not mention the other account", async () => {
    const phone = newPhone();
    const first = await signup({ phone });
    expect(first.response.statusCode).toBe(201);
    const tradeName = `Outro ${unique()}`;
    const second = await signup({ phone, tradeName });
    expect(second.response.statusCode).toBe(409);
    const body = second.response.json();
    expect(body).toEqual({ code: "PHONE_TAKEN", message: expect.stringMatching(/suporte/i) });
    expect(body.message).not.toContain(first.email);
    expect(body.message).not.toMatch(/Maria/);
    await expectNothingWritten(second.email, tradeName);
    expect(await receiptConsumed(second.email)).toBe(false);
  });

  it("CA06: terms not accepted → 400 terms_required; accepted rows store accepted_at and the three versions", async () => {
    const refused = await signup({ termsAccepted: false });
    expect(refused.response.statusCode).toBe(400);
    expect(refused.response.json()).toMatchObject({
      code: "INVALID_FIELDS",
      fields: { terms: "terms_required" },
    });
    expect(await count("users where email = $1", [refused.email])).toBe(0);
    // Erro de formulário não gasta o comprovante: dá para corrigir e enviar de novo.
    expect(await receiptConsumed(refused.email)).toBe(false);

    const accepted = await signup();
    const { tenantId } = accepted.response.json();
    const row = (
      await db.admin.query(
        `select t.terms_accepted_at, t.terms_version, t.privacy_version, t.dpa_version,
                t.terms_accepted_by = u.id as by_owner
           from tenants t join users u on u.email = $2 where t.id = $1`,
        [tenantId, accepted.email],
      )
    ).rows[0];
    expect(row.terms_accepted_at).toBeInstanceOf(Date);
    expect(row).toMatchObject({
      terms_version: expect.any(String),
      privacy_version: expect.any(String),
      dpa_version: expect.any(String),
      by_owner: true,
    });
  });

  it("CA08: failure injected after the unit insert leaves no tenant, user, unit or channel", async () => {
    const tradeName = `Falha ${unique()}`;
    const before = {
      units: await count("units", []),
      channels: await count("sales_channels", []),
      methods: await count("payment_methods", []),
    };
    failAfterUnit = true;
    try {
      const { response, email } = await signup({ tradeName, password: "senhaForte1" });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("falha injetada");
      await expectNothingWritten(email, tradeName);
      expect(await receiptConsumed(email)).toBe(false);
    } finally {
      failAfterUnit = false;
    }
    expect(await count("units", [])).toBe(before.units);
    expect(await count("sales_channels", [])).toBe(before.channels);
    expect(await count("payment_methods", [])).toBe(before.methods);
  });

  it("CA09: phone 82 9658-5647 is stored as +5582996585647", async () => {
    // Sem DDD não há como saber a área: o formulário pede o DDD (82).
    const { response, email } = await signup({ phone: "82 9658-5647" });
    expect(response.statusCode).toBe(201);
    const { rows } = await db.admin.query("select phone_e164 from users where email = $1", [email]);
    expect(rows[0].phone_e164).toBe("+5582996585647");
  });

  it("CA10: no column in any table contains the plain password; password 12345678 and password equal to email are refused", async () => {
    const password = `Senha${unique()}x1`;
    const { response, email } = await signup({ password });
    expect(response.statusCode).toBe(201);
    const account = (
      await db.admin.query(
        "select a.provider_id, a.account_id = u.id::text as same_id, a.password from accounts a join users u on u.id = a.user_id where u.email = $1",
        [email],
      )
    ).rows[0];
    expect(account).toMatchObject({ provider_id: "credential", same_id: true });
    expect(account.password).not.toContain(password);

    const columns = (
      await db.admin.query(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')`,
      )
    ).rows;
    for (const { table_name, column_name } of columns) {
      const n = await count(`"${table_name}" where "${column_name}"::text like $1`, [
        `%${password}%`,
      ]);
      expect(n, `${table_name}.${column_name}`).toBe(0);
    }

    const weak = await signup({ password: "12345678" });
    expect(weak.response.statusCode).toBe(400);
    expect(weak.response.json()).toMatchObject({ fields: { "owner.password": "password_weak" } });
    const address = `abc12345${unique()}@ex.com`;
    const sameAsEmail = await signup({ email: address, password: address });
    expect(sameAsEmail.response.statusCode).toBe(400);
    expect(sameAsEmail.response.json()).toMatchObject({
      fields: { "owner.password": "password_weak" },
    });
  });

  it("login por senha funciona com a senha do cadastro (mesmo hash do Better Auth)", async () => {
    const password = "senhaForte1";
    const { email } = await signup({ password });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      remoteAddress: "10.9.0.2",
      headers: { "content-type": "application/json", origin: ORIGIN },
      payload: JSON.stringify({ email, password }),
    });
    expect(login.statusCode).toBe(200);
  });

  it("Foco 2: two signups without cnpj both succeed and store null", async () => {
    const a = await signup({ cnpj: "" });
    const b = await signup({ cnpj: "" });
    expect([a.response.statusCode, b.response.statusCode]).toEqual([201, 201]);
    const { rows } = await db.admin.query("select cnpj from tenants where id = any($1)", [
      [a.response.json().tenantId, b.response.json().tenantId],
    ]);
    expect(rows.map((r) => r.cnpj)).toEqual([null, null]);
  });

  it("Foco 3: same receipt in two parallel requests creates exactly one account", async () => {
    const address = newEmail();
    const receipt = await issueReceipt(address);
    const [a, b] = await Promise.all([
      postSignup({ receipt, email: address, ...form() }),
      postSignup({ receipt, email: address, ...form() }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 401]);
    expect(await count("users where email = $1", [address])).toBe(1);
    // Usado uma vez, não serve de novo.
    const again = await postSignup({ receipt, email: address, ...form() });
    expect(again.statusCode).toBe(401);
  });

  it("Foco 4: receipt of email A with email B in the body is refused", async () => {
    const emailA = newEmail();
    const emailB = newEmail();
    const receipt = await issueReceipt(emailA);
    const body = form();
    const response = await postSignup({ receipt, email: emailB, ...body });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "RECEIPT_INVALID" });
    await expectNothingWritten(emailB, body.company.tradeName);
    expect(await count("users where email = $1", [emailA])).toBe(0);
    expect(await receiptConsumed(emailA)).toBe(false);
  });

  it("e-mail com conta criada depois do comprovante: 409 SIGNUP_FAILED genérico, nada gravado", async () => {
    const address = newEmail();
    const receipt = await issueReceipt(address);
    await db.admin.query("insert into users (id, name, email) values ($1, 'Outra', $2)", [
      uuidv7(),
      address,
    ]);
    const body = form();
    const response = await postSignup({ receipt, email: address, ...body });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SIGNUP_FAILED", message: expect.any(String) });
    expect(await count("tenants where name = $1", [body.company.tradeName])).toBe(0);
  });

  it("tax regime simples_nacional creates a disabled tax_settings row; regime not_sure creates none", async () => {
    const simples = await signup({ taxRegime: "simples_nacional" });
    expect(simples.response.statusCode).toBe(201);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );
    const rows = (
      await db.admin.query(
        "select regime, enabled, valid_from::text as valid_from from tax_settings where tenant_id = $1",
        [simples.response.json().tenantId],
      )
    ).rows;
    expect(rows).toEqual([{ regime: "simples_nacional", enabled: false, valid_from: today }]);

    const notSure = await signup({ taxRegime: "not_sure" });
    expect(notSure.response.statusCode).toBe(201);
    expect(
      await count("tax_settings where tenant_id = $1", [notSure.response.json().tenantId]),
    ).toBe(0);
  });
});
