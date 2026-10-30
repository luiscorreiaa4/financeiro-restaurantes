import type { ExtractedEntry, ExtractionResult } from "@app/core";
import { describe, expect, it } from "vitest";
import { CASE_CATEGORIES, type EvalCase, loadDataset, parseDataset } from "./dataset";
import { compareToBaseline, GATED_METRICS } from "./report";
import { aggregate, type Metrics, observe, percentile, scoreCase } from "./score";

const entry = (overrides: Partial<ExtractedEntry> = {}): ExtractedEntry => ({
  type: "expense",
  description: "Camarão",
  occurred_on: null,
  quantity: null,
  quantity_unit: null,
  unit_price_cents: null,
  total_cents: 45000,
  category_hint: null,
  supplier_hint: null,
  payment_method_hint: null,
  sales_channel_hint: null,
  missing_fields: [],
  ...overrides,
});
const register = (entries: ExtractedEntry[], question: string | null = null): ExtractionResult => ({
  intent: "register",
  entries,
  question,
});

const evalCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  id: "x",
  category: "easy",
  text: "camarão 450 no pix",
  expected: {
    intent: "register",
    ready: [{ type: "expense", amount_cents: 45000, payment: "Pix" }],
    asks: false,
  },
  ...overrides,
});
const META = { costUsdMicros: 100, latencyMs: 200 };

describe("dataset de avaliação", () => {
  const cases = loadDataset();

  it("tem 30 casos ou mais, com as categorias previstas e ids únicos", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const category of CASE_CATEGORIES) {
      expect(cases.some((item) => item.category === category)).toBe(true);
    }
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it("todo caso fora do escopo não espera lançamento nem pergunta", () => {
    for (const item of cases.filter((c) => c.expected.intent === "out_of_scope")) {
      expect(item.expected.ready).toEqual([]);
      expect(item.expected.asks).toBe(false);
    }
  });

  it("rejeita linha inválida e id repetido", () => {
    expect(() => parseDataset('{"id":"a","category":"easy","text":"x"}')).toThrow(/caso 1/);
    const line = JSON.stringify({
      id: "a",
      category: "easy",
      text: "x",
      expected: { intent: "out_of_scope" },
    });
    expect(() => parseDataset(`${line}\n${line}`)).toThrow(/repetido/);
  });

  it("ignora comentários e linhas em branco", () => {
    expect(parseDataset("# comentário\n\n")).toEqual([]);
  });
});

describe("pontuação por campo e por lançamento", () => {
  it("lançamento todo certo é exato", () => {
    const observed = observe(register([entry({ payment_method_hint: "pix" })]));
    const score = scoreCase(evalCase(), observed, META);
    expect(score.entries[0]).toMatchObject({
      typeOk: true,
      amountOk: true,
      paymentOk: true,
      exact: true,
    });
    expect(score).toMatchObject({ intentOk: true, askOk: true, countOk: true });
  });

  it("valor errado derruba o lançamento exato e só o campo do valor", () => {
    const observed = observe(register([entry({ total_cents: 40000, payment_method_hint: "Pix" })]));
    const score = scoreCase(evalCase(), observed, META);
    expect(score.entries[0]).toMatchObject({
      typeOk: true,
      amountOk: false,
      paymentOk: true,
      exact: false,
    });
  });

  it("o valor é o que o sistema calcula, não o que a IA somou", () => {
    const expected = evalCase({
      expected: {
        intent: "register",
        ready: [{ type: "expense", amount_cents: 6000 }],
        asks: false,
      },
    });
    const observed = observe(
      register([entry({ total_cents: null, quantity: 10, unit_price_cents: 600 })]),
    );
    expect(scoreCase(expected, observed, META).entries[0]?.amountOk).toBe(true);
  });

  it("a data ausente vale hoje e a data errada é apontada", () => {
    const yesterday = evalCase({
      expected: {
        intent: "register",
        ready: [{ type: "expense", amount_cents: 45000, occurred_on: "2026-10-29" }],
        asks: false,
      },
    });
    expect(
      scoreCase(yesterday, observe(register([entry({ occurred_on: "2026-10-29" })])), META)
        .entries[0]?.dateOk,
    ).toBe(true);
    expect(scoreCase(yesterday, observe(register([entry()])), META).entries[0]?.dateOk).toBe(false);
  });

  it("compara nomes sem diferenciar acento nem caixa, e só pontua o que o caso traz", () => {
    const expected = evalCase({
      expected: {
        intent: "register",
        ready: [{ type: "revenue", amount_cents: 90000, channel: "Salão" }],
        asks: false,
      },
    });
    const observed = observe(
      register([entry({ type: "revenue", total_cents: 90000, sales_channel_hint: "SALAO" })]),
    );
    const score = scoreCase(expected, observed, META);
    expect(score.entries[0]).toMatchObject({
      channelOk: true,
      paymentOk: null,
      categoryOk: null,
      exact: true,
    });
  });

  it("lançamento que faltou conta como errado em todos os campos", () => {
    const observed = observe(register([entry()]));
    const two = evalCase({
      expected: {
        intent: "register",
        ready: [
          { type: "expense", amount_cents: 45000 },
          { type: "expense", amount_cents: 1000 },
        ],
        asks: false,
      },
    });
    const score = scoreCase(two, observed, META);
    expect(score.countOk).toBe(false);
    expect(score.entries[1]).toMatchObject({ typeOk: false, amountOk: false, exact: false });
  });

  it("pergunta quando devia perguntar: lançamento sem valor", () => {
    const expected = evalCase({
      expected: { intent: "register", ready: [], asks: true },
    });
    const observed = observe(
      register([entry({ total_cents: null, missing_fields: ["amount"] })], "Qual o valor?"),
    );
    expect(scoreCase(expected, observed, META)).toMatchObject({ askOk: true, intentOk: true });
  });

  it("extração que falhou conta como inválida e erra a intenção", () => {
    const score = scoreCase(evalCase(), null, META);
    expect(score).toMatchObject({ failed: true, intentOk: false, askOk: false });
  });
});

