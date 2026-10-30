import type { AiUsageRecord } from "@app/core";

/**
 * Tabela de preços versionada (RNF08): o único lugar com valores em dinheiro de IA.
 * Unidade: micro-dólares por milhão de tokens (US$ 1,00/MTok = 1.000.000), então
 * `tokens × preço ÷ 1.000.000` já dá micro-dólares. Fonte: skill claude-api, cache de 06/10/2026.
 * Cache: leitura a 0,1× e escrita (TTL de 5 min) a 1,25× do preço de entrada ⚠️ conferir na
 * página de preços ao mudar de modelo. Prompts acima de 100K tokens no Haiku custam mais: não
 * ocorre na extração (prompt de poucos milhares de tokens).
 */
export const PRICING_VERSION = "2026-10-06";

interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-5-5": { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite: 125_000 },
  "claude-sonnet-5-5": {
    input: 2_000_000,
    output: 10_000_000,
    cacheRead: 200_000,
    cacheWrite: 2_500_000,
  },
};

/**
 * Transcrição: US$ 0,006 por minuto = 100 micro-dólares por segundo. ⚠️ Fonte secundária e do
 * `gpt-4o-transcribe`; o preço do `gpt-transcribe` (modelo padrão) não foi confirmado: estimativa
 * provisória, conferir na página de preços da OpenAI.
 */
export const TRANSCRIPTION_USD_MICROS_PER_SECOND = 100;

export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    super(`modelo sem preço cadastrado em pricing.ts: ${model}`);
    this.name = "UnknownModelPriceError";
  }
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** Custo estimado em micro-dólares inteiros, arredondado meio para cima (bigint, sem float). */
export function estimateCostUsdMicros(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[model];
  if (price === undefined) throw new UnknownModelPriceError(model);
  const total =
    BigInt(usage.inputTokens) * BigInt(price.input) +
    BigInt(usage.outputTokens) * BigInt(price.output) +
    BigInt(usage.cacheReadTokens) * BigInt(price.cacheRead) +
    BigInt(usage.cacheWriteTokens) * BigInt(price.cacheWrite);
  return Number((total + 500_000n) / 1_000_000n);
}

export function llmUsageRecord(model: string, usage: TokenUsage): AiUsageRecord {
  return {
    provider: "anthropic",
    model,
    ...usage,
    audioSeconds: 0,
    costUsdMicros: estimateCostUsdMicros(model, usage),
  };
}
