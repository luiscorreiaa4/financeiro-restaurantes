import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORIES } from "./system-categories";

const DRE_GROUPS = [
  "receita_bruta",
  "deducoes",
  "cmv",
  "pessoal",
  "ocupacao",
  "utilidades",
  "operacionais",
  "marketing",
  "financeiras",
  "impostos",
  "investimentos",
];

function byName(name: string) {
  const found = SYSTEM_CATEGORIES.find((c) => c.name === name);
  if (!found) throw new Error(`categoria ausente: ${name}`);
  return found;
}

describe("categorias padrão do sistema (RF07.Obs2)", () => {
  it("categorias de CMV exigem quantidade e as demais não (RF07.R7)", () => {
    for (const c of SYSTEM_CATEGORIES) {
      expect(c.requiresQuantity ?? false, c.name).toBe(c.dreGroup === "cmv");
    }
  });

  const names = SYSTEM_CATEGORIES.map((c) => c.name);

  it("não repete nome, para o seed ser idempotente", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("tem a lista da proposta, toda no primeiro nível", () => {
    expect(names).toEqual([
      "Vendas",
      "Outras receitas",
      "Impostos sobre faturamento",
      "Taxas de cartão",
      "Comissões de aplicativos",
      "Carnes",
      "Hortifrúti",
      "Bebidas",
      "Mercearia",
      "Embalagens e descartáveis",
      "Salários",
      "Encargos",
      "Benefícios",
      "Pró-labore",
      "Extras e freelas",
      "Aluguel",
      "Condomínio",
      "IPTU",
      "Energia",
      "Água",
      "Gás",
      "Internet e telefone",
      "Limpeza",
      "Manutenção",
      "Sistemas e assinaturas",
      "Contabilidade",
      "Marketing",
      "Juros",
      "Tarifas bancárias",
      "Equipamentos",
      "Reformas",
      "Outras despesas",
    ]);
    expect(SYSTEM_CATEGORIES.every((c) => !("children" in c))).toBe(true);
  });

  it("usa só os 11 grupos do DRE (RF07.R5)", () => {
    for (const c of SYSTEM_CATEGORIES) expect(DRE_GROUPS).toContain(c.dreGroup);
    // "impostos" (imposto sobre o resultado, RF39) não tem categoria padrão: os impostos sobre
    // faturamento são dedução.
    const used = new Set(SYSTEM_CATEGORIES.map((c) => c.dreGroup));
    expect([...DRE_GROUPS].filter((g) => !used.has(g))).toEqual(["impostos"]);
  });

  it("marca como sensíveis só as categorias de pessoal (RF07.R6)", () => {
    const sensitive = SYSTEM_CATEGORIES.filter((c) => c.isSensitive).map((c) => c.name);
    expect(sensitive).toEqual([
      "Salários",
      "Encargos",
      "Benefícios",
      "Pró-labore",
      "Extras e freelas",
    ]);
    for (const c of SYSTEM_CATEGORIES.filter((c) => c.dreGroup === "pessoal"))
      expect(c.isSensitive).toBe(true);
  });

  it("dá o tipo e o grupo de receitas, deduções e investimentos (RF07.R3)", () => {
    expect(byName("Vendas")).toMatchObject({ kind: "revenue", dreGroup: "receita_bruta" });
    for (const name of [
      "Impostos sobre faturamento",
      "Taxas de cartão",
      "Comissões de aplicativos",
    ])
      expect(byName(name)).toMatchObject({ kind: "deduction", dreGroup: "deducoes" });
    for (const name of ["Equipamentos", "Reformas"])
      expect(byName(name)).toMatchObject({ kind: "investment", dreGroup: "investimentos" });
  });

  it("só despesa tem natureza (RF07.R4)", () => {
    for (const c of SYSTEM_CATEGORIES) {
      if (c.kind === "expense") expect(c.nature).not.toBeNull();
      else expect(c.nature).toBeNull();
    }
    expect(byName("Aluguel").nature).toBe("fixed");
    expect(byName("Salários").nature).toBe("fixed");
    expect(byName("Carnes").nature).toBe("variable");
  });

  it("mantém 'Outras receitas' e 'Outras despesas' como destino de dúvida", () => {
    expect(names).toContain("Outras receitas");
    expect(byName("Outras despesas").dreGroup).toBe("operacionais");
  });
});
