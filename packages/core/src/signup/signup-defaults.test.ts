import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATUSES,
  LEGAL_VERSIONS,
  REVENUE_RANGES,
  SEGMENTS,
  SIGNUP_DEFAULTS,
  TRIAL_DAYS,
} from "./signup-defaults";

describe("SIGNUP_DEFAULTS", () => {
  it("payment methods have zero fees", () => {
    for (const p of SIGNUP_DEFAULTS.paymentMethods) {
      expect(p.feePercentBp).toBe(0);
      expect(p.feeFixedCents).toBe(0);
    }
  });
  it("exactly one default card (Crédito)", () => {
    const cards = SIGNUP_DEFAULTS.paymentMethods.filter((p) => p.isDefaultCard);
    expect(cards.map((c) => c.name)).toEqual(["Crédito"]);
  });
  it("default sales channel exists in the list", () => {
    expect(SIGNUP_DEFAULTS.salesChannels.map((c) => c.name)).toContain(
      SIGNUP_DEFAULTS.defaultSalesChannelName,
    );
    expect(SIGNUP_DEFAULTS.defaultSalesChannelName).toBe("Salão");
  });
  it("names are unique", () => {
    for (const list of [SIGNUP_DEFAULTS.paymentMethods, SIGNUP_DEFAULTS.salesChannels]) {
      const names = list.map((i) => i.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it("keeps the not-informed records", () => {
    expect(SIGNUP_DEFAULTS.paymentMethods.map((p) => p.name)).toContain("Não informada");
    expect(SIGNUP_DEFAULTS.salesChannels.map((p) => p.name)).toContain("Não informado");
  });
  it("exposes constants", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(LEGAL_VERSIONS.terms).toBeTruthy();
    expect(SEGMENTS).toContain("food_truck");
    expect(REVENUE_RANGES).toContain("prefer_not_to_say");
  });
  it("account statuses follow RF01.R16 (ATIVA, SOMENTE_LEITURA, CANCELADA, ENCERRADA)", () => {
    expect(ACCOUNT_STATUSES).toEqual(["active", "read_only", "canceled", "closed"]);
  });
});
