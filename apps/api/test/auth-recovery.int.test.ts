import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { type AuthHarness, MINUTE, SECOND, sha256, startAuthHarness } from "./support/auth-harness";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.7.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

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

const requestLink = (address: string, ip = nextIp()) =>
  h.post("/api/recovery/request", { email: address }, undefined, ip);

/** Token do fragmento `#token=...` do link enviado ao e-mail (nunca vai ao servidor). */
function tokenOf(url: string): string {
  expect(url).toContain("/redefinir-senha#token=");
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (token === null || token === "") throw new Error("link sem token");
  return token;
}

/** Pede o link pelo mesmo caminho do painel e devolve o token do e-mail enviado. */
async function requestToken(address: string): Promise<string> {
  const response = await requestLink(address);
  expect(response.statusCode).toBe(200);
  await h.tasks.drain();
  const last = h.email.sentLinks.at(-1);
  if (!last) throw new Error("nenhum link enviado");
  expect(last.to).toBe(address);
  return tokenOf(last.url);
}

const reset = (body: { token: string; password: string }, ip = nextIp()) =>
  h.post("/api/recovery/reset", body, undefined, ip);

async function resetAudits(): Promise<{ user_id: string | null; email_hash: string | null }[]> {
  const { rows } = await h.db.admin.query<{ user_id: string | null; email_hash: string | null }>(
    "select user_id, email_hash from auth_audit where event = 'password_reset'",
  );
  return rows;
}

