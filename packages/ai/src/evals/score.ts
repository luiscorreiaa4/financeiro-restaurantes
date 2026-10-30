import {
  type ExtractedEntry,
  type ExtractionResult,
  interpretExtraction,
  normalizeName,
  type ReadyEntry,
} from "@app/core";
import { EVAL_TODAY, type EvalCase, type ExpectedEntry } from "./dataset";

/** O que o sistema "vê" depois das regras do RF12 (valor, data e perguntas são do sistema). */
export interface Observed {
  readonly intent: "register" | "out_of_scope" | "unclear";
  readonly ready: readonly ReadyEntry[];
  /** O sistema perguntaria algo ao usuário. */
  readonly asks: boolean;
}

export function observe(result: ExtractionResult, today: string = EVAL_TODAY): Observed {
  const interpretation = interpretExtraction(result, today);
  switch (interpretation.kind) {
    case "out_of_scope":
      return { intent: "out_of_scope", ready: [], asks: false };
    case "unclear":
      return { intent: "unclear", ready: [], asks: true };
    case "register":
      return {
        intent: "register",
        ready: interpretation.ready,
        asks: interpretation.pending.length > 0,
      };
  }
}

export interface EntryScore {
  readonly typeOk: boolean;
  readonly amountOk: boolean;
  readonly dateOk: boolean;
  readonly quantityOk: boolean | null;
  readonly categoryOk: boolean | null;
  readonly supplierOk: boolean | null;
  readonly paymentOk: boolean | null;
  readonly channelOk: boolean | null;
  /** Acerto exato: todos os campos pontuados do lançamento certos. */
  readonly exact: boolean;
}

export interface CaseScore {
  readonly id: string;
  readonly category: EvalCase["category"];
  /** A extração falhou (saída inválida ou recusa): nada foi gravado. */
  readonly failed: boolean;
  readonly intentOk: boolean;
  readonly askOk: boolean;
  readonly expectedAsks: boolean;
  readonly observedAsks: boolean;
  readonly countOk: boolean;
  readonly entries: readonly EntryScore[];
  readonly costUsdMicros: number;
  readonly latencyMs: number;
}

const same = (a: string | null, b: string) => a !== null && normalizeName(a) === normalizeName(b);

function scoreEntry(expected: ExpectedEntry, observed: ReadyEntry | undefined): EntryScore {
  const hint = (field: keyof ExtractedEntry, wanted: string | undefined): boolean | null =>
    wanted === undefined
      ? null
      : observed !== undefined && same(observed.extracted[field] as string | null, wanted);
  const typeOk = observed?.extracted.type === expected.type;
  const amountOk = observed?.amountCents === expected.amount_cents;
  const dateOk = observed?.occurredOn === (expected.occurred_on ?? EVAL_TODAY);
  const quantityOk =
    expected.quantity === undefined ? null : observed?.extracted.quantity === expected.quantity;
  const categoryOk = hint("category_hint", expected.category);
  const supplierOk = hint("supplier_hint", expected.supplier);
  const paymentOk = hint("payment_method_hint", expected.payment);
  const channelOk = hint("sales_channel_hint", expected.channel);
  const checks = [
    typeOk,
    amountOk,
    dateOk,
    quantityOk,
    categoryOk,
    supplierOk,
    paymentOk,
    channelOk,
  ];
  return {
    typeOk,
    amountOk,
    dateOk,
    quantityOk,
    categoryOk,
    supplierOk,
    paymentOk,
    channelOk,
    exact: checks.every((check) => check !== false),
  };
}

