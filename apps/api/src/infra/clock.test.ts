import { describe, expect, it } from "vitest";
import { businessDateOf, createFixedClock } from "./clock";

describe("data de negócio no fuso de São Paulo", () => {
  it("usa o dia local, não o dia UTC, de madrugada em UTC", () => {
    // 01:30 UTC de 31/10 ainda é 22:30 de 30/10 em São Paulo (UTC-3).
    expect(businessDateOf(new Date("2026-10-31T01:30:00Z"))).toBe("2026-10-30");
  });

  it("vira o dia às 00:00 locais", () => {
    expect(businessDateOf(new Date("2026-10-31T03:00:00Z"))).toBe("2026-10-31");
  });

  it("aceita outro fuso", () => {
    expect(businessDateOf(new Date("2026-10-31T01:30:00Z"), "UTC")).toBe("2026-10-31");
  });

  it("o relógio fixo move o tempo só quando mandam", () => {
    const clock = createFixedClock(new Date("2026-10-30T15:00:00Z"));
    expect(clock.today()).toBe("2026-10-30");
    clock.set(new Date("2026-10-31T15:00:00Z"));
    expect(clock.today()).toBe("2026-10-31");
  });
});
