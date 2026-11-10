import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { AuthGateway, CheckSession, SessionBlocked } from "../../modules/auth/check-session";

function appWith(secure: boolean) {
  const gateway = {
    handle: async (request: Request) => {
      const ok = !request.url.includes("falha");
      return new Response("{}", {
        status: ok ? 200 : 401,
        headers: { "content-type": "application/json", "set-cookie": "sessao=1; Path=/" },
      });
    },
  } as unknown as AuthGateway;
  return buildApp(
    { LOG_LEVEL: "silent" },
    {
      auth: {
        gateway,
        checkSession: (async () => ({ ok: false })) as unknown as CheckSession,
        sessionBlocked: (async () => false) as unknown as SessionBlocked,
        secure,
      },
    },
  );
}

const cookiesOf = (header: unknown): string[] =>
  Array.isArray(header) ? (header as string[]) : header ? [header as string] : [];

describe("expirar o cookie de contexto no login e no sair", () => {
  const paths = ["/api/auth/sign-in/email", "/api/auth/sign-in/email-otp", "/api/auth/sign-out"];

  it("secure: expira só __Secure-fr_ctx, com Secure", async () => {
    const app = appWith(true);
    for (const url of paths) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      const cookies = cookiesOf(response.headers["set-cookie"]);
      const ctx = cookies.filter((c) => c.includes("fr_ctx="));
      expect(ctx, url).toEqual([
        "__Secure-fr_ctx=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure",
      ]);
      expect(cookies).toContain("sessao=1; Path=/");
    }
  });

  it("fora de secure: expira só fr_ctx, sem Secure", async () => {
    const app = appWith(false);
    for (const url of paths) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      const ctx = cookiesOf(response.headers["set-cookie"]).filter((c) => c.includes("fr_ctx="));
      expect(ctx, url).toEqual(["fr_ctx=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"]);
    }
  });

  it("sair expira o cookie de contexto mesmo com a sessão já inválida (resposta de erro)", async () => {
    for (const secure of [true, false]) {
      const app = appWith(secure);
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-out?falha=1",
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      const ctx = cookiesOf(response.headers["set-cookie"]).filter((c) => c.includes("fr_ctx="));
      expect(ctx).toHaveLength(1);
      expect(ctx[0]).toMatch(secure ? /^__Secure-fr_ctx=; Max-Age=0/ : /^fr_ctx=; Max-Age=0/);
    }
  });

  it("resposta de erro de login não mexe no cookie de contexto", async () => {
    const app = appWith(true);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email?falha=1",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(cookiesOf(response.headers["set-cookie"]).some((c) => c.includes("fr_ctx"))).toBe(false);
  });
});
