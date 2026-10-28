import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES } from "./system-categories";

describe("categorias padrão do sistema", () => {
  const names = SYSTEM_CATEGORIES.flatMap((c) => [c.name, ...(c.children ?? [])]);

  it("não repete nome, para o seed ser idempotente", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("marca só a folha de pagamento como sensível", () => {
    const sensitive = SYSTEM_CATEGORIES.filter((c) => c.isSensitive).map((c) => c.name);
    expect(sensitive).toEqual(["Folha de pagamento"]);
  });

  it("tem receitas e despesas, e receita não tem natureza fixa/variável", () => {
    const revenues = SYSTEM_CATEGORIES.filter((c) => c.kind === "revenue");
    expect(revenues.length).toBeGreaterThan(0);
    expect(SYSTEM_CATEGORIES.some((c) => c.kind === "expense")).toBe(true);
    for (const revenue of revenues) expect(revenue.nature).toBeNull();
  });

  it("inclui 'Outras receitas' e 'Outras despesas' como destino de dúvida", () => {
    expect(names).toContain("Outras receitas");
    expect(names).toContain("Outras despesas");
  });
});
