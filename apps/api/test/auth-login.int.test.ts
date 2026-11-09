import { createHash } from "node:crypto";
import {
  createAuthStore,
  createDatabase,
  createPool,
  DEV_EMAILS,
  DEV_PASSWORD,
  seedDevData,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { hashPassword } from "better-auth/crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createBackgroundTasks } from "../src/infra/auth/background-tasks";
import { createAuth, createAuthGateway } from "../src/infra/auth/create-auth";
import { createSystemClock } from "../src/infra/clock";
import { createMemoryEmailSender } from "../src/infra/email/memory-email-sender";
import { createCheckSession, createSessionBlocked } from "../src/modules/auth/check-session";

const ORIGIN = "http://localhost:3000";
const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
const START = new Date("2026-11-09T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

let db: TestDatabase;
let authPool: ReturnType<typeof createPool>;
let app: ReturnType<typeof buildApp>;
let email: ReturnType<typeof createMemoryEmailSender>;
let tasks: ReturnType<typeof createBackgroundTasks>;
const logLines: string[] = [];
let ipCounter = 0;

/** O Better Auth usa `Date` internamente (vencimento do código e da sessão): só `Date` é falso. */
function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

beforeAll(async () => {
  db = await startTestDatabase();
  authPool = createPool(db.urls.auth);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  const clock = createSystemClock();
  const store = createAuthStore(createDatabase(authPool), clock);
  email = createMemoryEmailSender();
  tasks = createBackgroundTasks({ onError: () => undefined, onDrop: () => undefined });
  const auth = createAuth({
    pool: authPool,
    store,
    email,
    clock,
    secret: SECRET,
    baseUrl: ORIGIN,
    trustedOrigins: [ORIGIN],
    secureCookies: true,
    background: tasks,
  });
  const gateway = createAuthGateway(auth);
  app = buildApp(
    { LOG_LEVEL: "debug" },
    {
      auth: {
        gateway,
        checkSession: createCheckSession({ gateway, access: store, clock }),
        sessionBlocked: createSessionBlocked({ gateway, access: store }),
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
  await db.admin.query("truncate auth_audit, verifications, sessions");
  (email.sent as unknown[]).length = 0;
  ipCounter += 1;
});

afterEach(() => {
  vi.setSystemTime(START);
});

// ---------- apoio ----------

let userCounter = 0;

/** Usuário com e-mail verificado e vínculo (dono) num tenant novo, criado pelo admin. */
async function createUser(
  options: { password?: string; membership?: "active" | "deactivated"; email?: string } = {},
) {
  userCounter += 1;
  const address = options.email ?? `pessoa${userCounter}.${uuidv7().slice(-6)}@ex.com`;
  const userId = uuidv7();
  const tenantId = uuidv7();
  await db.admin.query("insert into tenants (id, name) values ($1, 'Restaurante')", [tenantId]);
  await db.admin.query(
    "insert into users (id, name, email, email_verified) values ($1, 'Pessoa', $2, true)",
    [userId, address],
  );
  const status = options.membership ?? "active";
  await db.admin.query(
    `insert into memberships (id, tenant_id, user_id, role, all_units, status, deactivated_at)
     values ($1, $2, $3, 'owner', true, $4, $5)`,
    [uuidv7(), tenantId, userId, status, status === "deactivated" ? new Date() : null],
  );
  if (options.password !== undefined) {
    await db.admin.query(
      `insert into accounts (id, account_id, provider_id, user_id, password)
       values ($1, $2::text, 'credential', $2::uuid, $3)`,
      [uuidv7(), userId, await hashPassword(options.password)],
    );
  }
  return { userId, email: address };
}

function currentIp() {
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function post(url: string, body: unknown, cookie?: string, ip = currentIp()) {
  return app.inject({
    method: "POST",
    url,
    remoteAddress: ip,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": "vitest",
      ...(cookie ? { cookie } : {}),
    },
    payload: JSON.stringify(body),
  });
}

/** Pede o código e espera o envio, que roda fora da requisição (tempo igual para todos). */
async function requestCode(address: string, ip?: string) {
  const response = await requestCodeOnly(address, ip);
  await tasks.drain();
  return response;
}
const requestCodeOnly = (address: string, ip?: string) =>
  post(
    "/api/auth/email-otp/send-verification-otp",
    { email: address, type: "sign-in" },
    undefined,
    ip,
  );
const signInCode = (address: string, otp: string, rememberMe?: boolean) =>
  post("/api/auth/sign-in/email-otp", { email: address, otp, rememberMe });
const signInPassword = (address: string, password: string, rememberMe?: boolean) =>
  post("/api/auth/sign-in/email", { email: address, password, rememberMe });

function lastCode(): string {
  const last = email.sent.at(-1);
  if (!last || !("code" in last)) throw new Error("nenhum código enviado");
  return last.code;
}

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers["set-cookie"];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

/** Fora de `development` o cookie é `Secure` e leva o prefixo `__Secure-`. */
const SESSION_COOKIE = "__Secure-better-auth.session_token=";

/** `nome=valor` do cookie de sessão, pronto para o cabeçalho `cookie`. */
function sessionCookie(response: LightMyRequestResponse): string {
  const found = setCookies(response).find((c) => c.startsWith(SESSION_COOKIE));
  if (!found) throw new Error("sem cookie de sessão");
  return found.split(";")[0] as string;
}

function me(cookie?: string) {
  return app.inject({
    method: "GET",
    url: "/api/me",
    headers: cookie ? { cookie } : {},
  });
}

async function loginWithCode(address: string, rememberMe?: boolean) {
  expect((await requestCode(address)).statusCode).toBe(200);
  const response = await signInCode(address, lastCode(), rememberMe);
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// ---------- casos ----------

describe("login por código (RF02.R4)", () => {
  it("código: pede, recebe 6 dígitos e entra; cookie com httpOnly, Secure, SameSite=Lax", async () => {
    const user = await createUser();
    const asked = await requestCode(user.email);
    expect(asked.statusCode).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: user.email, purpose: "sign-in" });
    expect(lastCode()).toMatch(/^\d{6}$/);

    const response = await signInCode(user.email, lastCode());
    expect(response.statusCode).toBe(200);
    const cookie = setCookies(response).find((c) => c.startsWith(SESSION_COOKIE));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const profile = await me(sessionCookie(response));
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toEqual({ userId: user.userId, name: "Pessoa", email: user.email });
  });

  it("e-mail desconhecido: mesma resposta (status e corpo) que um conhecido e nenhum e-mail enviado", async () => {
    const user = await createUser();
    const known = await requestCode(user.email);
    expect(email.sent).toHaveLength(1);
    const unknown = await requestCode("ninguem@ex.com");
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(email.sent).toHaveLength(1);
  });

  it("e-mail com maiúsculas e espaços é a mesma conta", async () => {
    const user = await createUser({ password: "senhaForte1" });
    const messy = `  ${user.email.toUpperCase()}  `;
    expect((await requestCode(messy)).statusCode).toBe(200);
    expect(email.sent[0]?.to).toBe(user.email);

    const byCode = await signInCode(` ${user.email.toUpperCase()}`, lastCode());
    expect(byCode.statusCode).toBe(200);
    expect((await me(sessionCookie(byCode))).json().userId).toBe(user.userId);

    const byPassword = await signInPassword(messy, "senhaForte1");
    expect(byPassword.statusCode).toBe(200);
    expect((await me(sessionCookie(byPassword))).json().userId).toBe(user.userId);
  });

  it("vínculo desativado: pedir código dá a mesma resposta, sem e-mail", async () => {
    const active = await createUser();
    const gone = await createUser({ membership: "deactivated", password: "senhaForte1" });
    const known = await requestCode(active.email);
    const response = await requestCode(gone.email);
    expect(response.statusCode).toBe(known.statusCode);
    expect(response.body).toBe(known.body);
    expect(email.sent.map((s) => s.to)).toEqual([active.email]);
    // A senha também não abre a porta para quem não tem vínculo ativo.
    expect((await signInPassword(gone.email, "senhaForte1")).statusCode).toBe(401);
  });

  it("sessão aberta antes da desativação recebe 401 na próxima chamada", async () => {
    const user = await createUser();
    const cookie = await loginWithCode(user.email);
    expect((await me(cookie)).statusCode).toBe(200);
    await db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [user.userId],
    );
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("código errado 3 vezes: a 4ª tentativa é recusada mesmo com o código certo", async () => {
    const user = await createUser();
    await requestCode(user.email);
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) {
      const attempt = await signInCode(user.email, wrong);
      expect(attempt.statusCode).toBe(400);
      expect(attempt.json()).toMatchObject({ code: "INVALID_OTP" });
    }
    const fourth = await signInCode(user.email, right);
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json()).toEqual({
      code: "TOO_MANY_ATTEMPTS",
      message: expect.stringMatching(/peça um novo código/i),
    });
  });

  it("código usado uma vez não entra de novo; duas verificações simultâneas, só uma passa", async () => {
    const user = await createUser();
    await requestCode(user.email);
    const code = lastCode();
    expect((await signInCode(user.email, code)).statusCode).toBe(200);
    expect((await signInCode(user.email, code)).statusCode).toBe(400);

    advance(61 * SECOND);
    await requestCode(user.email);
    const fresh = lastCode();
    const both = await Promise.all([signInCode(user.email, fresh), signInCode(user.email, fresh)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  });

  it("código expira em 5 min", async () => {
    const user = await createUser();
    await requestCode(user.email);
    advance(5 * MINUTE + SECOND);
    const response = await signInCode(user.email, lastCode());
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("pedir novo código invalida o anterior", async () => {
    const user = await createUser();
    await requestCode(user.email);
    const first = lastCode();
    advance(61 * SECOND);
    await requestCode(user.email);
    const second = lastCode();
    expect(email.sent).toHaveLength(2);
    if (first !== second) expect((await signInCode(user.email, first)).statusCode).toBe(400);
    expect((await signInCode(user.email, second)).statusCode).toBe(200);
  });

  it("reenvio em menos de 60 s é recusado; 6º envio na hora é recusado; 21º do mesmo IP é recusado", async () => {
    const user = await createUser();
    const first = await requestCode(user.email);
    advance(30 * SECOND);
    const tooSoon = await requestCode(user.email);
    // Mesma resposta, sem revelar o limite, e o código anterior continua valendo.
    expect(tooSoon.statusCode).toBe(first.statusCode);
    expect(tooSoon.body).toBe(first.body);
    expect(email.sent).toHaveLength(1);

    for (let i = 0; i < 5; i++) {
      advance(61 * SECOND);
      await requestCode(user.email);
    }
    expect(email.sent).toHaveLength(5);

    // 20 pessoas diferentes atrás do mesmo IP: a 21ª não recebe.
    const ip = "192.168.50.7";
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await createUser());
    for (const person of people.slice(0, 20)) await requestCode(person.email, ip);
    expect(email.sent).toHaveLength(25);
    const blocked = await requestCode(people[20]?.email as string, ip);
    expect(blocked.statusCode).toBe(200);
    expect(email.sent).toHaveLength(25);
  });
});

describe("login por senha (RF02.R3, R7)", () => {
  it("seed de desenvolvimento: o Dono Demo entra com a senha conhecida e o ex-funcionário não recebe código", async () => {
    await seedDevData(createDatabase(db.admin), "development");
    const response = await signInPassword(DEV_EMAILS.owner, DEV_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect((await me(sessionCookie(response))).json()).toMatchObject({ email: DEV_EMAILS.owner });
    await requestCode(DEV_EMAILS.deactivated);
    expect(email.sent).toHaveLength(0);
  });

  it("senha: entra com a senha correta; 'Entrar com senha' de quem não tem senha recebe a mesma mensagem genérica de senha incorreta", async () => {
    const withPassword = await createUser({ password: "senhaForte1" });
    const ok = await signInPassword(withPassword.email, "senhaForte1");
    expect(ok.statusCode).toBe(200);
    expect((await me(sessionCookie(ok))).statusCode).toBe(200);

    const wrong = await signInPassword(withPassword.email, "outraSenha9");
    const noPassword = await signInPassword((await createUser()).email, "qualquer1");
    const unknown = await signInPassword("ninguem@ex.com", "qualquer1");
    expect(wrong.statusCode).toBe(401);
    expect(noPassword.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(noPassword.body).toBe(wrong.body);
    expect(unknown.body).toBe(wrong.body);
    expect(wrong.json()).toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: expect.stringMatching(/e-mail ou senha incorretos/i),
    });
  });

  it("5 senhas erradas: a 6ª é negada, mesmo certa, por 15 min; o código continua funcionando", async () => {
    const user = await createUser({ password: "senhaForte1" });
    for (let i = 0; i < 5; i++) {
      expect((await signInPassword(user.email, "errada123")).statusCode).toBe(401);
    }
    const locked = await signInPassword(user.email, "senhaForte1");
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({
      code: "PASSWORD_LOCKED",
      message: expect.stringMatching(/15 minutos/),
    });

    // Bloqueio só da senha: o código entra.
    await loginWithCode(user.email);

    // E-mail desconhecido recebe o mesmo bloqueio (não revela quem é cliente).
    for (let i = 0; i < 5; i++) await signInPassword("fantasma@ex.com", "errada123");
    const ghost = await signInPassword("fantasma@ex.com", "errada123");
    expect(ghost.statusCode).toBe(429);
    expect(ghost.body).toBe(locked.body);

    advance(15 * MINUTE + SECOND);
    expect((await signInPassword(user.email, "senhaForte1")).statusCode).toBe(200);
  });

  it("senha de 65 caracteres e senha igual ao e-mail: recusadas ao definir", async () => {
    const user = await createUser({ password: "senhaForte1", email: "dono77@ex.com" });
    const login = await signInPassword(user.email, "senhaForte1");
    const cookie = sessionCookie(login);
    const change = (newPassword: string) =>
      post(
        "/api/auth/change-password",
        { currentPassword: "senhaForte1", newPassword, revokeOtherSessions: false },
        cookie,
      );

    const tooLong = await change(`a1${"x".repeat(63)}`);
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ code: "PASSWORD_TOO_LONG" });

    const sameAsEmail = await change("DONO77@ex.com");
    expect(sameAsEmail.statusCode).toBe(400);
    expect(sameAsEmail.json()).toMatchObject({ code: "PASSWORD_SAME_AS_EMAIL" });

    const onlyDigits = await change("12345678");
    expect(onlyDigits.statusCode).toBe(400);
    expect(onlyDigits.json()).toMatchObject({ code: "PASSWORD_NEEDS_LETTER_AND_DIGIT" });

    // A senha antiga continua valendo.
    expect((await signInPassword(user.email, "senhaForte1")).statusCode).toBe(200);
  });
});

describe("sessão (RF02.R5, CA08)", () => {
  it("sem cookie: GET /api/me é 401; cookie adulterado é 401; corpo vazio e JSON malformado em /api/auth/*: 4xx, nunca 500", async () => {
    const noCookie = await me();
    expect(noCookie.statusCode).toBe(401);
    expect(noCookie.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const user = await createUser();
    const cookie = await loginWithCode(user.email);
    const tampered = `${cookie.slice(0, -3)}abc`;
    expect((await me(tampered)).statusCode).toBe(401);
    expect((await me(`${SESSION_COOKIE}lixo`)).statusCode).toBe(401);

    const raw = (payload: string | undefined, contentType?: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email-otp",
        headers: { origin: ORIGIN, ...(contentType ? { "content-type": contentType } : {}) },
        ...(payload === undefined ? {} : { payload }),
      });
    for (const response of [
      await raw("", "application/json"),
      await raw("{nao-e-json", "application/json"),
      await raw(undefined),
      await raw("{}", "application/json"),
      await raw("[]", "application/json"),
      await post("/api/auth/sign-in/email", { email: 42, password: null }),
    ]) {
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(response.json()).toEqual({ code: expect.any(String), message: expect.any(String) });
    }
  });

  it("sem 'manter conectado': 12 h sem uso derrubam a sessão; uso antes disso a renova", async () => {
    const user = await createUser();
    const cookie = await loginWithCode(user.email);
    advance(11 * HOUR);
    expect((await me(cookie)).statusCode).toBe(200);
    advance(11 * HOUR);
    expect((await me(cookie)).statusCode).toBe(200);
    advance(12 * HOUR + SECOND);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("com 'manter conectado': 13 h sem uso não derrubam; 30 dias sem uso, sim", async () => {
    const user = await createUser({ password: "senhaForte1" });
    const byCode = await loginWithCode(user.email, true);
    const byPassword = sessionCookie(await signInPassword(user.email, "senhaForte1", true));
    advance(13 * HOUR);
    expect((await me(byCode)).statusCode).toBe(200);
    expect((await me(byPassword)).statusCode).toBe(200);
    advance(30 * 24 * HOUR + SECOND);
    expect((await me(byCode)).statusCode).toBe(401);
    expect((await me(byPassword)).statusCode).toBe(401);
  });

  it("logout encerra a sessão: /api/me volta a 401", async () => {
    const user = await createUser();
    const cookie = await loginWithCode(user.email);
    const out = await post("/api/auth/sign-out", {}, cookie);
    expect(out.statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(401);
  });
});

describe("auditoria e logs (RNF04.R4, regra 9)", () => {
  it("auditoria: login, login_failed, otp_sent e password_locked gravam em auth_audit sem e-mail em texto puro", async () => {
    const user = await createUser({ password: "senhaForte1" });
    await loginWithCode(user.email);
    for (let i = 0; i < 5; i++) await signInPassword(user.email, "errada123");

    const { rows } = await db.admin.query<{
      event: string;
      user_id: string | null;
      email_hash: string | null;
      ip: string | null;
      user_agent: string | null;
    }>("select event, user_id, email_hash, ip, user_agent from auth_audit order by created_at, id");
    const events = rows.map((r) => r.event);
    for (const event of ["otp_sent", "login", "login_failed", "password_locked"]) {
      expect(events).toContain(event);
    }
    for (const row of rows) {
      expect(row.email_hash).toBe(sha256(user.email));
      expect(row.user_id).toBe(user.userId);
      expect(row.user_agent).toBe("vitest");
      expect(JSON.stringify(row)).not.toContain("@");
    }
  });

  it("logs do app não contêm o e-mail, o código nem a senha", async () => {
    logLines.length = 0;
    const user = await createUser({ password: "senhaSecreta7" });
    await requestCode(user.email);
    const code = lastCode();
    await signInCode(user.email, "000000");
    await signInCode(user.email, code);
    await signInPassword(user.email, "senhaSecreta7");
    await signInPassword(user.email, "errada123");
    await post("/api/auth/sign-in/email-otp", "{malformado");

    expect(logLines.length).toBeGreaterThan(0);
    const all = logLines.join("\n");
    expect(all).not.toContain(user.email);
    expect(all).not.toContain(code);
    expect(all).not.toContain("senhaSecreta7");
    expect(all).not.toContain("errada123");
  });
});

describe("correções da revisão (rodada 1)", () => {
  it("sessão sem 'manter conectado' continua de 12 h mesmo depois de GET /api/auth/get-session renovar", async () => {
    const user = await createUser();
    const cookie = await loginWithCode(user.email);
    advance(6 * MINUTE);
    const refreshed = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie },
    });
    expect(refreshed.statusCode).toBe(200);
    const { rows } = await db.admin.query<{ expires_at: Date }>(
      "select expires_at from sessions where user_id = $1",
      [user.userId],
    );
    expect(rows[0]?.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 12 * HOUR);
    advance(12 * HOUR + SECOND);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("pedidos de código em paralelo: no máximo um e-mail por 60 s e 20 por IP", async () => {
    const user = await createUser();
    await Promise.all(Array.from({ length: 8 }, () => requestCodeOnly(user.email)));
    await tasks.drain();
    expect(email.sent).toHaveLength(1);

    const ip = "192.168.77.1";
    const people = [];
    for (let i = 0; i < 26; i++) people.push(await createUser());
    await Promise.all(people.map((person) => requestCodeOnly(person.email, ip)));
    await tasks.drain();
    expect(email.sent).toHaveLength(21);
  });

  it("senhas erradas em paralelo: no máximo 5 erros contam antes do bloqueio; as demais são negadas", async () => {
    const user = await createUser({ password: "senhaForte1" });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => signInPassword(user.email, "errada123")),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    const { rows } = await db.admin.query(
      "select failed_password_attempts, password_locked_until is not null as locked from users where id = $1",
      [user.userId],
    );
    expect(rows[0]).toEqual({ failed_password_attempts: 5, locked: true });
    const locks = await db.admin.query(
      "select count(*)::int as n from auth_audit where event = 'password_locked' and user_id = $1",
      [user.userId],
    );
    expect(locks.rows[0].n).toBe(1);
    expect((await signInPassword(user.email, "senhaForte1")).statusCode).toBe(429);
  });

  it("vínculo desativado: as rotas /api/auth/* com sessão também recusam (401)", async () => {
    const user = await createUser({ password: "senhaForte1" });
    const cookie = sessionCookie(await signInPassword(user.email, "senhaForte1"));
    await db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [user.userId],
    );
    const getSession = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie },
    });
    expect(getSession.statusCode).toBe(401);
    const listSessions = await app.inject({
      method: "GET",
      url: "/api/auth/list-sessions",
      headers: { cookie },
    });
    expect(listSessions.statusCode).toBe(401);
    const change = await post(
      "/api/auth/change-password",
      { currentPassword: "senhaForte1", newPassword: "novaSenha22" },
      cookie,
    );
    expect(change.statusCode).toBe(401);
    const update = await post("/api/auth/update-user", { name: "Outro" }, cookie);
    expect(update.statusCode).toBe(401);
    const { rows } = await db.admin.query("select name from users where id = $1", [user.userId]);
    expect(rows[0].name).toBe("Pessoa");
  });

  it("caminho com barra final ou maiúsculas não escapa da checagem de vínculo nem bloqueia o login", async () => {
    const gone = await createUser({ password: "senhaForte1" });
    const staleCookie = sessionCookie(await signInPassword(gone.email, "senhaForte1"));
    await db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [gone.userId],
    );
    for (const url of [
      "/api/auth/get-session/",
      "/api/auth/get-session//",
      "/api/auth//get-session",
      "/api/auth/GET-SESSION",
    ]) {
      const response = await app.inject({ method: "GET", url, headers: { cookie: staleCookie } });
      expect(response.statusCode, url).not.toBe(200);
      expect(response.statusCode, url).toBeLessThan(500);
    }
    // Outra pessoa no mesmo navegador (cookie velho) entra; a barra final não cai na checagem
    // de vínculo (quem responde é o Better Auth: 404, rota que ele não conhece).
    const other = await createUser({ password: "senhaForte1" });
    const body = { email: other.email, password: "senhaForte1" };
    expect((await post("/api/auth/sign-in/email", body, staleCookie)).statusCode).toBe(200);
    const slash = await post("/api/auth/sign-in/email/", body, staleCookie);
    expect(slash.statusCode).not.toBe(401);
    expect(slash.statusCode).toBeLessThan(500);
  });

  it("pedir código não espera o envio: a resposta sai antes do e-mail, igual para quem existe ou não", async () => {
    const user = await createUser();
    const known = await requestCodeOnly(user.email);
    // A resposta já voltou e o envio ainda não aconteceu: o tempo não depende do e-mail existir.
    expect(known.statusCode).toBe(200);
    expect(email.sent).toHaveLength(0);
    const unknown = await requestCodeOnly("ninguem@ex.com");
    expect(unknown.body).toBe(known.body);
    await tasks.drain();
    expect(email.sent.map((s) => s.to)).toEqual([user.email]);
  });
});
