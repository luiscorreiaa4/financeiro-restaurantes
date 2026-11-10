import { describe, expect, it } from "vitest";
import type { AuthSession } from "../auth/check-session";
import { createProfileService, ProfileError, type ProfileServiceDeps } from "./profile-service";

const NOW = new Date("2026-11-09T12:00:00.000Z");

const session: AuthSession = {
  sessionId: "s-atual",
  userId: "u1",
  name: "Maria",
  email: "Maria@Ex.com",
  keepConnected: false,
  updatedAt: NOW,
};

function setup(options: { hash?: string | null; deleteError?: unknown } = {}) {
  const calls: string[] = [];
  const requested: { email: string; ip?: string; userAgent?: string }[] = [];
  const audits: { event: string; ip?: string }[] = [];
  const notices: unknown[] = [];
  let hash: string | null = options.hash === undefined ? "hash-atual" : options.hash;

  const deps: ProfileServiceDeps = {
    store: {
      getPasswordHash: async () => hash,
      setPasswordHash: async (_id, next) => {
        calls.push("setPasswordHash");
        hash = next;
        return true;
      },
      listSessions: async () => [
        { id: "s-atual", userAgent: null, updatedAt: NOW },
        { id: "s-outra", userAgent: "Mozilla/5.0 (iPhone) Safari/604.1", updatedAt: NOW },
      ],
      deleteSessionsExcept: async (_id, keep) => {
        calls.push(`deleteSessionsExcept:${keep}`);
        if (options.deleteError) throw options.deleteError;
        return 1;
      },
      updateUserName: async () => {
        calls.push("updateUserName");
      },
      recordAudit: async (event) => {
        audits.push({ event: event.event, ...(event.ip ? { ip: event.ip } : {}) });
      },
    },
    gateway: {
      hashPassword: async (password) => `hash(${password})`,
      verifyPassword: async ({ hash: stored, password }) => stored === `hash(${password})`,
      requestPasswordLink: async (input) => {
        requested.push(input);
      },
    },
    email: {
      sendSecurityNotice: async (notice) => {
        notices.push(notice);
      },
    },
    background: { run: (task) => void task() },
    clock: { now: () => NOW, today: () => "2026-11-09" as never },
  };
  return { service: createProfileService(deps), calls, requested, audits, notices };
}

describe("serviço de perfil", () => {
  it("get: marca só a sessão atual, rotula o aparelho e não devolve id nem token", async () => {
    const { service } = setup();
    const view = await service.get(session);
    expect(view).toEqual({
      name: "Maria",
      email: "Maria@Ex.com",
      hasPassword: true,
      sessions: [
        { device: "Navegador desconhecido", lastUsedAt: NOW.toISOString(), current: true },
        { device: "Safari no iPhone", lastUsedAt: NOW.toISOString(), current: false },
      ],
    });
  });

  it("requestPasswordLink usa o e-mail da sessão normalizado e o IP recebido", async () => {
    const { service, requested } = setup();
    await service.requestPasswordLink(session, { ip: "10.0.0.1", userAgent: "ua" });
    expect(requested).toEqual([{ email: "maria@ex.com", ip: "10.0.0.1", userAgent: "ua" }]);
  });

  it("falha ao derrubar as outras sessões: a senha não é gravada", async () => {
    const { service, calls } = setup({
      hash: "hash(senhaForte1)",
      deleteError: new Error("banco fora"),
    });
    await expect(
      service.changePassword(session, {
        currentPassword: "senhaForte1",
        newPassword: "senhaNova2",
      }),
    ).rejects.toThrow("banco fora");
    expect(calls).not.toContain("setPasswordHash");
  });

  it("changePassword: sem senha cadastrada responde NO_PASSWORD", async () => {
    const { service } = setup({ hash: null });
    const error = await service
      .changePassword(session, { currentPassword: "x", newPassword: "senhaNova2" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProfileError);
    expect(error).toMatchObject({ code: "NO_PASSWORD" });
  });

  it("changePassword: ordem grava a senha, derruba as outras sessões e avisa", async () => {
    const { service, calls, audits, notices } = setup({ hash: "hash(senhaForte1)" });
    await service.changePassword(session, {
      currentPassword: "senhaForte1",
      newPassword: "senhaNova2",
      ip: "10.0.0.1",
    });
    expect(calls).toEqual([
      "deleteSessionsExcept:s-atual",
      "setPasswordHash",
      "deleteSessionsExcept:s-atual",
    ]);
    expect(audits).toEqual([{ event: "password_changed", ip: "10.0.0.1" }]);
    expect(notices).toEqual([{ to: "maria@ex.com", kind: "password-changed", at: NOW }]);
  });

  it("updateName apara e recusa nome vazio ou longo", async () => {
    const { service, calls } = setup();
    await service.updateName(session, "  Ana  ");
    expect(calls).toEqual(["updateUserName"]);
    await expect(service.updateName(session, "   ")).rejects.toMatchObject({
      code: "INVALID_NAME",
    });
    await expect(service.updateName(session, "a".repeat(121))).rejects.toMatchObject({
      code: "INVALID_NAME",
    });
  });
});
