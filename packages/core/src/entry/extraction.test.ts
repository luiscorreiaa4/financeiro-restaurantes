import { describe, expect, it } from "vitest";
import { type ExtractedEntry, ExtractionResultSchema } from "./extraction";
import { resolveAmount } from "./resolve-amount";

const extracted = (overrides: Partial<ExtractedEntry> = {}): ExtractedEntry => ({
  type: "expense",
  description: "Carne",
  occurred_on: null,
  quantity: null,
  quantity_unit: null,
  unit_price_cents: null,
  total_cents: null,
  category_hint: null,
  supplier_hint: null,
  payment_method_hint: null,
  sales_channel_hint: null,
  missing_fields: [],
  ...overrides,
});

const result = (overrides: Record<string, unknown> = {}) => ({
  intent: "register",
  entries: [extracted({ total_cents: 15000 })],
  question: null,
  ...overrides,
});

describe("schema ExtractionResult", () => {
  it("aceita um registro completo", () => {
    expect(ExtractionResultSchema.safeParse(result()).success).toBe(true);
  });

  it("aceita vários lançamentos em uma mensagem", () => {
    const parsed = ExtractionResultSchema.safeParse(
      result({ entries: [extracted({ total_cents: 100 }), extracted({ total_cents: 200 })] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("aceita registro com valor faltando quando traz pergunta e campo faltante", () => {
    const parsed = ExtractionResultSchema.safeParse(
      result({
        entries: [extracted({ missing_fields: ["amount"] })],
        question: "Qual foi o valor?",
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("aceita lançamentos completos junto de um incompleto, com uma única pergunta", () => {
    const parsed = ExtractionResultSchema.safeParse(
      result({
        entries: [extracted({ total_cents: 18000 }), extracted({ missing_fields: ["amount"] })],
        question: "Qual foi o valor do camarão?",
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("aceita fora de escopo sem lançamentos", () => {
    const parsed = ExtractionResultSchema.safeParse(
      result({ intent: "out_of_scope", entries: [] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("aceita intenção pouco clara com pergunta", () => {
    const parsed = ExtractionResultSchema.safeParse(
      result({ intent: "unclear", entries: [], question: "Pode explicar melhor?" }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejeita registro sem lançamentos", () => {
    expect(ExtractionResultSchema.safeParse(result({ entries: [] })).success).toBe(false);
  });

  it("rejeita lançamentos em fora de escopo ou intenção pouco clara", () => {
    expect(ExtractionResultSchema.safeParse(result({ intent: "out_of_scope" })).success).toBe(
      false,
    );
    expect(
      ExtractionResultSchema.safeParse(result({ intent: "unclear", question: "?" })).success,
    ).toBe(false);
  });

  it("rejeita intenção pouco clara sem pergunta", () => {
    const parsed = ExtractionResultSchema.safeParse(result({ intent: "unclear", entries: [] }));
    expect(parsed.success).toBe(false);
  });

  it("rejeita campos faltantes sem pergunta e pergunta sem campos faltantes", () => {
    expect(
      ExtractionResultSchema.safeParse(
        result({ entries: [extracted({ total_cents: 1, missing_fields: ["amount"] })] }),
      ).success,
    ).toBe(false);
    expect(ExtractionResultSchema.safeParse(result({ question: "Qual valor?" })).success).toBe(
      false,
    );
  });

  it("rejeita intenção desconhecida, tipo inválido e data inexistente", () => {
    expect(ExtractionResultSchema.safeParse(result({ intent: "chat" })).success).toBe(false);
    expect(
      ExtractionResultSchema.safeParse(
        result({ entries: [{ ...extracted({ total_cents: 1 }), type: "transfer" }] }),
      ).success,
    ).toBe(false);
    expect(
      ExtractionResultSchema.safeParse(
        result({ entries: [extracted({ total_cents: 1, occurred_on: "2026-02-30" })] }),
      ).success,
    ).toBe(false);
  });

  it("rejeita total com casas decimais (a IA deve devolver centavos inteiros)", () => {
    const parsed = ExtractionResultSchema.safeParse(
      result({ entries: [extracted({ total_cents: 150.5 })] }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("valor do lançamento extraído (o sistema valida e calcula)", () => {
  it("usa o total quando só ele vem", () => {
    expect(resolveAmount(extracted({ total_cents: 15000 }))).toEqual({ ok: true, value: 15000 });
  });

  it("calcula quantidade × preço unitário quando não há total", () => {
    // 2,5 kg a R$ 18,90 = R$ 47,25
    const entry = extracted({ quantity: 2.5, unit_price_cents: 1890 });
    expect(resolveAmount(entry)).toEqual({ ok: true, value: 4725 });
  });

  it("arredonda a conta meio para cima", () => {
    // 0,333 kg a R$ 1,50 = 49,95 centavos → 50
    const entry = extracted({ quantity: 0.333, unit_price_cents: 150 });
    expect(resolveAmount(entry)).toEqual({ ok: true, value: 50 });
  });

  it("aceita total consistente com quantidade × preço", () => {
    const entry = extracted({ quantity: 10, unit_price_cents: 3800, total_cents: 38000 });
    expect(resolveAmount(entry)).toEqual({ ok: true, value: 38000 });
  });

  it("tolera 1 centavo de diferença de arredondamento e vale o total informado", () => {
    const entry = extracted({ quantity: 3, unit_price_cents: 333, total_cents: 1000 });
    expect(resolveAmount(entry)).toEqual({ ok: true, value: 1000 });
  });

  it("recusa total que contradiz quantidade × preço", () => {
    const entry = extracted({ quantity: 10, unit_price_cents: 3800, total_cents: 30000 });
    expect(resolveAmount(entry)).toEqual({
      ok: false,
      error: { code: "AmountInconsistent", computedCents: 38000, statedCents: 30000 },
    });
  });

  it("avisa valor ausente", () => {
    expect(resolveAmount(extracted())).toEqual({ ok: false, error: { code: "AmountMissing" } });
    expect(resolveAmount(extracted({ quantity: 2 }))).toEqual({
      ok: false,
      error: { code: "AmountMissing" },
    });
  });

  it("rejeita valor zero e negativo", () => {
    expect(resolveAmount(extracted({ total_cents: 0 }))).toEqual({
      ok: false,
      error: { code: "AmountNotPositive" },
    });
    expect(resolveAmount(extracted({ total_cents: -100 })).ok).toBe(false);
  });

  it("rejeita quantidade inválida", () => {
    const entry = extracted({ quantity: -2, unit_price_cents: 100 });
    expect(resolveAmount(entry).ok).toBe(false);
  });
});
