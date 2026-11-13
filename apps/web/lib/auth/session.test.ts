import { describe, expect, it, vi } from "vitest";
import { meSchema } from "@/lib/api/me-contract";
import { meFixture, restrictedMeFixture } from "@/lib/api/me-fixture";
import {
  getSession,
  requireFullSessionOrRedirect,
  requireRestrictedSessionOrRedirect,
  requireSessionOrRedirect,
} from "./session";

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

  describe("três estados (completo, restrito, sem sessão)", () => {
    const redirectTo =
      (paths: string[]) =>
      (path: string): never => {
        paths.push(path);
        throw new Error(`REDIRECT:${path}`);
      };
    const withBody = (body: unknown) => ({
      baseUrl: base,
      cookieHeader: "a=b",
      fetch: async () => json(body),
    });

    it("getSession lê a sessão restrita sem empresas nem contexto", async () => {
      const session = await getSession(withBody(restrictedMeFixture()));

      expect(session).toEqual(restrictedMeFixture());
    });

    it("restrito com motivo fora da lista, ou corpo sem access: null", async () => {
      const badReason = await getSession(withBody({ ...restrictedMeFixture(), reason: "x" }));
      const noAccess = await getSession(withBody({ userId: "u1", name: "A", email: "a@b.c" }));

      expect(badReason).toBeNull();
      expect(noAccess).toBeNull();
    });

    it("meSchema rejeita o corpo antigo completo, sem access", () => {
      const { access: _access, ...antigo } = meFixture();

      expect(meSchema.safeParse(antigo).success).toBe(false);
    });

    it("requireFullSessionOrRedirect: sem sessão vai a /login", async () => {
      const paths: string[] = [];
      await expect(
        requireFullSessionOrRedirect({
          baseUrl: base,
          cookieHeader: "",
          fetch: vi.fn(),
          redirect: redirectTo(paths),
        }),
      ).rejects.toThrow("REDIRECT:/login");
      expect(paths).toEqual(["/login"]);
    });

    it("requireFullSessionOrRedirect: restrito vai a /acesso-restrito", async () => {
      const paths: string[] = [];
      await expect(
        requireFullSessionOrRedirect({
          ...withBody(restrictedMeFixture()),
          redirect: redirectTo(paths),
        }),
      ).rejects.toThrow("REDIRECT:/acesso-restrito");
      expect(paths).toEqual(["/acesso-restrito"]);
    });

    it("requireFullSessionOrRedirect: completo devolve a sessão", async () => {
      const session = await requireFullSessionOrRedirect({
        ...withBody(meFixture()),
        redirect: redirectTo([]),
      });

      expect(session.access).toBe("full");
      expect(session.companies).toHaveLength(1);
    });

    it("requireRestrictedSessionOrRedirect: sem sessão vai a /login e completo vai a /", async () => {
      const none: string[] = [];
      const full: string[] = [];
      await expect(
        requireRestrictedSessionOrRedirect({
          baseUrl: base,
          cookieHeader: "",
          fetch: vi.fn(),
          redirect: redirectTo(none),
        }),
      ).rejects.toThrow("REDIRECT:/login");
      await expect(
        requireRestrictedSessionOrRedirect({
          ...withBody(meFixture()),
          redirect: redirectTo(full),
        }),
      ).rejects.toThrow("REDIRECT:/");
      expect(none).toEqual(["/login"]);
      expect(full).toEqual(["/"]);
    });

    it("requireRestrictedSessionOrRedirect: restrito devolve a sessão", async () => {
      const session = await requireRestrictedSessionOrRedirect({
        ...withBody(restrictedMeFixture({ reason: "no_membership" })),
        redirect: redirectTo([]),
      });

      expect(session.reason).toBe("no_membership");
    });
  });
});
