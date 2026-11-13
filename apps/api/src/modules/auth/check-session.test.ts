import type { PanelEntry } from "@app/core";
import { describe, expect, it, vi } from "vitest";
import {
  type AuthGateway,
  type AuthSession,
  createCheckEntry,
  createCheckSession,
  type SessionAccess,
} from "./check-session";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const session: AuthSession = {
  sessionId: "s1",
  userId: "u1",
  name: "Pessoa",
  email: "pessoa@ex.com",
  keepConnected: false,
  updatedAt: NOW,
};

function setup(entry: PanelEntry, found: AuthSession | null = session) {
  const gateway = {
    readSession: async () => found,
    refreshSession: async () => [],
  } as unknown as AuthGateway;
  const touchSession = vi.fn(async () => undefined);
  const access: SessionAccess = {
    hasActiveMembership: async () => entry.kind === "full",
    panelEntry: async () => entry,
    touchSession,
  };
  const clock = { now: () => NOW, today: () => "2026-11-11" };
  return {
    checkEntry: createCheckEntry({ gateway, access, clock }),
    checkSession: createCheckSession({ gateway, access, clock }),
    touchSession,
  };
}

describe("createCheckEntry", () => {
  it("sem sessão: não passa", async () => {
    const { checkEntry } = setup({ kind: "full" }, null);
    expect(await checkEntry(new Headers())).toEqual({ ok: false });
  });

  it("acesso completo: passa como full", async () => {
    const { checkEntry } = setup({ kind: "full" });
    const result = await checkEntry(new Headers());
    expect(result).toMatchObject({ ok: true, access: "full", session });
  });

  it("dono sem unidade: passa como restrito owner_no_unit", async () => {
    const { checkEntry } = setup({ kind: "restricted", reason: "owner_no_unit" });
    expect(await checkEntry(new Headers())).toMatchObject({
      ok: true,
      access: "restricted",
      reason: "owner_no_unit",
    });
  });

  it("sem vínculo ativo: passa como restrito no_membership", async () => {
    const { checkEntry } = setup({ kind: "restricted", reason: "no_membership" });
    expect(await checkEntry(new Headers())).toMatchObject({
      ok: true,
      access: "restricted",
      reason: "no_membership",
    });
  });

  it("usuário recusado (ask_owner ou no_access): não passa", async () => {
    for (const reason of ["ask_owner", "no_access"] as const) {
      const { checkEntry } = setup({ kind: "refused", reason });
      expect(await checkEntry(new Headers())).toEqual({ ok: false });
    }
  });

  it("sessão restrita renova o uso como a completa", async () => {
    const { checkEntry, touchSession } = setup(
      { kind: "restricted", reason: "no_membership" },
      { ...session, updatedAt: new Date(NOW.getTime() - 10 * 60_000) },
    );
    await checkEntry(new Headers());
    expect(touchSession).toHaveBeenCalledTimes(1);
  });
});

describe("createCheckSession com a regra nova", () => {
  it("checkSession só aceita acesso completo", async () => {
    for (const entry of [
      { kind: "restricted", reason: "owner_no_unit" },
      { kind: "restricted", reason: "no_membership" },
      { kind: "refused", reason: "ask_owner" },
    ] as PanelEntry[]) {
      expect(await setup(entry).checkSession(new Headers())).toEqual({ ok: false });
    }
    expect((await setup({ kind: "full" }).checkSession(new Headers())).ok).toBe(true);
  });
});
