import { createHash } from "node:crypto";
import {
  createAuthStore,
  createDatabase,
  createPool,
  createSignupRepo,
  createSignupStore,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createBackgroundTasks } from "../src/infra/auth/background-tasks";
import { createAuth, createAuthGateway } from "../src/infra/auth/create-auth";
import { createSystemClock } from "../src/infra/clock";
import { createMemoryEmailSender } from "../src/infra/email/memory-email-sender";
import { createCheckSession } from "../src/modules/auth/check-session";
import { createCreateAccount } from "../src/modules/signup/create-account";
import { createRequestSignupCode } from "../src/modules/signup/request-signup-code";
import { createVerifySignupCode } from "../src/modules/signup/verify-signup-code";

const ORIGIN = "http://localhost:3000";
const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
const START = new Date("2026-11-09T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;

let db: TestDatabase;
let authPool: ReturnType<typeof createPool>;
let app: ReturnType<typeof buildApp>;
let email: ReturnType<typeof createMemoryEmailSender>;
let tasks: ReturnType<typeof createBackgroundTasks>;
const logLines: string[] = [];
let ipCounter = 0;

/** Só `Date` é falso (como no login): falsificar timers trava o pg e o `inject`. */
function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

beforeAll(async () => {
  db = await startTestDatabase();
  authPool = createPool(db.urls.auth);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  const clock = createSystemClock();
  const authDb = createDatabase(authPool);
  const store = createAuthStore(authDb, clock);
  const signupStore = createSignupStore(authDb, clock);
  email = createMemoryEmailSender();
  tasks = createBackgroundTasks({ onError: () => undefined, onDrop: () => undefined });
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
  app = buildApp(
    { LOG_LEVEL: "debug", APP_URL: ORIGIN },
    {
      auth: {
        gateway,
        checkSession: createCheckSession({ gateway, access: store, clock }),
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
          repo: createSignupRepo(authDb),
          receipts: signupStore,
          gateway,
          clock,
          newId: uuidv7,
        }),
      },
      logStream: { write: (line) => logLines.push(line) },
    },
  );
});

afterAll(async () => {
  vi.useRealTimers();
  await app?.close();
  await authPool?.end();
  await db?.stop();
});

beforeEach(async () => {
  vi.setSystemTime(START);
  await db.admin.query("truncate auth_audit, verifications, sessions, signup_verifications");
  (email.sent as unknown[]).length = 0;
  ipCounter += 1;
});

afterEach(() => {
  vi.setSystemTime(START);
});

// ---------- apoio ----------

let counter = 0;
const newEmail = () => {
  counter += 1;
  return `novo${counter}.${uuidv7().slice(-6)}@ex.com`;
};

/** Usuário com vínculo de dono, criado pelo admin (e-mail já normalizado, como grava o app). */
async function createUser(address: string = newEmail()) {
  const userId = uuidv7();
  const tenantId = uuidv7();
  await db.admin.query("insert into tenants (id, name) values ($1, 'Restaurante')", [tenantId]);
  // O painel exige ao menos uma unidade ativa (DD-31).
  await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
    uuidv7(),
    tenantId,
  ]);
  await db.admin.query(
    "insert into users (id, name, email, email_verified) values ($1, 'Pessoa', $2, true)",
    [userId, address],
  );
  await db.admin.query(
    `insert into memberships (id, tenant_id, user_id, role, all_units, status)
     values ($1, $2, $3, 'owner', true, 'active')`,
    [uuidv7(), tenantId, userId],
  );
  return { userId, email: address };
}

