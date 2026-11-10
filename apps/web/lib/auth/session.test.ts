import { describe, expect, it, vi } from "vitest";
import { meFixture } from "@/lib/api/me-fixture";
import { getSession, requireSessionOrRedirect } from "./session";

const base = "http://api.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sessão no servidor", () => {
  it("sem cookie: null, sem chamar a API", async () => {
    const fetchMock = vi.fn();

    const session = await getSession({ baseUrl: base, cookieHeader: "", fetch: fetchMock });

    expect(session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API devolve 401: null", async () => {
    const session = await getSession({
      baseUrl: base,
      cookieHeader: "better-auth.session_token=x",
      fetch: async () => json({ code: "UNAUTHORIZED", message: "Entre de novo." }, 401),
    });

    expect(session).toBeNull();
  });

  it("API devolve a sessão com o contexto (repassa o cookie, sem cache)", async () => {
    let called: { url: string; init?: RequestInit } | undefined;
    const session = await getSession({
      baseUrl: base,
      cookieHeader: "better-auth.session_token=x",
      fetch: async (url, init) => {
        called = { url: String(url), init };
        return json(meFixture());
      },
    });

    expect(session).toEqual(meFixture());
    expect(called?.url).toBe("http://api.local/api/me");
    expect(new Headers(called?.init?.headers).get("cookie")).toBe("better-auth.session_token=x");
    expect(called?.init?.cache).toBe("no-store");
  });

  it("resposta sem context (contrato antigo): null", async () => {
    const session = await getSession({
      baseUrl: base,
      cookieHeader: "a=b",
      fetch: async () => json({ userId: "u1", name: "Dono", email: "dono@demo.dev" }),
    });

    expect(session).toBeNull();
  });

  it("resposta fora do contrato ou API fora do ar: null (nunca autoriza por engano)", async () => {
    const malformed = await getSession({
      baseUrl: base,
      cookieHeader: "a=b",
      fetch: async () => json({ foo: 1 }),
    });
    const down = await getSession({
      baseUrl: base,
      cookieHeader: "a=b",
      fetch: async () => {
        throw new Error("rede");
      },
    });

    expect(malformed).toBeNull();
    expect(down).toBeNull();
  });

  it("requireSessionOrRedirect sem sessão chama redirect('/login')", async () => {
    const paths: string[] = [];
    const redirect = (path: string): never => {
      paths.push(path);
      throw new Error(`REDIRECT:${path}`);
    };

    await expect(
      requireSessionOrRedirect({ baseUrl: base, cookieHeader: "", fetch: vi.fn(), redirect }),
    ).rejects.toMatchObject({ message: "REDIRECT:/login" });
    expect(paths).toEqual(["/login"]);
  });

  it("requireSessionOrRedirect com sessão devolve a sessão", async () => {
    const session = await requireSessionOrRedirect({
      baseUrl: base,
      cookieHeader: "a=b",
      fetch: async () => json(meFixture()),
      redirect: (): never => {
        throw new Error("não devia redirecionar");
      },
    });

    expect(session.userId).toBe("u1");
  });
});
