import { describe, expect, it } from "vitest";
import type { ExtractedEntry, ExtractionResult } from "./extraction";
import { daysBefore, interpretExtraction, sanitizeDescription } from "./interpret";

const TODAY = "2026-10-30";

const extracted = (overrides: Partial<ExtractedEntry> = {}): ExtractedEntry => ({
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

describe("interpretação da extração (RF12)", () => {
  it("usa a data de hoje quando o usuário não disse a data", () => {
    const outcome = interpretExtraction(register([extracted()]), TODAY);
    expect(outcome).toMatchObject({ kind: "register", pending: [] });
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.ready[0]).toMatchObject({ occurredOn: TODAY, amountCents: 45000, flags: [] });
  });

  it("calcula o valor por quantidade × preço quando não há total", () => {
    const entry = extracted({ total_cents: null, quantity: 3, unit_price_cents: 4500 });
    const outcome = interpretExtraction(register([entry]), TODAY);
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.ready[0]?.amountCents).toBe(13500);
  });

  it("pergunta quando quantidade × preço difere do total em mais de R$ 0,01 (CA05)", () => {
    const entry = extracted({ total_cents: 14000, quantity: 3, unit_price_cents: 4500 });
    const outcome = interpretExtraction(register([entry]), TODAY);
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.ready).toEqual([]);
    expect(outcome.pending[0]).toMatchObject({
      reasons: ["amount_inconsistent"],
      inconsistency: { computedCents: 13500, statedCents: 14000 },
    });
    expect(outcome.modelQuestion).toBeNull();
  });

  it("recusa data futura pelo WhatsApp e pergunta a data (CA07)", () => {
    const outcome = interpretExtraction(
      register([extracted({ occurred_on: "2026-10-31" })]),
      TODAY,
    );
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.ready).toEqual([]);
    expect(outcome.pending[0]?.reasons).toEqual(["future_date"]);
  });

  it("aceita data de hoje e destaca data com mais de 60 dias", () => {
    const old = interpretExtraction(register([extracted({ occurred_on: "2026-08-01" })]), TODAY);
    if (old.kind !== "register") throw new Error("esperava register");
    expect(old.ready[0]?.flags).toEqual(["old_date"]);

    const limit = interpretExtraction(register([extracted({ occurred_on: "2026-08-31" })]), TODAY);
    if (limit.kind !== "register") throw new Error("esperava register");
    expect(limit.ready[0]?.flags).toEqual([]);
  });

  it("grava os completos e deixa só o incompleto pendente (CA04 do RF15)", () => {
    const outcome = interpretExtraction(
      register(
        [
          extracted({ description: "Óleo", total_cents: 18000 }),
          extracted({ total_cents: null, missing_fields: ["amount"] }),
        ],
        "Qual foi o valor do camarão?",
      ),
      TODAY,
    );
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.ready.map((entry) => entry.description)).toEqual(["Óleo"]);
    expect(outcome.pending).toHaveLength(1);
    expect(outcome.modelQuestion).toBe("Qual foi o valor do camarão?");
  });

  it("não pergunta por campo que o sistema presume (forma de pagamento)", () => {
    const entry = extracted({ missing_fields: ["payment_method"] });
    const outcome = interpretExtraction(register([entry], "Como pagou?"), TODAY);
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.pending).toEqual([]);
    expect(outcome.ready).toHaveLength(1);
    expect(outcome.modelQuestion).toBeNull();
  });

  it("trata valor ausente que a IA esqueceu de apontar como pendência do sistema", () => {
    const outcome = interpretExtraction(register([extracted({ total_cents: null })]), TODAY);
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.pending[0]?.reasons).toEqual(["amount"]);
    expect(outcome.modelQuestion).toBeNull();
  });

  it("repassa fora de escopo e a pergunta de intenção pouco clara", () => {
    expect(
      interpretExtraction({ intent: "out_of_scope", entries: [], question: null }, TODAY),
    ).toEqual({ kind: "out_of_scope" });
    expect(
      interpretExtraction({ intent: "unclear", entries: [], question: " Pode explicar? " }, TODAY),
    ).toEqual({ kind: "unclear", question: "Pode explicar?" });
  });
});

describe("descrição sem dado sensível (RF12.R3)", () => {
  it("remove CPF e número de cartão", () => {
    expect(sanitizeDescription("Pagamento João 123.456.789-09")).toBe("Pagamento João");
    expect(sanitizeDescription("Compra cartão 4111 1111 1111 1111 mercado")).toBe(
      "Compra cartão mercado",
    );
  });

  it("mantém números curtos como quantidades e valores", () => {
    expect(sanitizeDescription("5 kg de camarão, 450 reais")).toBe("5 kg de camarão, 450 reais");
  });

  it("limita a 200 caracteres", () => {
    expect([...sanitizeDescription("a".repeat(300))]).toHaveLength(200);
  });

  it("descrição que sobra vazia vira pendência de descrição", () => {
    const outcome = interpretExtraction(
      register([extracted({ description: "123.456.789-09" })]),
      TODAY,
    );
    if (outcome.kind !== "register") throw new Error("esperava register");
    expect(outcome.pending[0]?.reasons).toEqual(["description"]);
  });
});

describe("diferença de dias entre datas de negócio", () => {
  it("conta dias corridos atravessando mês e ano", () => {
    expect(daysBefore("2026-10-01", "2026-10-30")).toBe(29);
    expect(daysBefore("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBefore("2026-11-01", "2026-10-30")).toBe(-2);
  });
});