function currentIp() {
  return `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function post(url: string, body: unknown, ip = currentIp()) {
  return app.inject({
    method: "POST",
    url,
    remoteAddress: ip,
    headers: { "content-type": "application/json", origin: ORIGIN, "user-agent": "vitest" },
    payload: JSON.stringify(body),
  });
}

/** Pede o código e espera o envio, que roda depois da resposta (mesmo tempo para todos). */
async function requestSignupCode(address: string, ip?: string) {
  const response = await post("/api/signup/code", { email: address }, ip);
  await tasks.drain();
  return response;
}

const verify = (address: string, code: string) =>
  post("/api/signup/verify", { email: address, code });

function lastCodeFor(address: string): string {
  const found = email.sent.filter((s) => s.to === address).at(-1);
  if (found === undefined || !("code" in found)) throw new Error("nenhum código enviado");
  return found.code;
}

const otherThan = (code: string) => (code === "000000" ? "111111" : "000000");

/** Parte da resposta que o navegador vê: status, tipo e corpo. */
const visible = (r: LightMyRequestResponse) => ({
  status: r.statusCode,
  type: r.headers["content-type"],
  body: r.body,
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// ---------- casos ----------

describe("código do autocadastro (RF01.R10)", () => {
  it("e-mail novo recebe um código de 6 dígitos; a resposta é {success:true}", async () => {
    const address = newEmail();
    const response = await requestSignupCode(address);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: address, purpose: "email-verification" });
    expect(lastCodeFor(address)).toMatch(/^\d{6}$/);
    // Só o hash do código fica no banco.
    const { rows } = await db.admin.query("select code_hash from signup_verifications");
    expect(rows[0].code_hash).not.toContain(lastCodeFor(address));
  });

  it("e-mail já cadastrado recebe o aviso de conta existente e a resposta HTTP é idêntica à de e-mail novo (RF02.R1)", async () => {
    const user = await createUser();
    const fresh = await requestSignupCode(newEmail());
    const existing = await requestSignupCode(user.email);
    expect(visible(existing)).toEqual(visible(fresh));
    const notice = email.sent.find((s) => s.to === user.email);
    expect(notice).toEqual({
      to: user.email,
      purpose: "account-exists",
      loginUrl: `${ORIGIN}/login`,
    });
  });

  it("e-mail inválido: 400 de formato, sem envio", async () => {
    const response = await requestSignupCode("nao-e-email");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "INVALID_EMAIL", message: expect.any(String) });
    expect(email.sent).toHaveLength(0);
  });

  it("verificar com o código certo devolve um comprovante (CA02: sem comprovante não há cadastro, coberto na Tarefa 5)", async () => {
    const address = newEmail();
    await requestSignupCode(address);
    const response = await verify(address, lastCodeFor(address));
    expect(response.statusCode).toBe(200);
    const { receipt } = response.json();
    expect(receipt).toEqual(expect.any(String));
    expect(receipt.length).toBeGreaterThanOrEqual(32);
    // O comprovante só existe como hash, e vale 30 min.
    const { rows } = await db.admin.query(
      "select receipt_hash, receipt_expires_at from signup_verifications",
    );
    expect(rows[0].receipt_hash).toBe(sha256(receipt));
    expect(new Date(rows[0].receipt_expires_at).getTime()).toBe(START.getTime() + 30 * MINUTE);
    // O mesmo código não gera um segundo comprovante.
    expect((await verify(address, lastCodeFor(address))).json()).toMatchObject({
      code: "INVALID_CODE",
    });
  });

  it("código errado → INVALID_CODE", async () => {
    const address = newEmail();
    await requestSignupCode(address);
    const response = await verify(address, otherThan(lastCodeFor(address)));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "INVALID_CODE", message: expect.any(String) });
  });

  it("código depois de 5 min → INVALID_CODE (CA03)", async () => {
    const address = newEmail();
    await requestSignupCode(address);
    advance(5 * MINUTE + SECOND);
    const response = await verify(address, lastCodeFor(address));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CODE" });
  });

  it("4ª tentativa → TOO_MANY_ATTEMPTS, mesmo com o código certo", async () => {
    const address = newEmail();
    await requestSignupCode(address);
    const right = lastCodeFor(address);
    for (let i = 0; i < 3; i++) {
      expect((await verify(address, otherThan(right))).statusCode).toBe(400);
    }
    const fourth = await verify(address, right);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toEqual({
      code: "TOO_MANY_ATTEMPTS",
      message: expect.stringMatching(/peça um novo código/i),
    });
  });

  it("foco 5: e-mail já cadastrado, com qualquer código, recebe INVALID_CODE e conta tentativas igual a e-mail novo com código errado; depois de 3, os dois recebem TOO_MANY_ATTEMPTS", async () => {
    const user = await createUser();
    const fresh = newEmail();
    await requestSignupCode(user.email);
    await requestSignupCode(fresh);
    const wrong = otherThan(lastCodeFor(fresh));
    for (let i = 0; i < 3; i++) {
      const a = await verify(user.email, wrong);
      const b = await verify(fresh, wrong);
      expect(a.statusCode).toBe(400);
      expect(visible(a)).toEqual(visible(b));
    }
    const { rows } = await db.admin.query<{ email: string; attempts: number }>(
      "select email, attempts from signup_verifications order by email",
    );
    expect(rows.map((r) => r.attempts)).toEqual([3, 3]);
    const a = await verify(user.email, wrong);
    const b = await verify(fresh, wrong);
    expect(a.statusCode).toBe(429);
    expect(visible(a)).toEqual(visible(b));
  });

  it('foco 1: "  Ana@Exemplo.COM " e "ana@exemplo.com" são o mesmo e-mail para envio, limites e usuário existente', async () => {
    const messy = "  Ana@Exemplo.COM ";
    const clean = "ana@exemplo.com";
    await requestSignupCode(messy);
    expect(email.sent).toEqual([expect.objectContaining({ to: clean })]);
    // Limite de 60 s vale para as duas grafias.
    await requestSignupCode(clean);
    expect(email.sent).toHaveLength(1);
    // Verificar com outra grafia funciona.
    expect((await verify(" ANA@exemplo.com", lastCodeFor(clean))).statusCode).toBe(200);

    // Usuário gravado com o e-mail limpo: a grafia bagunçada recebe o aviso, nunca código.
    await createUser("bia@exemplo.com");
    await requestSignupCode("  BIA@Exemplo.com ");
    expect(email.sent.at(-1)).toMatchObject({ to: "bia@exemplo.com", purpose: "account-exists" });
  });

  it("segundo pedido em menos de 60 s não envia outro e-mail, mas responde igual", async () => {
    const address = newEmail();
    const first = await requestSignupCode(address);
    advance(30 * SECOND);
    const second = await requestSignupCode(address);
    expect(visible(second)).toEqual(visible(first));
    expect(email.sent).toHaveLength(1);
    // O código anterior continua valendo.
    expect((await verify(address, lastCodeFor(address))).statusCode).toBe(200);
  });

  it("6º pedido na hora e 21º do mesmo IP não enviam nada", async () => {
    const address = newEmail();
    const first = await requestSignupCode(address);
    for (let i = 0; i < 5; i++) {
      advance(61 * SECOND);
      const again = await requestSignupCode(address);
      expect(visible(again)).toEqual(visible(first));
    }
    expect(email.sent).toHaveLength(5);

    const ip = "192.168.60.9";
    for (let i = 0; i < 20; i++) await requestSignupCode(newEmail(), ip);
    expect(email.sent).toHaveLength(25);
    const blocked = await requestSignupCode(newEmail(), ip);
    expect(visible(blocked)).toEqual(visible(first));
    expect(email.sent).toHaveLength(25);
  });

  it("código de cadastro não entra em /api/auth/sign-in/email-otp, e código de login não passa em /api/signup/verify", async () => {
    // Código de cadastro para um e-mail que depois vira usuário: o login não o aceita.
    const address = newEmail();
    await requestSignupCode(address);
    const signupCode = lastCodeFor(address);
    await createUser(address);
    const login = await post("/api/auth/sign-in/email-otp", { email: address, otp: signupCode });
    expect(login.statusCode).not.toBe(200);
    expect(login.statusCode).toBeLessThan(500);

    // Código de login de um usuário existente: o cadastro não o aceita.
    const user = await createUser();
    await post("/api/auth/email-otp/send-verification-otp", { email: user.email, type: "sign-in" });
    await tasks.drain();
    const loginCode = lastCodeFor(user.email);
    expect(email.sent.at(-1)).toMatchObject({ to: user.email, purpose: "sign-in" });
    const response = await verify(user.email, loginCode);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CODE" });
  });

  it("auditoria e logs: envio e verificação gravados só com hash; logs sem e-mail, código nem comprovante", async () => {
    logLines.length = 0;
    const address = newEmail();
    await requestSignupCode(address);
    // Relógio congelado: sem avançar, as duas linhas teriam o mesmo created_at e a ordem pelo
    // id (UUID v7 sem contador) seria sorteada.
    advance(SECOND);
    const code = lastCodeFor(address);
    await verify(address, otherThan(code));
    const ok = await verify(address, code);
    const { receipt } = ok.json();
    await post("/api/signup/verify", "{malformado");

    const { rows } = await db.admin.query<{ event: string; email_hash: string }>(
      "select event, email_hash from auth_audit order by created_at, id",
    );
    expect(rows.map((r) => r.event)).toEqual(["signup_code_sent", "signup_verified"]);
    for (const row of rows) expect(row.email_hash).toBe(sha256(address));

    const all = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    expect(all).not.toContain(address);
    expect(all).not.toContain(code);
    expect(all).not.toContain(receipt);
  });

  it("corpo malformado ou sem campos: 4xx no formato da API, nunca 500", async () => {
    const raw = (url: string, payload: string) =>
      app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/json", origin: ORIGIN },
        payload,
      });
    for (const response of [
      await raw("/api/signup/code", "{nao-e-json"),
      await raw("/api/signup/code", "{}"),
      await raw("/api/signup/verify", "[]"),
      await post("/api/signup/verify", { email: 42, code: null }),
    ]) {
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(response.json()).toEqual({ code: expect.any(String), message: expect.any(String) });
    }
  });
});
