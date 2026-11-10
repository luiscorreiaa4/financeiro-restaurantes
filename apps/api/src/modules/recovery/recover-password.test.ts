import { describe, expect, it } from "vitest";
import { ResetTokenError } from "../auth/check-session";
import {
  createRecoverPassword,
  createRequestRecoveryLink,
  RecoveryError,
} from "./recover-password";

const NOW = new Date("2026-11-09T12:00:00.000Z");

function setup(
  options: {
    peek?: { userId: string } | null;
    user?: boolean;
    userEmail?: string | null;
    membership?: boolean;
    hash?: string | null;
    samePassword?: boolean;
    resetError?: unknown;
    deleteError?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const notices: unknown[] = [];
  const audits: unknown[] = [];
  const tasks: Array<() => Promise<void>> = [];
  const recover = createRecoverPassword({
    store: {
      findUserById: async () => {
        calls.push("findUser");
        if (options.user === false) return null;
        return {
          id: "u1",
          email: options.userEmail === undefined ? "dona1@ex.com" : options.userEmail,
        };
      },
      hasActiveMembership: async () => {
        calls.push("membership");
        return options.membership !== false;
      },
      getPasswordHash: async () => (options.hash === undefined ? "hash" : options.hash),
      deleteSessionsExcept: async (_u: string, keep: string | null) => {
        calls.push(`deleteSessions:${keep}`);
        if (options.deleteError) throw options.deleteError;
        return 2;
      },
      updatePasswordState: async (_u: string, state: unknown) => {
        calls.push(`state:${JSON.stringify(state)}`);
      },
      recordAudit: async (event: unknown) => {
        calls.push("audit");
        audits.push(event);
      },
    },
    gateway: {
      peekResetToken: async () => {
        calls.push("peek");
        return options.peek === undefined ? { userId: "u1" } : options.peek;
      },
      verifyPassword: async () => {
        calls.push("verify");
        return options.samePassword === true;
      },
      resetPasswordWithToken: async () => {
        calls.push("reset");
        if (options.resetError) throw options.resetError;
      },
    },
    email: {
      sendSecurityNotice: async (message: unknown) => {
        notices.push(message);
      },
    },
    background: { run: (task: () => Promise<void>) => void tasks.push(task) },
    clock: { now: () => NOW, today: () => "2026-11-09" },
  });
  return { recover, calls, notices, audits, tasks };
}

const input = { token: "tok123", password: "senhaNova1" };

async function codeOf(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof RecoveryError) return error.code;
    throw error;
  }
  throw new Error("esperava RecoveryError");
}

describe("recuperar senha pelo link: ordem das etapas (RF03)", () => {
  it("segue a ordem: espia o link, carrega o usuário, valida a senha, revoga, grava, revoga, audita e avisa", async () => {
    const t = setup();
    await t.recover({ ...input, ip: "1.2.3.4", userAgent: "ua" });
    expect(t.calls).toEqual([
      "peek",
      "findUser",
      "membership",
      "verify",
      // Revoga e zera o bloqueio ANTES de gravar a senha: se algo falhar aqui, o link segue válido.
      "deleteSessions:null",
      'state:{"failedAttempts":0,"lockedUntil":null}',
      "reset",
      // Revoga de novo: fecha a janela de uma sessão aberta entre a revogação e a troca.
      "deleteSessions:null",
      "audit",
    ]);
    expect(t.audits).toMatchObject([
      { event: "password_reset", userId: "u1", ip: "1.2.3.4", userAgent: "ua" },
    ]);
    expect(t.notices).toHaveLength(0);
    await t.tasks[0]?.();
    expect(t.notices).toEqual([{ to: "dona1@ex.com", kind: "password-changed", at: NOW }]);
  });

  it("token vazio ou link desconhecido/vencido: INVALID_TOKEN sem consultar o usuário", async () => {
    const empty = setup();
    expect(await codeOf(empty.recover({ ...input, token: "" }))).toBe("INVALID_TOKEN");
    expect(empty.calls).toEqual([]);

    const unknown = setup({ peek: null });
    expect(await codeOf(unknown.recover(input))).toBe("INVALID_TOKEN");
    expect(unknown.calls).toEqual(["peek"]);
  });

  it("usuário ausente, sem e-mail ou sem vínculo ativo: INVALID_TOKEN e nada é gravado", async () => {
    const missing = setup({ user: false });
    expect(await codeOf(missing.recover(input))).toBe("INVALID_TOKEN");
    expect(missing.calls).toEqual(["peek", "findUser"]);

    const noEmail = setup({ userEmail: null });
    expect(await codeOf(noEmail.recover(input))).toBe("INVALID_TOKEN");

    const gone = setup({ membership: false });
    expect(await codeOf(gone.recover(input))).toBe("INVALID_TOKEN");
    expect(gone.calls).toEqual(["peek", "findUser", "membership"]);
    expect(gone.audits).toHaveLength(0);
  });

  it("senha inválida: erro de senha antes de comparar com a atual e sem gravar nada", async () => {
    const t = setup();
    expect(await codeOf(t.recover({ ...input, password: "curta1" }))).toBe("PASSWORD_TOO_SHORT");
    expect(await codeOf(t.recover({ ...input, password: "dona1@ex.com" }))).toBe(
      "PASSWORD_SAME_AS_EMAIL",
    );
    expect(t.calls).not.toContain("verify");
    expect(t.calls).not.toContain("reset");
  });

  it("senha igual à atual: SAME_PASSWORD, sem revogar nem gravar", async () => {
    const t = setup({ samePassword: true });
    expect(await codeOf(t.recover(input))).toBe("SAME_PASSWORD");
    expect(t.calls).not.toContain("reset");
    expect(t.calls.some((c) => c.startsWith("deleteSessions"))).toBe(false);
  });

  it("usuário sem senha (sem hash): não compara e grava", async () => {
    const t = setup({ hash: null });
    await t.recover(input);
    expect(t.calls).not.toContain("verify");
    expect(t.calls).toContain("reset");
  });

  it("falha ao revogar as sessões: a senha não é gravada e o link segue válido", async () => {
    const t = setup({ deleteError: new Error("banco fora") });
    await expect(t.recover(input)).rejects.toThrow("banco fora");
    expect(t.calls).not.toContain("reset");
    expect(t.calls).not.toContain("audit");
  });

  it("ResetTokenError na gravação vira INVALID_TOKEN; erro inesperado não é traduzido", async () => {
    const used = setup({ resetError: new ResetTokenError("INVALID_TOKEN") });
    expect(await codeOf(used.recover(input))).toBe("INVALID_TOKEN");
    expect(used.audits).toHaveLength(0);

    const boom = new Error("falha de banco");
    await expect(setup({ resetError: boom }).recover(input)).rejects.toBe(boom);
  });
});

describe("pedir o link de recuperação", () => {
  it("normaliza o e-mail e repassa IP e navegador da conexão ao gateway", async () => {
    const requested: unknown[] = [];
    const requestLink = createRequestRecoveryLink({
      gateway: {
        requestPasswordLink: async (request) => {
          requested.push(request);
        },
      },
    });
    await requestLink({ email: "  Dona@Ex.com ", ip: "1.2.3.4", userAgent: "ua" });
    expect(requested).toEqual([{ email: "dona@ex.com", ip: "1.2.3.4", userAgent: "ua" }]);
  });
});
