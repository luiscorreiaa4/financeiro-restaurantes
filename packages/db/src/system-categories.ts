import { categories } from "../schema";
import type { Database } from "./client";

export interface SystemCategory {
  readonly name: string;
  readonly kind: "revenue" | "expense" | "investment" | "deduction";
  readonly nature: "fixed" | "variable" | null;
  readonly dreGroup: string;
  readonly isSensitive?: boolean;
  readonly requiresQuantity?: boolean;
}

/*
 * Naturezas (fixa ou variável) das despesas. RF07.R4 fixa só CMV, taxas e comissões como
 * variáveis e aluguel e folha como fixos; o resto é default PROVISÓRIO [P01]: o Matheus fecha
 * a lista com o sócio contador. Para mudar um default, mude só a constante.
 */
const CMV_NATURE = "variable"; // RF07.R4
const PAYROLL_NATURE = "fixed"; // RF07.R4
const FREELANCE_NATURE = "variable"; // [P01] provisório: pagamento por diária
const OCCUPANCY_NATURE = "fixed"; // RF07.R4 (aluguel); condomínio e IPTU [P01]
const UTILITIES_NATURE = "variable"; // [P01] provisório
const TELECOM_NATURE = "fixed"; // [P01] provisório
const CLEANING_NATURE = "variable"; // [P01] provisório
const SERVICES_NATURE = "fixed"; // [P01] provisório: sistemas e contabilidade
const MARKETING_NATURE = "variable"; // [P01] provisório
const FINANCIAL_NATURE = "variable"; // [P01] provisório
const OTHER_NATURE = "variable"; // [P01] provisório

const expense = (
  name: string,
  dreGroup: string,
  nature: "fixed" | "variable",
  isSensitive = false,
): SystemCategory => ({ name, kind: "expense", nature, dreGroup, isSensitive });

/** CMV exige quantidade e unidade (RF07.R7, CA02: a subcategoria herda). */
const cmv = (name: string): SystemCategory => ({
  ...expense(name, "cmv", CMV_NATURE),
  requiresQuantity: true,
});

const deduction = (name: string): SystemCategory => ({
  name,
  kind: "deduction",
  nature: null,
  dreGroup: "deducoes",
});

/**
 * Categorias padrão (RF07.Obs2), todas no primeiro nível. Lista PROVISÓRIA [P01]: precisa da
 * validação do Matheus e do sócio contador. O seed só cria o que falta; para alterar ou
 * remover categoria já gravada use `realign-system-categories.ts` (RF07.Obs3).
 * Textos em pt-BR porque o usuário os vê.
 */
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = [
  { name: "Vendas", kind: "revenue", nature: null, dreGroup: "receita_bruta" },
  { name: "Outras receitas", kind: "revenue", nature: null, dreGroup: "receita_bruta" },
  deduction("Impostos sobre faturamento"),
  deduction("Taxas de cartão"),
  deduction("Comissões de aplicativos"),
  cmv("Carnes"),
  cmv("Hortifrúti"),
  cmv("Bebidas"),
  cmv("Mercearia"),
  cmv("Embalagens e descartáveis"),
  expense("Salários", "pessoal", PAYROLL_NATURE, true),
  expense("Encargos", "pessoal", PAYROLL_NATURE, true),
  expense("Benefícios", "pessoal", PAYROLL_NATURE, true),
  expense("Pró-labore", "pessoal", PAYROLL_NATURE, true),
  expense("Extras e freelas", "pessoal", FREELANCE_NATURE, true),
  expense("Aluguel", "ocupacao", OCCUPANCY_NATURE),
  expense("Condomínio", "ocupacao", OCCUPANCY_NATURE),
  expense("IPTU", "ocupacao", OCCUPANCY_NATURE),
  expense("Energia", "utilidades", UTILITIES_NATURE),
  expense("Água", "utilidades", UTILITIES_NATURE),
  expense("Gás", "utilidades", UTILITIES_NATURE),
  expense("Internet e telefone", "utilidades", TELECOM_NATURE),
  expense("Limpeza", "operacionais", CLEANING_NATURE),
  expense("Manutenção", "operacionais", CLEANING_NATURE),
  expense("Sistemas e assinaturas", "operacionais", SERVICES_NATURE),
  expense("Contabilidade", "operacionais", SERVICES_NATURE),
  expense("Marketing", "marketing", MARKETING_NATURE),
  expense("Juros", "financeiras", FINANCIAL_NATURE),
  expense("Tarifas bancárias", "financeiras", FINANCIAL_NATURE),
  { name: "Equipamentos", kind: "investment", nature: null, dreGroup: "investimentos" },
  { name: "Reformas", kind: "investment", nature: null, dreGroup: "investimentos" },
  expense("Outras despesas", "operacionais", OTHER_NATURE),
];

/** Valores gravados de uma categoria do sistema (colunas de `categories`). */
export function systemCategoryValues(category: SystemCategory) {
  return {
    name: category.name,
    kind: category.kind,
    nature: category.nature,
    dreGroup: category.dreGroup,
    isSensitive: category.isSensitive ?? false,
    requiresQuantity: category.requiresQuantity ?? false,
  };
}

/**
 * Grava as categorias do sistema (`tenant_id` nulo). Idempotente: rodar de novo não
 * duplica nem altera o que já existe. Exige o papel administrativo, porque o papel `app`
 * não escreve categorias do sistema.
 */
export async function seedSystemCategories(db: Database): Promise<void> {
  await db
    .insert(categories)
    .values(SYSTEM_CATEGORIES.map(systemCategoryValues))
    .onConflictDoNothing();
}
