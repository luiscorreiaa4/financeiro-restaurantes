import { describe, expect, it } from "vitest";
import { computeFee, NO_FEE } from "./fee";
import { type Money, money } from "./money";

const m = (cents: number): Money => {
  const result = money(cents);
  if (!result.ok) throw new Error(`centavos inválidos: ${cents}`);
  return result.value;
};

describe("taxa e líquido", () => {
  it("sem taxa, o líquido é o valor bruto", () => {
    expect(computeFee(m(10000), NO_FEE)).toEqual({
      ok: true,
      value: { feeCents: 0, netCents: 10000 },
    });
  });

  it("aplica a taxa percentual (cartão de crédito 3,20% sobre R$ 100,00)", () => {
    expect(computeFee(m(10000), { feePercentBp: 320, feeFixedCents: 0 })).toEqual({
      ok: true,
      value: { feeCents: 320, netCents: 9680 },
    });
  });

  it("soma a taxa fixa depois de arredondar a parte percentual", () => {
    // 3,20% de R$ 10,50 = 33,6 → 34 centavos; + R$ 0,30 fixos = 64
    expect(computeFee(m(1050), { feePercentBp: 320, feeFixedCents: 30 })).toEqual({
      ok: true,
      value: { feeCents: 64, netCents: 986 },
    });
  });

  it("arredonda a taxa meio para cima: 0,5 centavo vira 1", () => {
    expect(computeFee(m(50), { feePercentBp: 100, feeFixedCents: 0 })).toEqual({
      ok: true,
      value: { feeCents: 1, netCents: 49 },
    });
  });

  it("bruto sempre fecha com taxa mais líquido, ao centavo", () => {
    for (const amount of [1, 7, 99, 1050, 33333, 99999999]) {
      for (const bp of [0, 1, 199, 320, 499, 9999, 10000]) {
        const result = computeFee(m(amount), { feePercentBp: bp, feeFixedCents: 0 });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.feeCents + result.value.netCents).toBe(amount);
      }
    }
  });

  it("aceita taxa de 100% e deixa o líquido em zero", () => {
    expect(computeFee(m(1234), { feePercentBp: 10000, feeFixedCents: 0 })).toEqual({
      ok: true,
      value: { feeCents: 1234, netCents: 0 },
    });
  });

  it("valor zero com taxa percentual dá taxa e líquido zero", () => {
    expect(computeFee(m(0), { feePercentBp: 320, feeFixedCents: 0 })).toEqual({
      ok: true,
      value: { feeCents: 0, netCents: 0 },
    });
  });

  it("rejeita taxa maior que o valor em vez de gerar líquido negativo", () => {
    const result = computeFee(m(20), { feePercentBp: 0, feeFixedCents: 30 });
    expect(result).toEqual({
      ok: false,
      error: { code: "FeeExceedsAmount", feeCents: 30, amountCents: 20 },
    });
  });

  it("rejeita taxa percentual acima de 100% ou negativa", () => {
    expect(computeFee(m(100), { feePercentBp: 10001, feeFixedCents: 0 }).ok).toBe(false);
    expect(computeFee(m(100), { feePercentBp: -1, feeFixedCents: 0 }).ok).toBe(false);
  });

  it("rejeita taxa fixa negativa", () => {
    const result = computeFee(m(100), { feePercentBp: 0, feeFixedCents: -5 });
    expect(result.ok).toBe(false);
  });
});
