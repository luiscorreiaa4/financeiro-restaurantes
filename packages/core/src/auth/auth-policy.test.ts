import { describe, expect, it } from "vitest";
import {
  decideOtpSend,
  decidePasswordAttempt,
  normalizeEmail,
  OTP_PER_EMAIL_PER_HOUR,
  OTP_PER_IP_PER_HOUR,
  validatePassword,
} from "./auth-policy";

const now = new Date("2026-11-07T12:00:00.000Z");
const ago = (ms: number) => ({ sentAt: new Date(now.getTime() - ms) });

describe("validatePassword", () => {
  const email = "dono@ex.com";
  it("senha de 7 caracteres: too_short", () => {
    expect(validatePassword({ password: "abc1234", email })).toEqual({
      ok: false,
      error: "too_short",
    });
  });
  it("senha de 65: too_long", () => {
    expect(validatePassword({ password: `a1${"x".repeat(63)}`, email })).toEqual({
      ok: false,
      error: "too_long",
    });
  });
  it("'12345678': needs_letter_and_digit", () => {
    expect(validatePassword({ password: "12345678", email })).toEqual({
      ok: false,
      error: "needs_letter_and_digit",
    });
  });
  it("'abc12345' igual ao e-mail 'ABC12345' ignorando caixa: same_as_email", () => {
    expect(validatePassword({ password: "abc12345", email: "ABC12345" })).toEqual({
      ok: false,
      error: "same_as_email",
    });
  });
  it("senha de 64 com letra e dígito: ok", () => {
    expect(validatePassword({ password: `a1${"x".repeat(62)}`, email }).ok).toBe(true);
  });
});

describe("decidePasswordAttempt", () => {
  const fresh: { failedAttempts: number; lockedUntil: Date | null } = {
    failedAttempts: 0,
    lockedUntil: null,
  };
  it("4 erros seguidos não bloqueiam; o 5º bloqueia por 15 min", () => {
    let state = fresh;
    for (let i = 0; i < 4; i++) {
      const r = decidePasswordAttempt(state, "wrong", now);
      expect(r.next.lockedUntil).toBeNull();
      state = r.next;
    }
    const fifth = decidePasswordAttempt(state, "wrong", now);
    expect(fifth.allowed).toBe(false);
    expect(fifth.next.lockedUntil).toEqual(new Date(now.getTime() + 15 * 60 * 1000));
  });
  it("bloqueado: senha certa continua negada", () => {
    const state = { failedAttempts: 5, lockedUntil: new Date(now.getTime() + 1000) };
    expect(decidePasswordAttempt(state, "ok", now).allowed).toBe(false);
  });
  it("passados 15 min e 1 ms: libera e zera contador", () => {
    const state = { failedAttempts: 5, lockedUntil: new Date(now.getTime()) };
    const later = new Date(now.getTime() + 1);
    const r = decidePasswordAttempt(state, "ok", later);
    expect(r.allowed).toBe(true);
    expect(r.next).toEqual({ failedAttempts: 0, lockedUntil: null });
    const w = decidePasswordAttempt(state, "wrong", later);
    expect(w.next).toEqual({ failedAttempts: 1, lockedUntil: null });
  });
  it("senha certa zera o contador", () => {
    const r = decidePasswordAttempt({ failedAttempts: 3, lockedUntil: null }, "ok", now);
    expect(r).toEqual({ allowed: true, next: { failedAttempts: 0, lockedUntil: null } });
  });
});

describe("decideOtpSend", () => {
  it("primeiro envio: allowed", () => {
    expect(decideOtpSend([], [], now)).toEqual({ allowed: true });
  });
  it("reenvio 59 s depois: too_soon com retryAfterSeconds 1", () => {
    const h = [ago(59_000)];
    expect(decideOtpSend(h, h, now)).toEqual({
      allowed: false,
      reason: "too_soon",
      retryAfterSeconds: 1,
    });
  });
  it("60 s depois: allowed", () => {
    const h = [ago(60_000)];
    expect(decideOtpSend(h, h, now)).toEqual({ allowed: true });
  });
  it("6º envio na mesma hora para o e-mail: email_hourly", () => {
    const h = Array.from({ length: OTP_PER_EMAIL_PER_HOUR }, (_, i) => ago(120_000 + i * 60_000));
    const r = decideOtpSend(h, h, now);
    expect(r).toMatchObject({ allowed: false, reason: "email_hourly" });
  });
  it("21º envio do IP: ip_hourly", () => {
    const ip = Array.from({ length: OTP_PER_IP_PER_HOUR }, (_, i) => ago(120_000 + i * 60_000));
    const r = decideOtpSend([], ip, now);
    expect(r).toMatchObject({ allowed: false, reason: "ip_hourly" });
  });
  it("envios de mais de 1 h atrás não contam", () => {
    const old = Array.from({ length: 10 }, (_, i) => ago(3_600_001 + i * 1000));
    expect(decideOtpSend(old, old, now)).toEqual({ allowed: true });
  });
});

describe("normalizeEmail", () => {
  it("normalizeEmail('  Dono@Ex.com ') === 'dono@ex.com'", () => {
    expect(normalizeEmail("  Dono@Ex.com ")).toBe("dono@ex.com");
  });
});
