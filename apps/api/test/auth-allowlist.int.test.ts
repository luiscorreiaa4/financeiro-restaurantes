import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";

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

const CLOSED_POST = [
  "/api/auth/update-user",
  "/api/auth/change-email",
  "/api/auth/change-password",
  "/api/auth/revoke-other-sessions",
  "/api/auth/revoke-session",
  "/api/auth/email-otp/reset-password",
  "/api/auth/email-otp/check-verification-otp",
  "/api/auth/reset-password",
  "/api/auth/forget-password/email-otp",
  "/api/auth/email-otp/request-password-reset",
  "/api/auth/request-password-reset",
];
const CLOSED_GET = ["/api/auth/list-sessions", "/api/auth/get-session"];

describe("lista fechada de rotas do Better Auth (F1c)", () => {
  it("rotas fora da lista respondem 404 com e sem sessão", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = h.sessionCookie(await h.signInPassword(user.email, "senhaForte1"));
    for (const withCookie of [undefined, cookie]) {
      for (const url of CLOSED_POST) {
        const response = await h.post(url, { name: "Outro", email: user.email }, withCookie);
        expect(response.statusCode, url).toBe(404);
        expect(response.json(), url).toMatchObject({ code: "INVALID_REQUEST" });
      }
      for (const url of CLOSED_GET) {
        const response = await h.app.inject({
          method: "GET",
          url,
          headers: withCookie ? { cookie: withCookie } : {},
        });
        expect(response.statusCode, url).toBe(404);
      }
    }
    const { rows } = await h.db.admin.query("select name from users where id = $1", [user.userId]);
    expect(rows[0].name).toBe("Pessoa");
  });

  it("variações de barras e caixa também respondem 404", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = h.sessionCookie(await h.signInPassword(user.email, "senhaForte1"));
    for (const url of [
      "//api/auth//Update-User/",
      "/api/auth/UPDATE-USER",
      "/api/auth/update-user/",
    ]) {
      const response = await h.post(url, { name: "Outro" }, cookie);
      expect(response.statusCode, url).toBe(404);
    }
  });

  it("as quatro rotas permitidas continuam funcionando", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const cookie = await h.loginWithCode(user.email);
    expect((await h.me(cookie)).statusCode).toBe(200);
    const byPassword = await h.signInPassword(user.email, "senhaForte1");
    expect(byPassword.statusCode).toBe(200);
    const out = await h.post("/api/auth/sign-out", {}, h.sessionCookie(byPassword));
    expect(out.statusCode).toBe(200);
  });

  it("pedir link de recuperação por /api/auth/* responde 404 e nada é enviado", async () => {
    const user = await h.createUser();
    for (const url of [
      "/api/auth/email-otp/request-password-reset",
      "/api/auth/request-password-reset",
    ]) {
      const response = await h.post(url, { email: user.email });
      expect(response.statusCode, url).toBe(404);
    }
    await h.tasks.drain();
    expect(h.email.sent).toHaveLength(0);
    expect(h.email.sentLinks).toHaveLength(0);
  });

  it("código do tipo forget-password não é mais gerado por send-verification-otp", async () => {
    const user = await h.createUser();
    const response = await h.post("/api/auth/email-otp/send-verification-otp", {
      email: user.email,
      type: "forget-password",
    });
    expect(response.statusCode).toBe(400);
    await h.tasks.drain();
    expect(h.email.sent).toHaveLength(0);
    const { rows } = await h.db.admin.query("select 1 from verifications");
    expect(rows).toHaveLength(0);
  });
});