describe("recuperação de senha pelo link (RF03, DD-27)", () => {
  it("RF03.CA01: quem não tem senha pede o link, define a senha e entra com ela", async () => {
    const user = await h.createUser();
    const token = await requestToken(user.email);

    const response = await reset({ token, password: "senhaNova1" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect((await h.signInPassword(user.email, "senhaNova1")).statusCode).toBe(200);
  });

  it("RF03.CA02: as sessões abertas caem e o aviso de senha alterada é enviado", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const first = await h.loginWithCode(user.email);
    h.clock.advance(MINUTE); // intervalo mínimo entre envios (RF02.R4)
    const second = await h.loginWithCode(user.email);
    expect((await h.me(first)).statusCode).toBe(200);
    expect((await h.me(second)).statusCode).toBe(200);

    h.clock.advance(MINUTE);
    const token = await requestToken(user.email);
    expect((await reset({ token, password: "senhaNova1" })).statusCode).toBe(200);
    await h.tasks.drain();

    expect((await h.me(first)).statusCode).toBe(401);
    expect((await h.me(second)).statusCode).toBe(401);
    expect(h.email.sentNotices).toHaveLength(1);
    expect(h.email.sentNotices[0]).toMatchObject({ to: user.email, kind: "password-changed" });
  });

  it("RF03.CA03: e-mail desconhecido, sem vínculo e limitado recebem a mesma resposta e nada é enviado", async () => {
    const known = await h.createUser();
    const gone = await h.createUser({ membership: "deactivated" });
    const first = await requestLink(known.email);
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(1);

    (h.email.sentLinks as unknown[]).length = 0;
    const limited = await requestLink(known.email); // dentro de 60 s do envio anterior
    const unknown = await requestLink("ninguem@ex.com");
    const noMembership = await requestLink(gone.email);
    await h.tasks.drain();

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ success: true });
    for (const other of [limited, unknown, noMembership]) {
      expect(other.statusCode).toBe(first.statusCode);
      expect(other.body).toBe(first.body);
    }
    expect(h.email.sentLinks).toHaveLength(0);
    expect(h.email.sentNotices).toHaveLength(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("RF03.R2: reenvio em menos de 60 s não envia segundo link; depois de 60 s envia", async () => {
    const user = await h.createUser();
    await requestLink(user.email);
    await h.tasks.drain(); // o envio roda fora da requisição: precisa acabar antes do relógio andar
    h.clock.advance(59 * SECOND);
    await requestLink(user.email);
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(1);

    h.clock.advance(2 * SECOND);
    await requestLink(user.email);
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(2);
  });

  it("RF03.R2: o 6º pedido na mesma hora para o e-mail não envia e responde igual", async () => {
    const user = await h.createUser();
    const answers = [];
    for (let i = 0; i < 6; i++) {
      answers.push(await requestLink(user.email));
      await h.tasks.drain();
      h.clock.advance(61 * SECOND);
    }
    expect(h.email.sentLinks).toHaveLength(5);
    for (const answer of answers) expect(answer.body).toBe(answers[0]?.body);
    expect(answers.at(-1)?.statusCode).toBe(200);
  });

  it("RF03.R2: o IP gravado no pedido é o da conexão, nunca o de cabeçalho ou corpo", async () => {
    const user = await h.createUser();
    const response = await h.app.inject({
      method: "POST",
      url: "/api/recovery/request",
      remoteAddress: "10.201.0.9",
      headers: {
        "content-type": "application/json",
        origin: h.origin,
        "user-agent": "vitest",
        "x-forwarded-for": "6.6.6.6",
        "x-real-ip": "7.7.7.7",
      },
      payload: JSON.stringify({ email: user.email, ip: "8.8.8.8" }),
    });
    expect(response.statusCode).toBe(200);
    await h.tasks.drain();
    const { rows } = await h.db.admin.query<{ ip: string }>(
      "select ip from auth_audit where event = 'otp_sent'",
    );
    expect(rows).toEqual([{ ip: "10.201.0.9" }]);
  });

  it("RF03.R2: dois links pedidos em sequência valem os dois; usar um não invalida o outro", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const first = await requestToken(user.email);
    h.clock.advance(61 * SECOND);
    const second = await requestToken(user.email);
    expect(second).not.toBe(first);

    expect((await reset({ token: first, password: "senhaNova1" })).statusCode).toBe(200);
    expect((await reset({ token: second, password: "senhaNova2" })).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "senhaNova2")).statusCode).toBe(200);
  });

  it("RF03.R2: o link vale 30 minutos (29 min ainda vale; 30 min e 1 s não)", async () => {
    const user = await h.createUser();
    const token = await requestToken(user.email);
    h.clock.advance(29 * MINUTE);
    expect((await reset({ token, password: "senhaNova1" })).statusCode).toBe(200);

    h.clock.reset();
    const other = await h.createUser();
    const late = await requestToken(other.email);
    h.clock.advance(30 * MINUTE + SECOND);
    const response = await reset({ token: late, password: "senhaNova1" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_TOKEN" });
    expect((await h.signInPassword(other.email, "senhaNova1")).statusCode).toBe(401);
  });

  it("RF03.R2: o link usado não funciona de novo", async () => {
    const user = await h.createUser();
    const token = await requestToken(user.email);
    expect((await reset({ token, password: "senhaNova1" })).statusCode).toBe(200);
    const again = await reset({ token, password: "senhaNova2" });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ code: "INVALID_TOKEN" });
    expect((await h.signInPassword(user.email, "senhaNova2")).statusCode).toBe(401);
  });

  it("token inventado, vazio ou de outro formato: INVALID_TOKEN", async () => {
    for (const token of ["abc", "x".repeat(24), "reset-password:abc", " ", ""]) {
      const response = await reset({ token, password: "senhaNova1" });
      expect(response.statusCode, token).toBe(400);
      expect(response.json(), token).toMatchObject({ code: "INVALID_TOKEN" });
    }
  });

  it("usuário que perdeu o vínculo ativo depois de pedir: INVALID_TOKEN e a senha não muda", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const token = await requestToken(user.email);
    await h.db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [user.userId],
    );
    const response = await reset({ token, password: "senhaNova1" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_TOKEN" });
    await h.tasks.drain();
    expect(h.email.sentNotices).toHaveLength(0);
    expect(await resetAudits()).toHaveLength(0);
    const { rows } = await h.db.admin.query<{ password: string }>(
      "select password from accounts where user_id = $1",
      [user.userId],
    );
    expect(
      await h.gateway.verifyPassword({ hash: rows[0]?.password ?? "", password: "senhaForte1" }),
    ).toBe(true);
  });

  it("RF03.R3: senha igual à atual é recusada e o mesmo link ainda conclui com outra senha", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const token = await requestToken(user.email);

    const same = await reset({ token, password: "senhaForte1" });
    expect(same.statusCode).toBe(400);
    expect(same.json()).toMatchObject({ code: "SAME_PASSWORD" });

    expect((await reset({ token, password: "outraSenha2" })).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "outraSenha2")).statusCode).toBe(200);
  });

  it("dois reset ao mesmo tempo com o mesmo link: só um conclui e a senha do outro não é gravada", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const token = await requestToken(user.email);

    const [a, b] = await Promise.all([
      reset({ token, password: "primeiraSenha1" }),
      reset({ token, password: "segundaSenha2" }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    const loser = a.statusCode === 400 ? a : b;
    expect(loser.json()).toMatchObject({ code: "INVALID_TOKEN" });
    const winnerPassword = a.statusCode === 200 ? "primeiraSenha1" : "segundaSenha2";
    const loserPassword = a.statusCode === 200 ? "segundaSenha2" : "primeiraSenha1";
    expect((await h.signInPassword(user.email, winnerPassword)).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, loserPassword)).statusCode).toBe(401);
  });

  it("token com byte nulo ou caracteres fora do alfabeto do token: 400, nunca 500", async () => {
    for (const token of ["abc\u0000def", "abc def", "abc:def", "../x"]) {
      const response = await reset({ token, password: "senhaNova1" });
      expect(response.statusCode, JSON.stringify(token)).toBe(400);
      expect(response.json(), JSON.stringify(token)).toMatchObject({ code: "INVALID_TOKEN" });
    }
  });

  it("usuário com a senha bloqueada recupera e já entra com a senha nova", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    for (let i = 0; i < 5; i++) await h.signInPassword(user.email, "errada123");
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(429);

    const token = await requestToken(user.email);
    expect((await reset({ token, password: "senhaNova1" })).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "senhaNova1")).statusCode).toBe(200);
  });

  describe("regra de senha (o link continua válido depois do erro)", () => {
    const cases: Array<[string, (email: string) => string, string]> = [
      ["PASSWORD_TOO_SHORT", () => "abc1234", "curta"],
      ["PASSWORD_TOO_LONG", () => `a1${"b".repeat(63)}`, "com 65 caracteres"],
      ["PASSWORD_NEEDS_LETTER_AND_DIGIT", () => "somenteletras", "sem número"],
      ["PASSWORD_SAME_AS_EMAIL", (email) => email, "igual ao e-mail"],
    ];
    for (const [expected, password, label] of cases) {
      it(`${expected}: senha ${label}`, async () => {
        const user = await h.createUser();
        const token = await requestToken(user.email);
        const response = await reset({ token, password: password(user.email) });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: expected });
        expect((await reset({ token, password: "senhaBoa123" })).statusCode).toBe(200);
      });
    }

    it("a senha longa do caso acima tem mesmo 65 caracteres", () => {
      expect(`a1${"b".repeat(63)}`).toHaveLength(65);
    });
  });

  it("auditoria: password_reset com o hash do e-mail, sem e-mail, token nem senha em claro (nem nos logs)", async () => {
    const user = await h.createUser();
    const token = await requestToken(user.email);
    await reset({ token, password: "senhaSecreta9" });

    expect(await resetAudits()).toEqual([{ user_id: user.userId, email_hash: sha256(user.email) }]);
    const { rows: all } = await h.db.admin.query("select * from auth_audit");
    const dump = JSON.stringify(all);
    for (const secret of [user.email, token, "senhaSecreta9"]) {
      expect(dump).not.toContain(secret);
      expect(h.logLines.join("\n")).not.toContain(secret);
    }
  });

  it("o IP gravado na troca é o da conexão, nunca o de cabeçalho ou corpo", async () => {
    const user = await h.createUser();
    const token = await requestToken(user.email);
    const response = await h.app.inject({
      method: "POST",
      url: "/api/recovery/reset",
      remoteAddress: "10.200.0.9",
      headers: {
        "content-type": "application/json",
        origin: h.origin,
        "user-agent": "vitest",
        "x-forwarded-for": "6.6.6.6",
        "x-real-ip": "7.7.7.7",
      },
      payload: JSON.stringify({ token, password: "senhaNova1", ip: "8.8.8.8" }),
    });
    expect(response.statusCode).toBe(200);
    const { rows } = await h.db.admin.query<{ ip: string }>(
      "select ip from auth_audit where event = 'password_reset'",
    );
    expect(rows).toEqual([{ ip: "10.200.0.9" }]);
  });

  it("e-mail com maiúsculas e espaços no pedido é normalizado", async () => {
    const user = await h.createUser();
    const response = await requestLink(`  ${user.email.toUpperCase()} `);
    expect(response.statusCode).toBe(200);
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(1);
    expect(h.email.sentLinks[0]?.to).toBe(user.email);
  });

  it("o código de entrada (RF02) não conclui a recuperação", async () => {
    const user = await h.createUser();
    await h.requestCode(user.email);
    const response = await reset({ token: h.lastCode(), password: "senhaNova1" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("corpo inválido: 400 no formato da API; erro inesperado vira 500 genérico sem vazar nada", async () => {
    expect((await h.post("/api/recovery/reset", { password: "senhaNova1" })).statusCode).toBe(400);
    expect(
      (await h.post("/api/recovery/reset", { token: "x".repeat(129), password: "senhaNova1" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await h.post("/api/recovery/reset", { token: "t", password: "p".repeat(257) })).statusCode,
    ).toBe(400);
    expect((await h.post("/api/recovery/request", {})).statusCode).toBe(400);
    expect(
      (await h.post("/api/recovery/request", { email: `${"a".repeat(320)}@ex.com` })).statusCode,
    ).toBe(400);
    const invalid = await h.post("/api/recovery/request", { email: 7 });
    expect(invalid.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const lines: string[] = [];
    const boom = async () => {
      throw new Error("falha com segredo@ex.com e senhaSecreta9 e tok-secreto");
    };
    const broken = buildApp(
      { LOG_LEVEL: "debug" },
      {
        recovery: { recover: boom, requestLink: boom },
        logStream: { write: (line) => lines.push(line) },
      },
    );
    for (const [url, payload] of [
      ["/api/recovery/reset", { token: "tok-secreto", password: "senhaSecreta9" }],
      ["/api/recovery/request", { email: "segredo@ex.com" }],
    ] as const) {
      const response = await broken.inject({ method: "POST", url, payload });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("segredo");
    }
    const logs = lines.join("\n");
    for (const secret of ["segredo@ex.com", "senhaSecreta9", "tok-secreto", "falha com"]) {
      expect(logs).not.toContain(secret);
    }
    await broken.close();
  });
});
