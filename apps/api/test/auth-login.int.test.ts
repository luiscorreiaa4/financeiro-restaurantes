import { allowedActions } from "@app/core";
import { DEV_EMAILS, DEV_PASSWORD } from "@app/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AuthHarness,
  HOUR,
  MINUTE,
  ORIGIN,
  SECOND,
  SESSION_COOKIE,
  setCookies,
  sha256,
  startAuthHarness,
} from "./support/auth-harness";

let h: AuthHarness;

beforeAll(async () => {
  h = await startAuthHarness();
});

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.reset();
});

afterEach(() => {
  h.clock.reset();
});

// ---------- casos ----------

describe("login por código (RF02.R4)", () => {
  it("código: pede, recebe 6 dígitos e entra; cookie com httpOnly, Secure, SameSite=Lax", async () => {
    const user = await h.createUser();
    const asked = await h.requestCode(user.email);
    expect(asked.statusCode).toBe(200);
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]).toMatchObject({ to: user.email, purpose: "sign-in" });
    expect(h.lastCode()).toMatch(/^\d{6}$/);

    const response = await h.signInCode(user.email, h.lastCode());
    expect(response.statusCode).toBe(200);
    const cookie = setCookies(response).find((c) => c.startsWith(SESSION_COOKIE));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const profile = await h.me(h.sessionCookie(response));
    expect(profile.statusCode).toBe(200);
    const { rows } = await h.db.admin.query<{ tenant_id: string; unit_id: string }>(
      "select m.tenant_id, (select id from units u where u.tenant_id = m.tenant_id) as unit_id from memberships m where m.user_id = $1",
      [user.userId],
    );
    const tenantId = rows[0]?.tenant_id as string;
    const unitId = rows[0]?.unit_id as string;
    const owner = { role: "owner", permissions: [], units: "all", panelAccess: true } as const;
    expect(profile.json()).toEqual({
      userId: user.userId,
      name: "Pessoa",
      email: user.email,
      companies: [
        {
          tenantId,
          name: "Restaurante",
          role: "owner",
          accountStatus: "active",
          startUnitId: "all",
        },
      ],
      context: {
        tenantId,
        unitId: "all",
        role: "owner",
        permissions: [],
        allUnits: true,
        unitIds: [unitId],
        accountStatus: "active",
        allowedActions: allowedActions(owner),
      },
      contextSource: "fallback",
    });
  });

  it("e-mail desconhecido: mesma resposta (status e corpo) que um conhecido e nenhum e-mail enviado", async () => {
    const user = await h.createUser();
    const known = await h.requestCode(user.email);
    expect(h.email.sent).toHaveLength(1);
    const unknown = await h.requestCode("ninguem@ex.com");
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(h.email.sent).toHaveLength(1);
  });

  it("e-mail com maiúsculas e espaços é a mesma conta", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const messy = `  ${user.email.toUpperCase()}  `;
    expect((await h.requestCode(messy)).statusCode).toBe(200);
    expect(h.email.sent[0]?.to).toBe(user.email);

    const byCode = await h.signInCode(` ${user.email.toUpperCase()}`, h.lastCode());
    expect(byCode.statusCode).toBe(200);
    expect((await h.me(h.sessionCookie(byCode))).json().userId).toBe(user.userId);

    const byPassword = await h.signInPassword(messy, "senhaForte1");
    expect(byPassword.statusCode).toBe(200);
    expect((await h.me(h.sessionCookie(byPassword))).json().userId).toBe(user.userId);
  });

  it("vínculo desativado: pedir código dá a mesma resposta, sem e-mail", async () => {
    const active = await h.createUser();
    const gone = await h.createUser({ membership: "deactivated", password: "senhaForte1" });
    const known = await h.requestCode(active.email);
    const response = await h.requestCode(gone.email);
    expect(response.statusCode).toBe(known.statusCode);
    expect(response.body).toBe(known.body);
    expect(h.email.sent.map((s) => s.to)).toEqual([active.email]);
    // A senha também não abre a porta para quem não tem vínculo ativo.
    expect((await h.signInPassword(gone.email, "senhaForte1")).statusCode).toBe(401);
  });

  it("sessão aberta antes da desativação recebe 401 na próxima chamada", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    expect((await h.me(cookie)).statusCode).toBe(200);
    await h.db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [user.userId],
    );
    expect((await h.me(cookie)).statusCode).toBe(401);
  });

  it("código errado 3 vezes: a 4ª tentativa é recusada mesmo com o código certo", async () => {
    const user = await h.createUser();
    await h.requestCode(user.email);
    const right = h.lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) {
      const attempt = await h.signInCode(user.email, wrong);
      expect(attempt.statusCode).toBe(400);
      expect(attempt.json()).toMatchObject({ code: "INVALID_OTP" });
    }
    const fourth = await h.signInCode(user.email, right);
    // DD-30: o esgotamento das tentativas responde igual a um código errado.
    expect(fourth.statusCode).toBe(400);
    expect(fourth.json()).toEqual({
      code: "INVALID_OTP",
      message: expect.stringMatching(/peça um novo código/i),
    });
  });

  it("e-mail sem conta e e-mail com conta recebem os mesmos erros de código, tentativa a tentativa (RF02.R1, DD-30)", async () => {
    const user = await h.createUser();
    await h.requestCode(user.email);
    const wrong = h.lastCode() === "000000" ? "111111" : "000000";
    const ghost = "ninguem.nao.existe@exemplo.dev";
    await h.requestCode(ghost);
    for (let i = 0; i < 5; i++) {
      const known = await h.signInCode(user.email, wrong);
      const unknown = await h.signInCode(ghost, wrong);
      expect(unknown.statusCode).toBe(known.statusCode);
      expect(unknown.json()).toEqual(known.json());
    }
  });

  it("código usado uma vez não entra de novo; duas verificações simultâneas, só uma passa", async () => {
    const user = await h.createUser();
    await h.requestCode(user.email);
    const code = h.lastCode();
    expect((await h.signInCode(user.email, code)).statusCode).toBe(200);
    expect((await h.signInCode(user.email, code)).statusCode).toBe(400);

    h.clock.advance(61 * SECOND);
    await h.requestCode(user.email);
    const fresh = h.lastCode();
    const both = await Promise.all([
      h.signInCode(user.email, fresh),
      h.signInCode(user.email, fresh),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  });

  it("código expira em 5 min", async () => {
    const user = await h.createUser();
    await h.requestCode(user.email);
    h.clock.advance(5 * MINUTE + SECOND);
    const response = await h.signInCode(user.email, h.lastCode());
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_OTP" });
  });

  it("pedir novo código invalida o anterior", async () => {
    const user = await h.createUser();
    await h.requestCode(user.email);
    const first = h.lastCode();
    h.clock.advance(61 * SECOND);
    await h.requestCode(user.email);
    const second = h.lastCode();
    expect(h.email.sent).toHaveLength(2);
    if (first !== second) expect((await h.signInCode(user.email, first)).statusCode).toBe(400);
    expect((await h.signInCode(user.email, second)).statusCode).toBe(200);
  });

  it("reenvio em menos de 60 s é recusado; 6º envio na hora é recusado; 21º do mesmo IP é recusado", async () => {
    const user = await h.createUser();
    const first = await h.requestCode(user.email);
    h.clock.advance(30 * SECOND);
    const tooSoon = await h.requestCode(user.email);
    // Mesma resposta, sem revelar o limite, e o código anterior continua valendo.
    expect(tooSoon.statusCode).toBe(first.statusCode);
    expect(tooSoon.body).toBe(first.body);
    expect(h.email.sent).toHaveLength(1);

    for (let i = 0; i < 5; i++) {
      h.clock.advance(61 * SECOND);
      await h.requestCode(user.email);
    }
    expect(h.email.sent).toHaveLength(5);

    // 20 pessoas diferentes atrás do mesmo IP: a 21ª não recebe.
    const ip = "192.168.50.7";
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await h.createUser());
    for (const person of people.slice(0, 20)) await h.requestCode(person.email, ip);
    expect(h.email.sent).toHaveLength(25);
    const blocked = await h.requestCode(people[20]?.email as string, ip);
    expect(blocked.statusCode).toBe(200);
    expect(h.email.sent).toHaveLength(25);
  });
});

