import { err, ok, type Result } from "../errors";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export const PASSWORD_MAX_FAILURES = 5;
export const PASSWORD_LOCK_MINUTES = 15;
export const OTP_RESEND_SECONDS = 60;
export const OTP_PER_EMAIL_PER_HOUR = 5;
export const OTP_PER_IP_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;

export type PasswordError = "too_short" | "too_long" | "needs_letter_and_digit" | "same_as_email";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validatePassword(input: {
  password: string;
  email: string;
}): Result<void, PasswordError> {
  const { password, email } = input;
  if (password.length < PASSWORD_MIN_LENGTH) return err("too_short");
  if (password.length > PASSWORD_MAX_LENGTH) return err("too_long");
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return err("needs_letter_and_digit");
  if (password.toLowerCase() === email.toLowerCase()) return err("same_as_email");
  return ok(undefined);
}

export type PasswordState = { failedAttempts: number; lockedUntil: Date | null };

export function decidePasswordAttempt(
  state: PasswordState,
  outcome: "ok" | "wrong",
  now: Date,
): { allowed: boolean; next: PasswordState } {
  if (state.lockedUntil && now.getTime() < state.lockedUntil.getTime()) {
    return { allowed: false, next: state };
  }
  // Bloqueio vencido: começa do zero.
  const failedAttempts = state.lockedUntil ? 0 : state.failedAttempts;
  if (outcome === "ok") {
    return { allowed: true, next: { failedAttempts: 0, lockedUntil: null } };
  }
  const failed = failedAttempts + 1;
  if (failed >= PASSWORD_MAX_FAILURES) {
    return {
      allowed: false,
      next: {
        failedAttempts: failed,
        lockedUntil: new Date(now.getTime() + PASSWORD_LOCK_MINUTES * 60 * 1000),
      },
    };
  }
  return { allowed: false, next: { failedAttempts: failed, lockedUntil: null } };
}

export type OtpSendDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "too_soon" | "email_hourly" | "ip_hourly";
      retryAfterSeconds: number;
    };

function recent(list: { sentAt: Date }[], now: Date): number[] {
  return list.map((s) => s.sentAt.getTime()).filter((t) => now.getTime() - t < HOUR_MS);
}

export function decideOtpSend(
  history: { sentAt: Date }[],
  byIp: { sentAt: Date }[],
  now: Date,
): OtpSendDecision {
  const emailTimes = recent(history, now);
  if (emailTimes.length > 0) {
    const elapsed = now.getTime() - Math.max(...emailTimes);
    if (elapsed < OTP_RESEND_SECONDS * 1000) {
      return {
        allowed: false,
        reason: "too_soon",
        retryAfterSeconds: Math.ceil((OTP_RESEND_SECONDS * 1000 - elapsed) / 1000),
      };
    }
  }
  const limited = (times: number[], max: number) =>
    times.length >= max ? Math.ceil((Math.min(...times) + HOUR_MS - now.getTime()) / 1000) : null;
  const emailRetry = limited(emailTimes, OTP_PER_EMAIL_PER_HOUR);
  if (emailRetry !== null)
    return { allowed: false, reason: "email_hourly", retryAfterSeconds: emailRetry };
  const ipRetry = limited(recent(byIp, now), OTP_PER_IP_PER_HOUR);
  if (ipRetry !== null) return { allowed: false, reason: "ip_hourly", retryAfterSeconds: ipRetry };
  return { allowed: true };
}