describe("métricas agregadas", () => {
  const cases: EvalCase[] = [
    evalCase({ id: "a" }),
    evalCase({ id: "b", expected: { intent: "out_of_scope", ready: [], asks: false } }),
    evalCase({ id: "c", expected: { intent: "register", ready: [], asks: true } }),
  ];
  const expectedBy = new Map(cases.map((item) => [item.id, item.expected]));

  it("calcula acerto, recusa de fora de escopo e precisão e revocação da pergunta", () => {
    const good = scoreCase(
      cases[0] as EvalCase,
      observe(register([entry({ payment_method_hint: "Pix" })])),
      META,
    );
    const refused = scoreCase(
      cases[1] as EvalCase,
      observe({ intent: "out_of_scope", entries: [], question: null }),
      META,
    );
    // Devia perguntar e não perguntou: erro de revocação.
    const missedQuestion = scoreCase(cases[2] as EvalCase, observe(register([entry()])), META);
    const metrics = aggregate([good, refused, missedQuestion], expectedBy);

    expect(metrics.cases).toBe(3);
    expect(metrics.outOfScopeRefusalRate).toBe(1);
    expect(metrics.askRecall).toBe(0);
    expect(metrics.askPrecision).toBeNull();
    expect(metrics.entryExactRate).toBe(1);
    expect(metrics.valueAndTypeAccuracy).toBe(1);
    expect(metrics.avgCostUsdMicros).toBe(100);
  });

  it("percentil por posição mais próxima", () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(200);
    expect(percentile([100, 200, 300, 400], 95)).toBe(400);
    expect(percentile([], 50)).toBe(0);
  });
});

describe("proteção contra piora (RNF07.R4)", () => {
  const base: Metrics = {
    cases: 37,
    invalidRate: 0,
    intentAccuracy: 0.95,
    entryExactRate: 0.9,
    typeAccuracy: 1,
    amountAccuracy: 0.98,
    valueAndTypeAccuracy: 0.98,
    dateAccuracy: 1,
    quantityAccuracy: 1,
    categoryAccuracy: 0.8,
    supplierAccuracy: 1,
    paymentAccuracy: 1,
    channelAccuracy: 1,
    askPrecision: 0.8,
    askRecall: 0.8,
    outOfScopeRefusalRate: 1,
    avgCostUsdMicros: 400,
    latencyP50Ms: 1500,
    latencyP95Ms: 3000,
  };

  it("aceita variação dentro da tolerância", () => {
    expect(compareToBaseline({ ...base, entryExactRate: 0.86 }, base)).toEqual({
      ok: true,
      regressions: [],
    });
  });

  it("bloqueia queda de acerto de valor e tipo além da tolerância (CA01)", () => {
    const result = compareToBaseline({ ...base, valueAndTypeAccuracy: 0.9 }, base);
    expect(result.ok).toBe(false);
    expect(result.regressions).toEqual([
      { metric: "valueAndTypeAccuracy", baseline: 0.98, current: 0.9 },
    ]);
  });

  it("não acusa piora de custo nem de latência, que não são protegidos", () => {
    expect(
      compareToBaseline({ ...base, avgCostUsdMicros: 4000, latencyP95Ms: 30000 }, base).ok,
    ).toBe(true);
    expect(GATED_METRICS).not.toContain("avgCostUsdMicros");
  });

  it("ignora métrica sem amostra em um dos lados", () => {
    expect(compareToBaseline({ ...base, askRecall: null }, base).ok).toBe(true);
  });
});
