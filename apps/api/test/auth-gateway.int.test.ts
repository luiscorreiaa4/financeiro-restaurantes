import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ResetTokenError } from "../src/modules/auth/check-session";
import { type AuthHarness, MINUTE, startAuthHarness } from "./support/auth-harness";

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

async function tokenFailure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ResetTokenError) return error.code;
    throw error;
  }
  throw new Error("esperava ResetTokenError");
}

/** Pede o link pelo gateway e devolve o token do fragmento da URL enviada. */
async function linkToken(address: string, ip: string): Promise<string> {
  await h.gateway.requestPasswordLink({ email: address, ip });
  await h.tasks.drain();
  const url = h.email.sentLinks.at(-1)?.url;
  if (url === undefined) throw new Error("nenhum link enviado");
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";
}

describe("operações do AuthGateway para recuperação de senha (F1c, DD-27)", () => {
  it("requestPasswordLink envia o link a quem tem vínculo; desconhecido e sem vínculo, nada", async () => {
    const user = await h.createUser();
    const gone = await h.createUser({ membership: "deactivated" });
    await h.gateway.requestPasswordLink({ email: user.email, ip: "10.9.0.1" });
    await h.gateway.requestPasswordLink({ email: gone.email, ip: "10.9.0.2" });
    await expect(
      h.gateway.requestPasswordLink({ email: "ninguem@ex.com", ip: "10.9.0.3" }),
    ).resolves.toBeUndefined();
    await h.tasks.drain();
    expect(h.email.sentLinks).toHaveLength(1);
    expect(h.email.sentLinks[0]?.to).toBe(user.email);
    expect(h.email.sentLinks[0]?.url).toMatch(/\/redefinir-senha#token=[\w-]+$/);
    expect(h.email.sent).toHaveLength(0);
  });

  it("peekResetToken não consome o link, devolve o usuário e recusa desconhecido e vencido", async () => {
    const user = await h.createUser();
    const token = await linkToken(user.email, "10.9.1.1");
    expect(await h.gateway.peekResetToken(token)).toEqual({ userId: user.userId });
    expect(await h.gateway.peekResetToken(token)).toEqual({ userId: user.userId });
    expect(await h.gateway.peekResetToken("inventado")).toBeNull();
    h.clock.advance(30 * MINUTE + 1000);
    expect(await h.gateway.peekResetToken(token)).toBeNull();
  });

  it("resetPasswordWithToken consome o link e grava a senha nova", async () => {
    const user = await h.createUser({ password: "senhaForte1" });
    const token = await linkToken(user.email, "10.9.2.1");
    await h.gateway.resetPasswordWithToken({ token, password: "novaSenha22" });
    expect((await h.signInPassword(user.email, "novaSenha22")).statusCode).toBe(200);
    expect((await h.signInPassword(user.email, "senhaForte1")).statusCode).toBe(401);
    expect(await h.gateway.peekResetToken(token)).toBeNull();
    expect(
      await tokenFailure(() =>
        h.gateway.resetPasswordWithToken({ token, password: "outraSenha33" }),
      ),
    ).toBe("INVALID_TOKEN");
  });

  it("resetPasswordWithToken cria a conta credential de quem ainda não tinha senha", async () => {
    const user = await h.createUser();
    const token = await linkToken(user.email, "10.9.3.1");
    await h.gateway.resetPasswordWithToken({ token, password: "primeiraSenha1" });
    expect((await h.signInPassword(user.email, "primeiraSenha1")).statusCode).toBe(200);
  });

  it("link vencido: INVALID_TOKEN", async () => {
    const user = await h.createUser();
    const token = await linkToken(user.email, "10.9.4.1");
    h.clock.advance(30 * MINUTE + 1000);
    expect(
      await tokenFailure(() => h.gateway.resetPasswordWithToken({ token, password: "senhaNova1" })),
    ).toBe("INVALID_TOKEN");
  });

  it("verifyPassword: senha certa e errada", async () => {
    const hash = await h.gateway.hashPassword("senhaForte1");
    expect(await h.gateway.verifyPassword({ hash, password: "senhaForte1" })).toBe(true);
    expect(await h.gateway.verifyPassword({ hash, password: "senhaErrada1" })).toBe(false);
  });
});
