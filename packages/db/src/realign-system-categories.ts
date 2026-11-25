import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { categories, entries, entryVersions } from "../schema";
import type { Database, Transaction } from "./client";
import { toEntry } from "./entry-store";
import { SYSTEM_CATEGORIES, seedSystemCategories, systemCategoryValues } from "./system-categories";
import { uuidv7 } from "./uuid";

/**
 * De-para da lista antiga para a lista do RF07.Obs2. A chave é o nome antigo, com o pai antes
 * da barra quando a categoria era filha (`Insumos/Carnes`). Categorias de mesmo nome que ficam
 * no primeiro nível não aparecem aqui como troca: são só atualizadas no lugar.
 */
export const CATEGORY_REALIGNMENT: Readonly<Record<string, string>> = {
  Salão: "Vendas",
  Delivery: "Vendas",
  Balcão: "Vendas",
  "Outras receitas": "Outras receitas",
  Insumos: "Mercearia",
  "Insumos/Carnes": "Carnes",
  "Insumos/Hortifrúti": "Hortifrúti",
  "Insumos/Bebidas": "Bebidas",
  "Insumos/Descartáveis": "Embalagens e descartáveis",
  "Folha de pagamento": "Salários",
  Aluguel: "Aluguel",
  Energia: "Energia",
  Água: "Água",
  Gás: "Gás",
  Marketing: "Marketing",
  Manutenção: "Manutenção",
  "Outras despesas": "Outras despesas",
  Internet: "Internet e telefone",
  "Impostos e taxas": "Impostos sobre faturamento",
};

export interface RealignResult {
  categoriesCreated: number;
  categoriesUpdated: number;
  entriesReclassified: number;
  childrenMoved: number;
  categoriesInactivated: number;
}

export class SensitiveDowngradeError extends Error {
  constructor(from: string, to: string) {
    super(`realinhamento recusado: "${from}" é sensível e "${to}" não é`);
    this.name = "SensitiveDowngradeError";
  }
}

export class MissingRealignTargetError extends Error {
  constructor(name: string) {
    super(`categoria nova do sistema ausente: ${name}`);
    this.name = "MissingRealignTargetError";
  }
}

type CategoryRow = typeof categories.$inferSelect;

async function systemCount(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(isNull(categories.tenantId));
  return row?.n ?? 0;
}

/** Atualiza no lugar as categorias de mesmo nome (e reativa), sem nunca tirar a marca de sensível. */
async function syncSameName(tx: Transaction): Promise<number> {
  let updated = 0;
  for (const category of SYSTEM_CATEGORIES) {
    const values = systemCategoryValues(category);
    const rows = await tx
      .update(categories)
      .set({ ...values, status: "active" })
      .where(
        and(
          isNull(categories.tenantId),
          isNull(categories.parentId),
          eq(categories.name, values.name),
          sql`(${categories.kind}, ${categories.nature}, ${categories.dreGroup}, ${categories.isSensitive}, ${categories.status})
            is distinct from (${values.kind}, ${values.nature}, ${values.dreGroup}, ${values.isSensitive}, 'active')`,
          // Falha fechado: categoria já sensível nunca vira não sensível.
          values.isSensitive ? undefined : eq(categories.isSensitive, false),
        ),
      )
      .returning({ id: categories.id });
    updated += rows.length;
  }
  return updated;
}

async function reclassifyEntries(tx: Transaction, from: CategoryRow, to: CategoryRow) {
  // Trava os lançamentos: uma edição concorrente não pode deixar o "antes" velho nem regredir a versão.
  const rows = await tx.select().from(entries).where(eq(entries.categoryId, from.id)).for("update");
  const at = new Date();
  for (const row of rows) {
    const before = toEntry(row);
    const after = { ...before, categoryId: to.id, version: before.version + 1, updatedAt: at };
    await tx
      .update(entries)
      .set({ categoryId: to.id, version: after.version, updatedAt: at })
      .where(and(eq(entries.tenantId, row.tenantId), eq(entries.id, row.id)));
    // A tabela exige autor: o do lançamento. O canal "system" mostra que foi o produto.
    await tx.insert(entryVersions).values({
      id: uuidv7(),
      tenantId: row.tenantId,
      entryId: row.id,
      version: after.version,
      action: "update",
      before,
      after,
      changedBy: row.createdBy,
      channel: "system",
      changedAt: at,
    });
  }
  return rows.length;
}

async function moveChildren(tx: Transaction, from: CategoryRow, to: CategoryRow) {
  const children = await tx
    .select()
    .from(categories)
    .where(and(isNotNull(categories.tenantId), eq(categories.parentId, from.id)));
  for (const child of children) {
    const [clash] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.tenantId, child.tenantId as string),
          eq(categories.parentId, to.id),
          eq(categories.name, child.name),
        ),
      );
    await tx
      .update(categories)
      .set({
        parentId: to.id,
        kind: to.kind,
        dreGroup: to.dreGroup,
        isSensitive: child.isSensitive || to.isSensitive,
        // Nome repetido entre irmãs não existe (RF07.R1): a que veio de fora leva a origem.
        name: clash ? `${child.name} (${from.name})`.slice(0, 60) : child.name,
      })
      .where(eq(categories.id, child.id));
  }
  return children.length;
}

/**
 * Realinha as categorias do sistema à lista do RF07.Obs2 (RF07.Obs3): cria as novas,
 * reclassifica todos os lançamentos (de todas as empresas, inclusive excluídos) pelo de-para,
 * move as subcategorias das empresas e inativa as antigas. Papel administrativo, ignora RLS
 * de propósito. Idempotente: a segunda execução não muda nada.
 */
export async function realignSystemCategories(db: Database): Promise<RealignResult> {
  return db.transaction(async (tx) => {
    const result: RealignResult = {
      categoriesCreated: 0,
      categoriesUpdated: 0,
      entriesReclassified: 0,
      childrenMoved: 0,
      categoriesInactivated: 0,
    };
    const countBefore = await systemCount(tx);
    await seedSystemCategories(tx as unknown as Database);
    result.categoriesCreated = (await systemCount(tx)) - countBefore;
    result.categoriesUpdated = await syncSameName(tx);

    const system = await tx.select().from(categories).where(isNull(categories.tenantId));
    const byId = new Map(system.map((row) => [row.id, row]));
    const topLevel = new Map(
      system.filter((row) => row.parentId === null).map((row) => [row.name, row]),
    );

    for (const old of system) {
      const parent = old.parentId ? byId.get(old.parentId) : undefined;
      const key = parent ? `${parent.name}/${old.name}` : old.name;
      const targetName = CATEGORY_REALIGNMENT[key];
      if (targetName === undefined) continue;
      const target = topLevel.get(targetName);
      if (!target) throw new MissingRealignTargetError(targetName);
      if (target.id === old.id) continue;
      if (old.isSensitive && !target.isSensitive)
        throw new SensitiveDowngradeError(old.name, target.name);

      result.entriesReclassified += await reclassifyEntries(tx, old, target);
      result.childrenMoved += await moveChildren(tx, old, target);
      const inactivated = await tx
        .update(categories)
        .set({ status: "inactive" })
        .where(and(eq(categories.id, old.id), ne(categories.status, "inactive")))
        .returning({ id: categories.id });
      result.categoriesInactivated += inactivated.length;
    }
    return result;
  });
}
