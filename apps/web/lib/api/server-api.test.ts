// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { meFixture } from "./me-fixture";

vi.mock("next/headers", () => ({
  cookies: async () => ({ toString: () => "better-auth.session_token=x; fr_ctx=abc" }),
}));
vi.mock("@/lib/auth/session", () => ({
  apiUrl: () => "http://api.local",
  requireCurrentSession: async () => meFixture(),
}));

import { serverApi } from "./server-api";

afterEach(() => vi.unstubAllGlobals());

describe("serverApi", () => {
  it("repassa cookie e X-Context do contexto da sessão", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const api = await serverApi();
    await api.get("/api/units", z.object({ ok: z.boolean() }));

    const me = meFixture();
    expect(calls[0]?.url).toBe("http://api.local/api/units");
    expect(calls[0]?.headers.get("cookie")).toBe("better-auth.session_token=x; fr_ctx=abc");
    expect(calls[0]?.headers.get("x-context")).toBe(`${me.context.tenantId}.all`);
  });
});
