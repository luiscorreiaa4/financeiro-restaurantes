import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/api/client";
import { meFixture } from "@/lib/api/me-fixture";
import { SessionKeeper } from "./session-keeper";

function setup(source: "cookie" | "fallback" | "invalid_cookie") {
  const me = meFixture({ contextSource: source });
  const api = {
    get: vi.fn(async () => me),
    post: vi.fn(async () => undefined),
    patch: vi.fn(),
  } as unknown as ApiClient;
  const nav = { reload: vi.fn(), assign: vi.fn(), pathname: "/lancamentos" };
  render(<SessionKeeper me={me} api={api} nav={nav} />);
  return { me, api, nav };
}

describe("SessionKeeper", () => {
  it("chama GET /api/me uma vez por carregamento (renova a sessão)", async () => {
    const { api } = setup("cookie");

    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/me", expect.anything()));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("cookie não dispara POST /api/context", async () => {
    const { api, nav } = setup("cookie");

    await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
    expect(nav.reload).not.toHaveBeenCalled();
  });

  it("contextSource fallback dispara POST /api/context e recarrega", async () => {
    const { api, nav, me } = setup("fallback");

    await vi.waitFor(() => expect(nav.reload).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenCalledWith(
      "/api/context",
      { tenantId: me.context.tenantId, unitId: me.context.unitId },
      expect.anything(),
    );
  });

  it("invalid_cookie grava o contexto e recarrega com ?aviso=acesso-removido", async () => {
    const { nav } = setup("invalid_cookie");

    await vi.waitFor(() =>
      expect(nav.assign).toHaveBeenCalledWith("/lancamentos?aviso=acesso-removido"),
    );
    expect(nav.reload).not.toHaveBeenCalled();
  });

  it("pageshow com persisted recarrega; sem persisted não", () => {
    const { nav } = setup("cookie");

    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    expect(nav.reload).not.toHaveBeenCalled();

    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(nav.reload).toHaveBeenCalledOnce();
  });
});
