import { describe, expect, it } from "vitest";
import { buildChoice, ChoiceDraftSchema, parseChoiceAnswer } from "./choice";

const ITEMS = [
  { id: "a", label: "Matriz" },
  { id: "b", label: "Praia" },
];

describe("buildChoice", () => {
  it("numera as opções a partir de 1 e ensina a cancelar", () => {
    const { text, draft } = buildChoice("unit", ITEMS);
    expect(text).toContain("1. Matriz");
    expect(text).toContain("2. Praia");
    expect(text).toContain("cancelar");
    expect(draft).toEqual({
      target: "unit",
      options: [
        { n: 1, id: "a", label: "Matriz" },
        { n: 2, id: "b", label: "Praia" },
      ],
    });
  });

  it("diz se a lista é de unidades ou de empresas", () => {
    expect(buildChoice("unit", ITEMS).text).toMatch(/unidade/i);
    expect(buildChoice("tenant", ITEMS).text).toMatch(/empresa/i);
  });
});

describe("parseChoiceAnswer", () => {
  const { draft } = buildChoice("unit", ITEMS);

  it.each(["2", " 2. ", "2 "])("a resposta %j escolhe a opção 2", (answer) => {
    expect(parseChoiceAnswer(draft, answer)).toEqual({ kind: "chosen", id: "b", label: "Praia" });
  });

  it.each(["0", "3", "praia", "", "1 2", "-1", "1.5"])("a resposta %j é inválida", (answer) => {
    expect(parseChoiceAnswer(draft, answer)).toEqual({ kind: "invalid" });
  });
});

describe("ChoiceDraftSchema", () => {
  it("rejeita opção com número repetido", () => {
    const result = ChoiceDraftSchema.safeParse({
      target: "unit",
      options: [
        { n: 1, id: "a", label: "Matriz" },
        { n: 1, id: "b", label: "Praia" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejeita lista vazia e alvo desconhecido", () => {
    expect(ChoiceDraftSchema.safeParse({ target: "unit", options: [] }).success).toBe(false);
    expect(
      ChoiceDraftSchema.safeParse({ target: "x", options: [{ n: 1, id: "a", label: "A" }] })
        .success,
    ).toBe(false);
  });
});
