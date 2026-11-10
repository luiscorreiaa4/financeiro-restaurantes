import { uuidv7 } from "@app/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { AuthSession } from "../src/modules/auth/check-session";
import { type AuthHarness, MINUTE, startAuthHarness } from "./support/auth-harness";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

beforeAll(async () => {
  h = await startAuthHarness();
});

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.reset();
  (h.email.sentNotices as unknown[]).length = 0;
});

afterEach(() => {
  h.clock.reset();
});

/** Chamada ao painel com cookie opcional; o IP é o da conexão. */
function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  cookie?: string,
  body?: unknown,
  remoteAddress = nextIp(),
) {
  return h.app.inject({
    method,
    url,
    remoteAddress,
    headers: {
      origin: h.origin,
      "user-agent": "vitest",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

/** Entra com senha, com o navegador informado, e devolve o cookie da sessão. */
async function signIn(address: string, password: string, userAgent = "vitest"): Promise<string> {
  const response = await h.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    remoteAddress: nextIp(),
    headers: { "content-type": "application/json", origin: h.origin, "user-agent": userAgent },
    payload: JSON.stringify({ email: address, password }),
  });
  expect(response.statusCode).toBe(200);
  return h.sessionCookie(response);
}

async function audits(userId: string, event: string) {
  const { rows } = await h.db.admin.query<{ ip: string | null }>(
    "select ip from auth_audit where user_id = $1 and event = $2",
    [userId, event],
  );
  return rows;
}

/** Pede o link pelo perfil e devolve o token do fragmento da URL enviada ao e-mail. */
async function requestProfileLink(cookie: string): Promise<string> {
  const response = await call("POST", "/api/profile/password/link", cookie);
  expect(response.statusCode).toBe(200);
  await h.tasks.drain();
  const url = h.email.sentLinks.at(-1)?.url;
  if (url === undefined) throw new Error("nenhum link enviado");
  expect(url).toContain("/redefinir-senha#token=");
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";
}

const concludeLink = (token: string, password: string) =>
  call("POST", "/api/recovery/reset", undefined, { token, password });

describe("perfil: acesso", () => {
  it("RF02.CA08: sem sessão, toda rota do perfil responde 401", async () => {
    const routes: Array<["GET" | "POST" | "PATCH", string, unknown?]> = [
      ["GET", "/api/profile"],
      ["PATCH", "/api/profile/name", { name: "Maria" }],
      ["POST", "/api/profile/password", { currentPassword: "a1b2c3d4", newPassword: "novaSenha1" }],
      ["POST", "/api/profile/password/link"],
      ["POST", "/api/profile/sessions/revoke-others"],
    ];
    for (const [method, url, body] of routes) {
      const response = await call(method, url, undefined, body);
      expect(response.statusCode, url).toBe(401);
      expect(response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("RF02.CA07: quem perdeu o vínculo ativo recebe 401 em /api/profile", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    expect((await call("GET", "/api/profile", cookie)).statusCode).toBe(200);
    await h.db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [user.userId],
    );
    expect((await call("GET", "/api/profile", cookie)).statusCode).toBe(401);
    expect((await call("POST", "/api/profile/sessions/revoke-others", cookie)).statusCode).toBe(
      401,
    );
    expect((await call("POST", "/api/profile/password/link", cookie)).statusCode).toBe(401);
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(0);
  });
});

describe("perfil: leitura", () => {
  it("lista as sessões do usuário com a atual marcada, sem token nem id, e nunca as de outro", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const other = await h.createUser({ password: "senhaForte1" });
    const a = await signIn(user.email, "senhaForte1", CHROME_WINDOWS);
    await signIn(user.email, "senhaForte1", SAFARI_IPHONE);
    await signIn(other.email, "senhaForte1", "Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0");

    const response = await call("GET", "/api/profile", a);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      name: string;
      email: string;
      hasPassword: boolean;
      sessions: { device: string; lastUsedAt: string; current: boolean }[];
    };
    expect(body.email).toBe(user.email);
    expect(body.name).toBe("Pessoa");
    expect(body.hasPassword).toBe(true);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(body.sessions.find((s) => s.current)?.device).toBe("Chrome no Windows");
    expect(body.sessions.find((s) => !s.current)?.device).toBe("Safari no iPhone");
    for (const session of body.sessions) {
      expect(Object.keys(session).sort()).toEqual(["current", "device", "lastUsedAt"]);
      expect(new Date(session.lastUsedAt).toISOString()).toBe(session.lastUsedAt);
    }
    expect(response.body).not.toContain('"token"');
    expect(response.body).not.toContain('"id"');
    expect(response.body).not.toContain("Linux");
  });

  it("usuário sem senha: hasPassword falso", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    const response = await call("GET", "/api/profile", cookie);
    expect(response.json()).toMatchObject({ hasPassword: false });
  });

  it("não devolve sessões vencidas", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    await h.db.admin.query(
      `insert into sessions (id, user_id, token, expires_at, user_agent)
       values ($1, $2, 'token-vencido', $4, $3)`,
      [uuidv7(), user.userId, SAFARI_IPHONE, new Date(Date.now() - 3_600_000)],
    );
    const body = (await call("GET", "/api/profile", cookie)).json() as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });
});

