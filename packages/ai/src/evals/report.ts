import type { Metrics } from "./score";

/**
 * Métricas que protegem a qualidade (RNF07.R4): se cair além da tolerância, a mudança de prompt,
 * modelo ou schema é bloqueada. Custo e latência são só informativos.
 */
export const GATED_METRICS = [
  "intentAccuracy",
  "entryExactRate",
  "valueAndTypeAccuracy",
  "askRecall",
  "outOfScopeRefusalRate",
] as const satisfies readonly (keyof Metrics)[];

/** Queda tolerada (em pontos de 0 a 1) por causa da variação natural do modelo. */
export const DEFAULT_TOLERANCE = 0.05;

export interface Regression {
  readonly metric: (typeof GATED_METRICS)[number];
  readonly baseline: number;
  readonly current: number;
}

export function compareToBaseline(
  current: Metrics,
  baseline: Metrics,
  tolerance: number = DEFAULT_TOLERANCE,
): { readonly ok: boolean; readonly regressions: readonly Regression[] } {
  const regressions: Regression[] = [];
  for (const metric of GATED_METRICS) {
    const before = baseline[metric];
    const now = current[metric];
    if (before === null || now === null) continue;
    if (now < before - tolerance - 1e-9)
      regressions.push({ metric, baseline: before, current: now });
  }
  return { ok: regressions.length === 0, regressions };
}

/** Meta do piloto (RNF07.R3): valor e tipo corretos em pelo menos 98%, lançamento exato em 90%. */
export const PILOT_TARGETS = { valueAndTypeAccuracy: 0.98, entryExactRate: 0.9 } as const;

export function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatMetrics(metrics: Metrics): string {
  const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(5)}`;
  return [
    `casos: ${metrics.cases} | saída inválida: ${pct(metrics.invalidRate)}`,
    `intenção: ${pct(metrics.intentAccuracy)} | lançamento exato: ${pct(metrics.entryExactRate)} (meta do piloto ${pct(PILOT_TARGETS.entryExactRate)})`,
    `valor e tipo: ${pct(metrics.valueAndTypeAccuracy)} (meta ${pct(PILOT_TARGETS.valueAndTypeAccuracy)}) | tipo: ${pct(metrics.typeAccuracy)} | valor: ${pct(metrics.amountAccuracy)}`,
    `data: ${pct(metrics.dateAccuracy)} | quantidade: ${pct(metrics.quantityAccuracy)} | categoria: ${pct(metrics.categoryAccuracy)} | fornecedor: ${pct(metrics.supplierAccuracy)} | pagamento: ${pct(metrics.paymentAccuracy)} | canal: ${pct(metrics.channelAccuracy)}`,
    `pergunta de volta: precisão ${pct(metrics.askPrecision)}, revocação ${pct(metrics.askRecall)} | recusa de fora de escopo: ${pct(metrics.outOfScopeRefusalRate)}`,
    `custo médio por mensagem: ${usd(metrics.avgCostUsdMicros)} | latência p50 ${metrics.latencyP50Ms} ms, p95 ${metrics.latencyP95Ms} ms`,
  ].join("\n");
}
