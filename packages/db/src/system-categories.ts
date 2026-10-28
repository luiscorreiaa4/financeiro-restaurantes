import { and, isNull } from "drizzle-orm";
import { categories } from "../schema";
import type { Database } from "./client";

export interface SystemCategory {
  readonly name: string;
  readonly kind: "revenue" | "expense";
  readonly nature: "fixed" | "variable" | null;
  readonly dreGroup: string;
  readonly isSensitive?: boolean;
  readonly children?: readonly string[];
}

/**
 * Categorias padrão. Lista PROVISÓRIA (decisão de 27/10/2026): precisará ser ajustada
 * depois, com validação do Matheus. O seed só cria o que falta; alterar ou remover categoria
 * já gravada exige migration ou script de ajuste.
 * Textos em pt-BR porque o usuário os vê.
 */
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = [
  { name: "Salão", kind: "revenue", nature: null, dreGroup: "receita_bruta" },
  { name: "Delivery", kind: "revenue", nature: null, dreGroup: "receita_bruta" },
  { name: "Balcão", kind: "revenue", nature: null, dreGroup: "receita_bruta" },
  { name: "Outras receitas", kind: "revenue", nature: null, dreGroup: "receita_bruta" },
  {
    name: "Insumos",
    kind: "expense",
    nature: "variable",
    dreGroup: "cmv",
    children: ["Carnes", "Hortifrúti", "Bebidas", "Descartáveis"],
  },
  {
    name: "Folha de pagamento",
    kind: "expense",
    nature: "fixed",
    dreGroup: "pessoal",
    isSensitive: true,
  },
  { name: "Aluguel", kind: "expense", nature: "fixed", dreGroup: "ocupacao" },
  { name: "Energia", kind: "expense", nature: "variable", dreGroup: "utilidades" },
  { name: "Água", kind: "expense", nature: "variable", dreGroup: "utilidades" },
  { name: "Gás", kind: "expense", nature: "variable", dreGroup: "utilidades" },
  { name: "Internet", kind: "expense", nature: "fixed", dreGroup: "utilidades" },
  { name: "Marketing", kind: "expense", nature: "variable", dreGroup: "marketing" },
  { name: "Manutenção", kind: "expense", nature: "variable", dreGroup: "manutencao" },
  { name: "Impostos e taxas", kind: "expense", nature: "variable", dreGroup: "impostos" },
  { name: "Outras despesas", kind: "expense", nature: "variable", dreGroup: "outras" },
];

/**
 * Grava as categorias do sistema (`tenant_id` nulo). Idempotente: rodar de novo não
 * duplica nem altera o que já existe. Exige o papel administrativo, porque o papel `app`
 * não escreve categorias do sistema.
 */
export async function seedSystemCategories(db: Database): Promise<void> {
  await db
    .insert(categories)
    .values(
      SYSTEM_CATEGORIES.map((category) => ({
        name: category.name,
        kind: category.kind,
        nature: category.nature,
        dreGroup: category.dreGroup,
        isSensitive: category.isSensitive ?? false,
      })),
    )
    .onConflictDoNothing();

  const parents = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(isNull(categories.tenantId), isNull(categories.parentId)));
  const parentIdByName = new Map(parents.map((parent) => [parent.name, parent.id]));

  const children = SYSTEM_CATEGORIES.flatMap((parent) =>
    (parent.children ?? []).map((name) => ({
      name,
      parentId: parentIdByName.get(parent.name),
      kind: parent.kind,
      nature: parent.nature,
      dreGroup: parent.dreGroup,
      isSensitive: parent.isSensitive ?? false,
    })),
  );
  if (children.length > 0) await db.insert(categories).values(children).onConflictDoNothing();
}