describe("login por senha (RF02.R3, R7)", () => {
  it("seed de desenvolvimento: o Dono Demo entra com a senha conhecida e o ex-funcionário não recebe código", async () => {
    await h.seedDev();
    const response = await h.signInPassword(DEV_EMAILS.owner, DEV_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect((await h.me(h.sessionCookie(response))).json()).toMatchObject({
      email: DEV_EMAILS.owner,
    });
    await h.requestCode(DEV_EMAILS.deactivated);
    expect(h.email.sent).toHaveLength(0);
  });

  it("senha: entra com a senha correta; 'Entrar com senha' de quem não tem senha recebe a mesma mensagem genérica de senha incorreta", async () => {
    const withPassword = await h.createUser({ password: "senhaForte1" });
    const ok = await h.signInPassword(withPassword.email, "senhaForte1");
    expect(ok.statusCode).toBe(200);
    expect((await h.me(h.sessionCookie(ok))).statusCode).toBe(200);

    const wrong = await h.signInPassword(withPassword.email, "outraSenha9");
    const noPassword = await h.signInPassword((await h.createUser()).email, "qualquer1");
    const unknown = await h.signInPassword("ninguem@ex.com", "qualquer1");
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
    const user = await h.createUser({ password: "senhaForte1" });
    for (let i = 0; i < 5; i++) {
      expect((await h.signInPassword(user.email, "errada123")).statusCode).toBe(401);
    }
    const locked = await h.signInPassword(user.email, "senhaForte1");
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({
      code: "PASSWORD_LOCKED",
      message: expect.stringMatching(/15 minutos/),
    });

    // Bloqueio só da senha: o código entra.
    await h.loginWithCode(user.email);

    // E-mail desconhecido recebe o mesmo bloqueio (não revela quem é cliente).
    for (let i = 0; i < 5; i++) await h.signInPassword("fantasma@ex.com", "errada123");
    const ghost = await h.signInPassword("fantasma@ex.com", "errada123");
    expect(ghost.statusCode).toBe(429);
    expect(ghost.body).toBe(locked.body);

    h.clock.advance(15 * MINUTE + SECOND);
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(200);
  });

  // A regra de senha (65 caracteres, igual ao e-mail, sem número) ao definir a senha está coberta
  // em auth-recovery.int.test.ts (recuperação) e profile.int.test.ts (/password).
});

describe("sessão (RF02.R5, CA08)", () => {
  it("sem cookie: GET /api/me é 401; cookie adulterado é 401; corpo vazio e JSON malformado em /api/auth/*: 4xx, nunca 500", async () => {
    const noCookie = await h.me();
    expect(noCookie.statusCode).toBe(401);
    expect(noCookie.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    const tampered = `${cookie.slice(0, -3)}abc`;
    expect((await h.me(tampered)).statusCode).toBe(401);
    expect((await h.me(`${SESSION_COOKIE}lixo`)).statusCode).toBe(401);

    const raw = (payload: string | undefined, contentType?: string) =>
      h.app.inject({
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
      await h.post("/api/auth/sign-in/email", { email: 42, password: null }),
    ]) {
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(response.json()).toEqual({ code: expect.any(String), message: expect.any(String) });
    }
  });

  it("sem 'manter conectado': 12 h sem uso derrubam a sessão; uso antes disso a renova", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    h.clock.advance(11 * HOUR);
    expect((await h.me(cookie)).statusCode).toBe(200);
    h.clock.advance(11 * HOUR);
    expect((await h.me(cookie)).statusCode).toBe(200);
    h.clock.advance(12 * HOUR + SECOND);
    expect((await h.me(cookie)).statusCode).toBe(401);
  });

  it("com 'manter conectado': 13 h sem uso não derrubam; 30 dias sem uso, sim", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const byCode = await h.loginWithCode(user.email, true);
    const byPassword = h.sessionCookie(await h.signInPassword(user.email, "senhaForte1", true));
    h.clock.advance(13 * HOUR);
    expect((await h.me(byCode)).statusCode).toBe(200);
    expect((await h.me(byPassword)).statusCode).toBe(200);
    h.clock.advance(30 * 24 * HOUR + SECOND);
    expect((await h.me(byCode)).statusCode).toBe(401);
    expect((await h.me(byPassword)).statusCode).toBe(401);
  });

  it("logout encerra a sessão: /api/me volta a 401", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    const out = await h.post("/api/auth/sign-out", {}, cookie);
    expect(out.statusCode).toBe(200);
    expect((await h.me(cookie)).statusCode).toBe(401);
  });
});