describe("perfil: nome", () => {
  it("apara o nome, grava, audita e /api/me mostra o novo", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    const response = await call("PATCH", "/api/profile/name", cookie, { name: "  Maria  " });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    const { rows } = await h.db.admin.query("select name from users where id = $1", [user.userId]);
    expect(rows[0].name).toBe("Maria");
    expect((await h.me(cookie)).json()).toMatchObject({ name: "Maria" });
    expect(await audits(user.userId, "name_changed")).toHaveLength(1);
  });

  it("Review Focus 5: nome vazio, só espaços ou com 121 caracteres: INVALID_NAME", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    for (const name of ["", "   ", "a".repeat(121)]) {
      const response = await call("PATCH", "/api/profile/name", cookie, { name });
      expect(response.statusCode, name.length.toString()).toBe(400);
      expect(response.json()).toMatchObject({ code: "INVALID_NAME" });
    }
    expect(
      (await call("PATCH", "/api/profile/name", cookie, { name: "a".repeat(120) })).statusCode,
    ).toBe(200);
    expect((await call("PATCH", "/api/profile/name", cookie, {})).statusCode).toBe(400);
    expect(await audits(user.userId, "name_changed")).toHaveLength(1);
  });
});

describe("perfil: trocar a senha com a atual", () => {
  it("RF02.CA09: encerra as outras sessões, mantém a atual, audita e avisa", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const a = await signIn(user.email, "senhaForte1");
    const b = await signIn(user.email, "senhaForte1");

    const response = await call("POST", "/api/profile/password", a, {
      currentPassword: "senhaForte1",
      newPassword: "senhaNova2",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    await h.tasks.drain();

    expect((await h.me(a)).statusCode).toBe(200);
    expect((await h.me(b)).statusCode).toBe(401);
    expect(await audits(user.userId, "password_changed")).toHaveLength(1);
    expect(h.email.sentNotices).toHaveLength(1);
    expect(h.email.sentNotices[0]).toMatchObject({ to: user.email, kind: "password-changed" });
    expect((await h.signInPassword(user.email, "senhaNova2")).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(401);
  });

  it("senha atual errada: INVALID_PASSWORD e não conta para o bloqueio do login", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    for (let i = 0; i < 6; i++) {
      const response = await call("POST", "/api/profile/password", cookie, {
        currentPassword: "errada123",
        newPassword: "senhaNova2",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    }
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(200);
  });

  it("Review Focus 3: usuário sem senha chamando /password recebe NO_PASSWORD (400)", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    const response = await call("POST", "/api/profile/password", cookie, {
      currentPassword: "qualquer1",
      newPassword: "senhaNova2",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "NO_PASSWORD" });
  });

  it("nova senha igual à atual: SAME_PASSWORD, sem derrubar sessões", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const a = await signIn(user.email, "senhaForte1");
    const b = await signIn(user.email, "senhaForte1");
    const response = await call("POST", "/api/profile/password", a, {
      currentPassword: "senhaForte1",
      newPassword: "senhaForte1",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "SAME_PASSWORD" });
    expect((await h.me(b)).statusCode).toBe(200);
    expect(await audits(user.userId, "password_changed")).toHaveLength(0);
  });

  describe("regra de senha", () => {
    const cases: Array<[string, (email: string) => string, string]> = [
      ["PASSWORD_TOO_SHORT", () => "abc1234", "curta"],
      ["PASSWORD_TOO_LONG", () => `a1${"b".repeat(63)}`, "65 caracteres"],
      ["PASSWORD_NEEDS_LETTER_AND_DIGIT", () => "somenteletras", "sem número"],
      ["PASSWORD_SAME_AS_EMAIL", (email) => email, "igual ao e-mail"],
    ];
    for (const [expected, password, label] of cases) {
      it(`${expected} em /password: senha ${label}`, async () => {
        const user = await h.createUser({ password: "senhaForte1" });
        const cookie = await signIn(user.email, "senhaForte1");
        const direct = await call("POST", "/api/profile/password", cookie, {
          currentPassword: "senhaForte1",
          newPassword: password(user.email),
        });
        expect(direct.statusCode).toBe(400);
        expect(direct.json()).toMatchObject({ code: expected });
      });
    }
  });
});

describe("perfil: definir ou redefinir a senha pelo link (DD-27)", () => {
  it("/password/link envia o link ao e-mail da sessão (corpo e cabeçalho com outro e-mail são ignorados) e respeita 60 s", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const other = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    h.clock.advance(MINUTE);

    const first = await h.app.inject({
      method: "POST",
      url: "/api/profile/password/link",
      remoteAddress: nextIp(),
      headers: {
        origin: h.origin,
        "user-agent": "vitest",
        "content-type": "application/json",
        "x-email": other.email,
        cookie,
      },
      payload: JSON.stringify({ email: other.email }),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ success: true });
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(1);
    expect(h.email.sentLinks[0]?.to).toBe(user.email);
    expect(h.email.sent).toHaveLength(0);

    const again = await call("POST", "/api/profile/password/link", cookie);
    expect(again.statusCode).toBe(200);
    expect(again.body).toBe(first.body);
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(1);
  });

  it("quem não tem senha (hasPassword false) conclui o link e passa a entrar com senha", async () => {
    const user = await h.createUser();
    const cookie = await h.loginWithCode(user.email);
    expect((await call("GET", "/api/profile", cookie)).json()).toMatchObject({
      hasPassword: false,
    });
    h.clock.advance(MINUTE);
    const token = await requestProfileLink(cookie);

    const response = await concludeLink(token, "primeiraSenha1");
    expect(response.statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "primeiraSenha1")).statusCode).toBe(200);
    expect(await audits(user.userId, "password_reset")).toHaveLength(1);
  });

  it("concluir o link derruba TODAS as sessões, inclusive a que pediu, e avisa por e-mail", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const a = await signIn(user.email, "senhaForte1");
    const b = await signIn(user.email, "senhaForte1");
    h.clock.advance(MINUTE);
    const token = await requestProfileLink(a);

    expect((await concludeLink(token, "senhaNova2")).statusCode).toBe(200);
    await h.tasks.drain();
    expect((await h.me(a)).statusCode).toBe(401);
    expect((await h.me(b)).statusCode).toBe(401);
    expect(h.email.sentNotices).toHaveLength(1);
    expect((await h.signInPassword(user.email, "senhaNova2")).statusCode).toBe(200);
  });

  it("o IP gravado é o da conexão, nunca o de cabeçalho ou corpo", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    h.clock.advance(MINUTE);
    const forged = {
      origin: h.origin,
      "user-agent": "vitest",
      "x-forwarded-for": "6.6.6.6",
      "x-real-ip": "7.7.7.7",
      cookie,
    };
    const linkResponse = await h.app.inject({
      method: "POST",
      url: "/api/profile/password/link",
      remoteAddress: "10.200.0.9",
      headers: forged,
    });
    expect(linkResponse.statusCode).toBe(200);
    await h.tasks.drain();
    const { rows } = await h.db.admin.query<{ ip: string }>(
      "select ip from auth_audit where event = 'otp_sent' and user_id = $1 order by created_at desc limit 1",
      [user.userId],
    );
    expect(rows).toEqual([{ ip: "10.200.0.9" }]);

    // Troca com a senha atual também grava o IP da conexão.
    const change = await h.app.inject({
      method: "POST",
      url: "/api/profile/password",
      remoteAddress: "10.200.0.10",
      headers: { ...forged, "content-type": "application/json" },
      payload: JSON.stringify({
        currentPassword: "senhaForte1",
        newPassword: "senhaNova3",
        ip: "8.8.8.8",
      }),
    });
    expect(change.statusCode).toBe(200);
    expect(await audits(user.userId, "password_changed")).toEqual([{ ip: "10.200.0.10" }]);
  });
});

