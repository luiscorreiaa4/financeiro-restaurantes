import { describe, expect, it } from "vitest";
import {
  SESSION_IDLE_HOURS,
  SESSION_KEEP_CONNECTED_DAYS,
  sessionExpiresAt,
  shouldTouchSession,
} from "./session-policy";

const now = new Date("2026-11-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("sessionExpiresAt (RF02.R5)", () => {
  it("sem 'manter conectado': vence 12 h depois do último uso", () => {
    expect(SESSION_IDLE_HOURS).toBe(12);
    expect(sessionExpiresAt({ keepConnected: false, now })).toEqual(
      new Date(now.getTime() + 12 * HOUR),
    );
  });

  it("com 'manter conectado': vence 30 dias depois do último uso", () => {
    expect(SESSION_KEEP_CONNECTED_DAYS).toBe(30);
    expect(sessionExpiresAt({ keepConnected: true, now })).toEqual(
      new Date(now.getTime() + 30 * 24 * HOUR),
    );
  });
});

describe("shouldTouchSession", () => {
  it("uso há menos de 5 min: não renova (evita escrita a cada requisição)", () => {
    const lastTouchedAt = new Date(now.getTime() - 4 * 60 * 1000 - 59_000);
    expect(shouldTouchSession({ lastTouchedAt, now })).toBe(false);
  });

  it("uso há 5 min ou mais: renova", () => {
    const lastTouchedAt = new Date(now.getTime() - 5 * 60 * 1000);
    expect(shouldTouchSession({ lastTouchedAt, now })).toBe(true);
  });
});