describe("auditoria e logs (RNF04.R4, regra 9)", () => {
  it("auditoria: login, login_failed, otp_sent e password_locked gravam em auth_audit sem e-mail em texto puro", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    await h.loginWithCode(user.email);
    for (let i = 0; i < 5; i++) await h.signInPassword(user.email, "errada123");

    const { rows } = await h.db.admin.query<{
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
    h.logLines.length = 0;
    const user = await h.createUser({ password: "senhaSecreta7" });
    await h.requestCode(user.email);
    const code = h.lastCode();
    await h.signInCode(user.email, "000000");
    await h.signInCode(user.email, code);
    await h.signInPassword(user.email, "senhaSecreta7");
    await h.signInPassword(user.email, "errada123");
    await h.post("/api/auth/sign-in/email-otp", "{malformado");

    expect(h.logLines.length).toBeGreaterThan(0);
    const all = h.logLines.join("\n");
    expect(all).not.toContain(user.email);
    expect(all).not.toContain(code);
    expect(all).not.toContain("senhaSecreta7");
    expect(all).not.toContain("errada123");
  });
});

describe("correções da revisão (rodada 1)", () => {
  it("sessão sem 'manter conectado' continua de 12 h mesmo depois de GET /api/me renovar", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    h.clock.advance(6 * MINUTE);
    const refreshed = await h.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie },
    });
    expect(refreshed.statusCode).toBe(200);
    const { rows } = await h.db.admin.query<{ expires_at: Date }>(
      "select expires_at from sessions where user_id = $1",
      [user.userId],
    );
    expect(rows[0]?.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 12 * HOUR);
    h.clock.advance(12 * HOUR + SECOND);
    expect((await h.me(cookie)).statusCode).toBe(401);
  });

  it("pedidos de código em paralelo: no máximo um e-mail por 60 s e 20 por IP", async () => {
    const user = await h.createUser();
    await Promise.all(Array.from({ length: 8 }, () => h.requestCodeOnly(user.email)));
    await h.tasks.drain();
    expect(h.email.sent).toHaveLength(1);

    const ip = "192.168.77.1";
    const people = [];
    for (let i = 0; i < 26; i++) people.push(await h.createUser());
    await Promise.all(people.map((person) => h.requestCodeOnly(person.email, ip)));
    await h.tasks.drain();
    expect(h.email.sent).toHaveLength(21);
  });

  it("senhas erradas em paralelo: no máximo 5 erros contam antes do bloqueio; as demais são negadas", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => h.signInPassword(user.email, "errada123")),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    const { rows } = await h.db.admin.query(
      "select failed_password_attempts, password_locked_until is not null as locked from users where id = $1",
      [user.userId],
    );
    expect(rows[0]).toEqual({ failed_password_attempts: 5, locked: true });
    const locks = await h.db.admin.query(
      "select count(*)::int as n from auth_audit where event = 'password_locked' and user_id = $1",
      [user.userId],
    );
    expect(locks.rows[0].n).toBe(1);
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(429);
  });

  // Motivo da troca (F1c, tarefa 6): as rotas de perfil, senha e sessões do Better Auth foram
  // fechadas (404, com ou sem vínculo); quem perdeu o vínculo recebe 401 nas rotas próprias da API.
  it("vínculo desativado: rotas do Better Auth fora da lista respondem 404 e /api/me, 401", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = h.sessionCookie(await h.signInPassword(user.email, "senhaForte1"));
    await h.db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [user.userId],
    );
    for (const url of ["/api/auth/get-session", "/api/auth/list-sessions"]) {
      const response = await h.app.inject({ method: "GET", url, headers: { cookie } });
      expect(response.statusCode, url).toBe(404);
    }
    const update = await h.post("/api/auth/update-user", { name: "Outro" }, cookie);
    expect(update.statusCode).toBe(404);
    expect((await h.me(cookie)).statusCode).toBe(401);
    const { rows } = await h.db.admin.query("select name from users where id = $1", [user.userId]);
    expect(rows[0].name).toBe("Pessoa");
  });

  // Vínculo desativado: /api/profile responde 401 em test/profile.int.test.ts (RF02.CA07).

  it("caminho com barra final ou maiúsculas não escapa da checagem de vínculo nem bloqueia o login", async () => {
    const gone = await h.createUser({ password: "senhaForte1" });
    const staleCookie = h.sessionCookie(await h.signInPassword(gone.email, "senhaForte1"));
    await h.db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [gone.userId],
    );
    for (const url of [
      "/api/auth/get-session/",
      "/api/auth/get-session//",
      "/api/auth//get-session",
      "/api/auth/GET-SESSION",
    ]) {
      const response = await h.app.inject({ method: "GET", url, headers: { cookie: staleCookie } });
      expect(response.statusCode, url).not.toBe(200);
      expect(response.statusCode, url).toBeLessThan(500);
    }
    // Outra pessoa no mesmo navegador (cookie velho) entra; a barra final não cai na checagem
    // de vínculo (quem responde é o Better Auth: 404, rota que ele não conhece).
    const other = await h.createUser({ password: "senhaForte1" });
    const body = { email: other.email, password: "senhaForte1" };
    expect((await h.post("/api/auth/sign-in/email", body, staleCookie)).statusCode).toBe(200);
    const slash = await h.post("/api/auth/sign-in/email/", body, staleCookie);
    expect(slash.statusCode).not.toBe(401);
    expect(slash.statusCode).toBeLessThan(500);
  });

  it("pedir código não espera o envio: a resposta sai antes do e-mail, igual para quem existe ou não", async () => {
    const user = await h.createUser();
    const known = await h.requestCodeOnly(user.email);
    // A resposta já voltou e o envio ainda não aconteceu: o tempo não depende do e-mail existir.
    expect(known.statusCode).toBe(200);
    expect(h.email.sent).toHaveLength(0);
    const unknown = await h.requestCodeOnly("ninguem@ex.com");
    expect(unknown.body).toBe(known.body);
    await h.tasks.drain();
    expect(h.email.sent.map((s) => s.to)).toEqual([user.email]);
  });
});