describe("perfil: encerrar as outras sessões", () => {
  it("mantém a atual, apaga as demais e audita", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const other = await h.createUser({ password: "senhaForte1" });
    const a = await signIn(user.email, "senhaForte1");
    const b = await signIn(user.email, "senhaForte1");
    const c = await signIn(other.email, "senhaForte1");

    const response = await call("POST", "/api/profile/sessions/revoke-others", a);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect((await h.me(a)).statusCode).toBe(200);
    expect((await h.me(b)).statusCode).toBe(401);
    expect((await h.me(c)).statusCode).toBe(200);
    expect(await audits(user.userId, "other_sessions_revoked")).toHaveLength(1);
  });
});

describe("perfil: segurança dos registros", () => {
  it("auditoria sem senha, link nem e-mail em claro; logs sem segredos", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await signIn(user.email, "senhaForte1");
    h.clock.advance(MINUTE);
    const token = await requestProfileLink(cookie);
    await concludeLink(token, "senhaSecreta9");
    await call("PATCH", "/api/profile/name", cookie, { name: "Maria Secreta" });

    const { rows } = await h.db.admin.query("select * from auth_audit");
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(user.email);
    expect(dump).not.toContain("senhaSecreta9");
    expect(dump).not.toContain("senhaForte1");
    expect(dump).not.toContain(token);
    expect(dump).not.toContain("Maria Secreta");
    const logs = h.logLines.join("\n");
    expect(logs).not.toContain("senhaSecreta9");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("Maria Secreta");
  });

  it("erro inesperado vira 500 genérico sem vazar nada", async () => {
    const session: AuthSession = {
      sessionId: "s1",
      userId: "u1",
      name: "Pessoa",
      email: "segredo@ex.com",
      keepConnected: false,
      updatedAt: new Date(),
    };
    const boom = async () => {
      throw new Error("falha com segredo@ex.com e senhaSecreta9");
    };
    const lines: string[] = [];
    const broken = buildApp(
      { LOG_LEVEL: "debug" },
      {
        profile: {
          checkSession: async () => ({ ok: true, session, setCookies: [] }),
          service: {
            get: boom,
            updateName: boom,
            changePassword: boom,
            requestPasswordLink: boom,
            revokeOtherSessions: boom,
          },
        },
        logStream: { write: (line) => lines.push(line) },
      },
    );
    const response = await broken.inject({
      method: "POST",
      url: "/api/profile/password",
      payload: { currentPassword: "senhaSecreta9", newPassword: "outraSenha8" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("segredo");
    const logs = lines.join("\n");
    expect(logs).not.toContain("segredo@ex.com");
    expect(logs).not.toContain("senhaSecreta9");
    expect(logs).not.toContain("falha com");
    await broken.close();
  });
});