/** `observed` nulo = a extração falhou. */
export function scoreCase(
  evalCase: EvalCase,
  observed: Observed | null,
  meta: { costUsdMicros: number; latencyMs: number },
): CaseScore {
  const { expected } = evalCase;
  const ready = observed?.ready ?? [];
  return {
    id: evalCase.id,
    category: evalCase.category,
    failed: observed === null,
    intentOk: observed?.intent === expected.intent,
    askOk: observed !== null && observed.asks === expected.asks,
    expectedAsks: expected.asks,
    observedAsks: observed?.asks ?? false,
    countOk: ready.length === expected.ready.length,
    entries: expected.ready.map((entry, index) => scoreEntry(entry, ready[index])),
    costUsdMicros: meta.costUsdMicros,
    latencyMs: meta.latencyMs,
  };
}

/** Métricas de 0 a 1; nulo quando não há amostra para calcular. */
export interface Metrics {
  readonly cases: number;
  readonly invalidRate: number;
  readonly intentAccuracy: number | null;
  readonly entryExactRate: number | null;
  readonly typeAccuracy: number | null;
  readonly amountAccuracy: number | null;
  /** Meta do piloto (RNF07.R3): valor e tipo corretos. */
  readonly valueAndTypeAccuracy: number | null;
  readonly dateAccuracy: number | null;
  readonly quantityAccuracy: number | null;
  readonly categoryAccuracy: number | null;
  readonly supplierAccuracy: number | null;
  readonly paymentAccuracy: number | null;
  readonly channelAccuracy: number | null;
  readonly askPrecision: number | null;
  readonly askRecall: number | null;
  readonly outOfScopeRefusalRate: number | null;
  readonly avgCostUsdMicros: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
}

const rate = (values: readonly (boolean | null)[]): number | null => {
  const sample = values.filter((value): value is boolean => value !== null);
  return sample.length === 0 ? null : sample.filter(Boolean).length / sample.length;
};

/** Percentil por posição mais próxima (sem interpolar). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function aggregate(
  scores: readonly CaseScore[],
  expectedByCase: ReadonlyMap<string, EvalCase["expected"]>,
): Metrics {
  const entries = scores.flatMap((score) => score.entries);
  const askedWhenShould = scores.filter((score) => score.expectedAsks);
  const asked = scores.filter((score) => score.observedAsks);
  const outOfScope = scores.filter(
    (score) => expectedByCase.get(score.id)?.intent === "out_of_scope",
  );
  return {
    cases: scores.length,
    invalidRate:
      scores.length === 0 ? 0 : scores.filter((score) => score.failed).length / scores.length,
    intentAccuracy: rate(scores.map((score) => score.intentOk)),
    entryExactRate: rate(entries.map((entry) => entry.exact)),
    typeAccuracy: rate(entries.map((entry) => entry.typeOk)),
    amountAccuracy: rate(entries.map((entry) => entry.amountOk)),
    valueAndTypeAccuracy: rate(entries.map((entry) => entry.typeOk && entry.amountOk)),
    dateAccuracy: rate(entries.map((entry) => entry.dateOk)),
    quantityAccuracy: rate(entries.map((entry) => entry.quantityOk)),
    categoryAccuracy: rate(entries.map((entry) => entry.categoryOk)),
    supplierAccuracy: rate(entries.map((entry) => entry.supplierOk)),
    paymentAccuracy: rate(entries.map((entry) => entry.paymentOk)),
    channelAccuracy: rate(entries.map((entry) => entry.channelOk)),
    // Precisão: das vezes que perguntou, quantas deviam. Revocação: das que deviam, quantas perguntou.
    askPrecision: rate(asked.map((score) => score.expectedAsks)),
    askRecall: rate(askedWhenShould.map((score) => score.observedAsks)),
    outOfScopeRefusalRate: rate(outOfScope.map((score) => score.intentOk)),
    avgCostUsdMicros:
      scores.length === 0
        ? 0
        : Math.round(scores.reduce((sum, score) => sum + score.costUsdMicros, 0) / scores.length),
    latencyP50Ms: percentile(
      scores.map((score) => score.latencyMs),
      50,
    ),
    latencyP95Ms: percentile(
      scores.map((score) => score.latencyMs),
      95,
    ),
  };
}
