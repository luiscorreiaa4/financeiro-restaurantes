import { describe, expect, it } from "vitest";
import { MAX_ENTRY_CENTS } from "../money/money";
import {
  averageTicketCents,
  breakEvenCents,
  changeOf,
  computeIndicators,
  DRE_GROUP_LABELS,
  dreGroupLabel,
  type PeriodSums,
  ratioPermille,
} from "./indicators";

const zeroSums: PeriodSums = {
  grossRevenueCents: 0,
  revenueWithOrdersCents: 0,
  ordersCount: 0,
  feesCents: 0,
  deductionExpensesCents: 0,
  operatingExpensesCents: 0,
  cmvCents: 0,
  payrollCents: 0,
  fixedCostsCents: 0,
  investmentsCents: 0,
  entryCount: 0,
};

describe("ratioPermille", () => {
  it("CA06: 600000 de 1000000 dá 600", () => {
    expect(ratioPermille(600000, 1000000)).toBe(600);
  });
  it("arredonda meio para longe do zero (-12,35% vira -124)", () => {
    expect(ratioPermille(-1235, 10000)).toBe(-124);
    expect(ratioPermille(1235, 10000)).toBe(124);
  });
  it("denominador zero ou negativo dá null", () => {
    expect(ratioPermille(1, 0)).toBeNull();
    expect(ratioPermille(1, -5)).toBeNull();
  });
  it("não perde precisão perto de MAX_ENTRY_CENTS x 1000", () => {
    const n = MAX_ENTRY_CENTS - 1;
    // n*1000/(n+1) = 1000 - 1000/(n+1): arredonda para 1000
    expect(ratioPermille(n, MAX_ENTRY_CENTS)).toBe(1000);
    // exato: 3*MAX*1000/(MAX) = 3000, sem erro de float
    expect(ratioPermille(MAX_ENTRY_CENTS * 3, MAX_ENTRY_CENTS)).toBe(3000);
    expect(ratioPermille(MAX_ENTRY_CENTS * 3 + 1, MAX_ENTRY_CENTS * 3)).toBe(1000);
    expect(ratioPermille(MAX_ENTRY_CENTS * 999 + 5_000_000_000, MAX_ENTRY_CENTS)).toBe(999500);
  });
  it("lança RangeError se o resultado não cabe em inteiro seguro", () => {
    expect(() => ratioPermille(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});

describe("averageTicketCents", () => {
  it("CA06: 600000 em 200 pedidos dá 3000", () => {
    expect(averageTicketCents(600000, 200)).toBe(3000);
  });
  it("sem pedidos dá null", () => {
    expect(averageTicketCents(600000, 0)).toBeNull();
  });
  it("arredonda meio para longe do zero", () => {
    expect(averageTicketCents(5, 2)).toBe(3);
    expect(averageTicketCents(-5, 2)).toBe(-3);
  });
});

describe("breakEvenCents", () => {
  it("CA07: 2000000, 3000000, 10000000 dá 2857143", () => {
    expect(breakEvenCents(2000000, 3000000, 10000000)).toBe(2857143);
  });
  it("bruta 0 ou margem de contribuição <= 0 dá null", () => {
    expect(breakEvenCents(100, 0, 0)).toBeNull();
    expect(breakEvenCents(100, 1000, 1000)).toBeNull();
    expect(breakEvenCents(100, 2000, 1000)).toBeNull();
  });
  it("arredonda meio para cima", () => {
    // 1*3/2 = 1,5 -> 2
    expect(breakEvenCents(1, 1, 3)).toBe(2);
  });
});

describe("computeIndicators", () => {
  it("CA04: bruta 0 dá razões, ticket e ponto de equilíbrio null, sem exceção", () => {
    const r = computeIndicators({ ...zeroSums, operatingExpensesCents: 5000, cmvCents: 100 });
    expect(r.grossRevenueCents).toBe(0);
    expect(r.marginPermille).toBeNull();
    expect(r.cmvRatioPermille).toBeNull();
    expect(r.payrollRatioPermille).toBeNull();
    expect(r.averageTicketCents).toBeNull();
    expect(r.ticketCoveragePermille).toBeNull();
    expect(r.breakEvenCents).toBeNull();
    expect(r.resultCents).toBe(-5000);
  });
  it("deduções = taxas + despesas de dedução", () => {
    const r = computeIndicators({
      ...zeroSums,
      grossRevenueCents: 1000000,
      feesCents: 30000,
      deductionExpensesCents: 70000,
    });
    expect(r.deductionsCents).toBe(100000);
    expect(r.netRevenueCents).toBe(900000);
  });
  it("CA03: investimento não muda o resultado", () => {
    const base = { ...zeroSums, grossRevenueCents: 1000000, operatingExpensesCents: 400000 };
    const a = computeIndicators(base);
    const b = computeIndicators({ ...base, investmentsCents: 320000 });
    expect(b.resultCents).toBe(a.resultCents);
    expect(b.investmentsCents).toBe(320000);
  });
  it("calcula resultado, razões, ticket e ponto de equilíbrio", () => {
    const r = computeIndicators({
      ...zeroSums,
      grossRevenueCents: 1000000,
      revenueWithOrdersCents: 600000,
      ordersCount: 200,
      feesCents: 20000,
      deductionExpensesCents: 30000,
      operatingExpensesCents: 700000,
      cmvCents: 300000,
      payrollCents: 200000,
      fixedCostsCents: 250000,
      entryCount: 10,
    });
    expect(r.deductionsCents).toBe(50000);
    expect(r.netRevenueCents).toBe(950000);
    expect(r.resultCents).toBe(250000);
    expect(r.marginPermille).toBe(250);
    expect(r.cmvRatioPermille).toBe(300);
    expect(r.payrollRatioPermille).toBe(200);
    expect(r.averageTicketCents).toBe(3000);
    expect(r.ticketCoveragePermille).toBe(600);
    // variável = (700000-250000)+50000 = 500000; PE = 250000*1e6/(1e6-5e5) = 500000
    expect(r.breakEvenCents).toBe(500000);
  });
  it("resultado negativo dá margem negativa", () => {
    const r = computeIndicators({
      ...zeroSums,
      grossRevenueCents: 10000,
      operatingExpensesCents: 11235,
    });
    expect(r.resultCents).toBe(-1235);
    expect(r.marginPermille).toBe(-124);
  });
});

describe("changeOf", () => {
  it("money: 110 vs 100 dá 100 e up", () => {
    expect(changeOf(110, 100, "money")).toEqual({ changePermille: 100, direction: "up" });
  });
  it("money: anterior negativo usa |anterior|", () => {
    expect(changeOf(5, -10, "money")).toEqual({ changePermille: 1500, direction: "up" });
  });
  it("money: anterior 0 não tem percentual", () => {
    expect(changeOf(100, 0, "money").changePermille).toBeNull();
    expect(changeOf(50, 0, "money")).toEqual({ changePermille: null, direction: "up" });
    expect(changeOf(0, 0, "money")).toEqual({ changePermille: null, direction: "flat" });
    expect(changeOf(-5, 0, "money")).toEqual({ changePermille: null, direction: "down" });
  });
  it("permille: diferença simples", () => {
    expect(changeOf(123, 150, "permille")).toEqual({ changePermille: -27, direction: "down" });
    expect(changeOf(10, 0, "permille")).toEqual({ changePermille: 10, direction: "up" });
  });
  it("lado null dá tudo null", () => {
    expect(changeOf(null, 100, "money")).toEqual({ changePermille: null, direction: null });
    expect(changeOf(100, null, "permille")).toEqual({ changePermille: null, direction: null });
  });
});

describe("rótulos do DRE", () => {
  it("traduz grupos conhecidos e cai em Outros", () => {
    expect(dreGroupLabel("cmv")).toBe("CMV");
    expect(dreGroupLabel("ocupacao")).toBe("Ocupação");
    expect(dreGroupLabel("outras")).toBe("Outras despesas");
    expect(dreGroupLabel("xyz")).toBe("Outros");
    expect(Object.keys(DRE_GROUP_LABELS)).toHaveLength(10);
  });
});

describe("magnitude e bordas (revisão da T4)", () => {
  it("ratioPermille com numerador × 1000 acima de 2^53 acerta o meio para longe do zero", () => {
    expect(ratioPermille(8_999_000_000_000_000, 2_000_000_000_000_000)).toBe(4500);
    expect(ratioPermille(-8_999_000_000_000_000, 2_000_000_000_000_000)).toBe(-4500);
  });

  it("averageTicketCents arredonda o meio para longe do zero em magnitude grande", () => {
    expect(averageTicketCents(9_007_199_254_740_991, 2)).toBe(4_503_599_627_370_496);
  });

  it("breakEvenCents com fixos e receita na casa de 1e10 não perde precisão", () => {
    expect(breakEvenCents(10_000_000_000, 0, 10_000_000_000)).toBe(10_000_000_000);
    // 1e12 × 1e12 / (1e12 − 5e11) = 2e12, exato só com BigInt
    expect(breakEvenCents(1_000_000_000_000, 500_000_000_000, 1_000_000_000_000)).toBe(
      2_000_000_000_000,
    );
  });

  it("changeOf com anterior negativo e atual menor indica queda", () => {
    expect(changeOf(-20, -10, "money")).toEqual({ changePermille: -1000, direction: "down" });
  });

  it("changeOf em dinheiro com anterior nulo não tem variação nem direção", () => {
    expect(changeOf(10, null, "money")).toEqual({ changePermille: null, direction: null });
  });

  it("dreGroupLabel não herda propriedades de Object", () => {
    expect(dreGroupLabel("constructor")).toBe("Outros");
  });
});
