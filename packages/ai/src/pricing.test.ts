import { describe, expect, it } from "vitest";
import { estimateCostUsdMicros, UnknownModelPriceError } from "./pricing";

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("custo estimado de IA", () => {
  it("calcula o Haiku em micro-dólares com valores conhecidos", () => {
    // 1 milhão de entrada = US$ 0,10 e 1 milhão de saída = US$ 0,50
    expect(estimateCostUsdMicros("claude-haiku-5-5", { ...usage, inputTokens: 1_000_000 })).toBe(
      100_000,
    );
    expect(estimateCostUsdMicros("claude-haiku-5-5", { ...usage, outputTokens: 1_000_000 })).toBe(
      500_000,
    );
  });

  it("calcula o Sonnet", () => {
    const cost = estimateCostUsdMicros("claude-sonnet-5-5", {
      ...usage,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(12_000_000);
  });

  it("leitura de cache custa um décimo e escrita 1,25 vez a entrada", () => {
    const read = estimateCostUsdMicros("claude-haiku-5-5", {
      ...usage,
      cacheReadTokens: 1_000_000,
    });
    const write = estimateCostUsdMicros("claude-haiku-5-5", {
      ...usage,
      cacheWriteTokens: 1_000_000,
    });
    expect(read).toBe(10_000);
    expect(write).toBe(125_000);
  });

  it("arredonda meio para cima na fração de micro-dólar", () => {
    // 5 tokens de entrada × 0,10 = 0,5 → 1; 4 tokens = 0,4 → 0
    expect(estimateCostUsdMicros("claude-haiku-5-5", { ...usage, inputTokens: 5 })).toBe(1);
    expect(estimateCostUsdMicros("claude-haiku-5-5", { ...usage, inputTokens: 4 })).toBe(0);
  });

  it("recusa modelo sem preço cadastrado em vez de gravar custo zero", () => {
    expect(() => estimateCostUsdMicros("claude-outro", usage)).toThrow(UnknownModelPriceError);
  });
});
