import type { ExtractionResult, TenantExtractionContext } from "@app/core";
import { describe, expect, it } from "vitest";
import { createFakeLlmClient } from "../testing";
import { createClaudeEntryExtractor, LONG_MESSAGE_CHARS } from "./claude-entry-extractor";

const MODELS = { default: "claude-haiku-5-5", advanced: "claude-sonnet-5-5" };
const CONTEXT: TenantExtractionContext = {
  categories: ["Carnes", "Bebidas"],
  suppliers: ["Atacadão"],
  units: ["Centro"],
  paymentMethods: ["Pix", "Crédito"],
};

const valid: ExtractionResult = {
  intent: "register",
  entries: [
    {
      type: "expense",
      description: "Camarão",
      occurred_on: null,
      quantity: 5,
      quantity_unit: "kg",
      unit_price_cents: null,
      total_cents: 45000,
      category_hint: null,
      supplier_hint: null,
      payment_method_hint: "pix",
      sales_channel_hint: null,
      missing_fields: [],
    },
  ],
  question: null,
};
const unclear: ExtractionResult = { intent: "unclear", entries: [], question: "O que foi?" };

const run = (llm: ReturnType<typeof createFakeLlmClient>, text = "camarão 5kg 450 no pix") =>
  createClaudeEntryExtractor({ llm, models: MODELS }).extract({
    text,
    context: CONTEXT,
    today: "2026-10-30",
  });

describe("extrator Claude (E6)", () => {
  it("usa o modelo barato e registra o uso com custo em micro-dólares", async () => {
    const llm = createFakeLlmClient([{ json: valid }]);
    const outcome = await run(llm);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.result).toEqual(valid);
    expect(llm.requests.map((request) => request.model)).toEqual(["claude-haiku-5-5"]);
    // 1000 entrada × 0,10 + 200 saída × 0,50 = 200 micro-dólares
    expect(outcome.value.usage).toMatchObject([{ model: "claude-haiku-5-5", costUsdMicros: 200 }]);
  });

  it("começa direto no modelo avançado quando a mensagem é longa", async () => {
    const llm = createFakeLlmClient([{ json: valid }]);
    await run(llm, "a".repeat(LONG_MESSAGE_CHARS + 1));
    expect(llm.requests[0]?.model).toBe("claude-sonnet-5-5");
  });

  it("sobe para o modelo avançado quando a saída é inválida e manda o erro na nova tentativa", async () => {
    const llm = createFakeLlmClient([{ text: "isso não é json" }, { json: valid }]);
    const outcome = await run(llm);
    expect(outcome.ok).toBe(true);
    expect(llm.requests.map((request) => request.model)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ]);
    const retry = llm.requests[1]?.messages ?? [];
    expect(retry.at(-1)?.text).toContain("json_invalido");
    if (outcome.ok) expect(outcome.value.usage).toHaveLength(2);
  });

  it("falha com ExtractionInvalid quando a saída é inválida duas vezes (CA09)", async () => {
    const llm = createFakeLlmClient([
      { json: { intent: "register", entries: [], question: null } },
      { text: "{}" },
    ]);
    const outcome = await run(llm);
    expect(outcome).toMatchObject({ ok: false, error: { code: "ExtractionInvalid" } });
    expect(llm.requests).toHaveLength(2);
  });

  it("trata corte por max_tokens como saída inválida", async () => {
    const llm = createFakeLlmClient([
      { stopReason: "max_tokens", text: '{"intent"' },
      { json: valid },
    ]);
    const outcome = await run(llm);
    expect(outcome.ok).toBe(true);
    expect(llm.requests[1]?.messages.at(-1)?.text).toContain("max_tokens");
  });

  it("devolve LlmRefused na recusa, sem insistir", async () => {
    const llm = createFakeLlmClient([{ stopReason: "refusal", text: null }]);
    const outcome = await run(llm);
    expect(outcome).toEqual({ ok: false, error: { code: "LlmRefused" } });
    expect(llm.requests).toHaveLength(1);
  });

  it("escala intenção unclear para o modelo avançado e fica com a resposta dele", async () => {
    const llm = createFakeLlmClient([{ json: unclear }, { json: valid }]);
    const outcome = await run(llm, "camarão");
    expect(outcome.ok && outcome.value.result.intent).toBe("register");
    expect(llm.requests.map((request) => request.model)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ]);
  });

  it("mantém a pergunta do primeiro modelo se o avançado devolver saída inválida", async () => {
    const llm = createFakeLlmClient([{ json: unclear }, { text: "lixo" }]);
    const outcome = await run(llm, "camarão");
    expect(outcome.ok && outcome.value.result).toEqual(unclear);
  });

  it("não mistura texto do usuário no motivo do erro", async () => {
    const llm = createFakeLlmClient([{ text: "segredo 123" }, { text: "segredo 456" }]);
    const outcome = await run(llm);
    expect(JSON.stringify(outcome)).not.toContain("segredo");
  });
});
