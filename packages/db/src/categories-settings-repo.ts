import {
  type CategoryRecord,
  type CategoryStatus,
  type DomainError,
  fail,
  normalizeName,
  ok,
  type Result,
  validateSubcategory,
  validateSubcategoryPatch,
} from "@app/core";
import type {
  CategoryNode,
  CategorySettings,
  SubcategoryInput,
  SubcategoryPatch,
} from "@app/core/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditLog, categories } from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { isUniqueViolation } from "./panel-entry-writer";
import { uuidv7 } from "./uuid";

export const CATEGORY_NAME_UNIQUE = "categories_scope_parent_name_unique";

export interface CategoriesScope {
  /**
   * Categoria sensível (folha) e as subcategorias dela entram na leitura (RF06.R3). Falso é o
   * padrão seguro: quem chama só passa `true` para dono, contador e gerente com VER_FOLHA.
   */
  readonly includeSensitive: boolean;
}

export interface CategoriesFilter extends CategoriesScope {
  readonly search?: string;
  readonly kind?: CategoryRecord["kind"];
  readonly status?: CategoryStatus;
}

export interface CategoriesSettingsRepo {
  list(tenantId: string, filter: CategoriesFilter): Promise<CategoryNode[]>;
  createSubcategory(
    tenantId: string,
    actorId: string,
    input: SubcategoryInput,
    scope: CategoriesScope,
  ): Promise<Result<CategorySettings, DomainError>>;
  /** `null`: id inexistente, de outra empresa ou sensível que o ator não vê. */
  updateSubcategory(
    tenantId: string,
    actorId: string,
    id: string,
    patch: SubcategoryPatch,
    scope: CategoriesScope,
  ): Promise<Result<CategorySettings, DomainError> | null>;
}

type CategoryRow = typeof categories.$inferSelect;

const toSettings = (row: CategoryRow): CategorySettings => ({
  id: row.id,
  name: row.name,
  parentId: row.parentId,
  kind: row.kind as CategorySettings["kind"],
  nature: row.nature as CategorySettings["nature"],
  dreGroup: row.dreGroup,
  isSensitive: row.isSensitive,
  requiresQuantity: row.requiresQuantity,
  supportWords: row.supportWords,
  origin: row.tenantId === null ? "system" : "company",
  status: row.status as CategoryStatus,
});

const toRecord = (row: CategoryRow): CategoryRecord => ({
  id: row.id,
  parentId: row.parentId,
  origin: row.tenantId === null ? "system" : "company",
  name: row.name,
  kind: row.kind as CategoryRecord["kind"],
  nature: row.nature as CategoryRecord["nature"],
  dreGroup: row.dreGroup,
  isSensitive: row.isSensitive,
  requiresQuantity: row.requiresQuantity,
  status: row.status as CategoryStatus,
});

/** Só os campos cujo valor mudou, no antes e no depois (auditoria). */
function diff<T extends object>(before: T, after: T) {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length === 0 ? null : { before: b, after: a };
}

const AUDITED = ["name", "nature", "supportWords", "status"] as const;
const audited = (value: CategorySettings) => ({
  name: value.name,
  nature: value.nature,
  supportWords: value.supportWords,
  status: value.status,
});

/**
 * Categoria sensível (ou subcategoria de uma) some da leitura de quem não vê folha. Falha
 * fechado: `is_sensitive = false` não casa com nulo, e pai que o RLS não devolve também exclui.
 */
const hideSensitive = sql`${categories.isSensitive} = false and (${categories.parentId} is null or exists (
  select 1 from categories p where p.id = ${categories.parentId} and p.is_sensitive = false))`;

const matches = (row: CategorySettings, key: string) =>
  normalizeName(row.name).includes(key) ||
  row.supportWords.some((word) => normalizeName(word).includes(key));

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

export function createCategoriesSettingsRepo(db: Database): CategoriesSettingsRepo {
  /** Nome repetido pego pelo índice (corrida): descobre o outro cadastro em transação nova. */
  async function nameTaken(
    tenantId: string,
    parentId: string | null,
    name: string,
    selfId: string,
  ): Promise<DomainError> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.tenantId, tenantId),
            eq(categories.name, name),
            parentId === null
              ? sql`${categories.parentId} is null`
              : eq(categories.parentId, parentId),
          ),
        ),
    );
    return { code: "NameTaken", conflictId: rows.find((r) => r.id !== selfId)?.id ?? selfId };
  }

  const siblingsOf = (tx: Transaction, tenantId: string, parentId: string) =>
    tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.parentId, parentId)));

  return {
    async list(tenantId, filter) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(categories)
          .where(
            and(
              sql`(${categories.tenantId} is null or ${categories.tenantId} = ${tenantId})`,
              filter.includeSensitive ? undefined : hideSensitive,
            ),
          )
          .orderBy(asc(categories.name)),
      );
      const key = filter.search ? normalizeName(filter.search) : "";
      const passes = (row: CategorySettings) =>
        (filter.kind ? row.kind === filter.kind : true) &&
        (filter.status ? row.status === filter.status : true);

      const all = rows.map(toSettings);
      const childrenOf = new Map<string, CategorySettings[]>();
      for (const row of all) {
        if (row.parentId === null) continue;
        childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row]);
      }

      const tree: CategoryNode[] = [];
      for (const root of all.filter((row) => row.parentId === null)) {
        const rootMatches = key === "" || matches(root, key);
        const children = (childrenOf.get(root.id) ?? [])
          .filter((child) => passes(child) && (rootMatches || matches(child, key)))
          .sort(byName);
        if ((passes(root) && rootMatches) || children.length > 0) {
          tree.push({ ...root, children });
        }
      }
      return tree.sort(byName);
    },

    async createSubcategory(tenantId, actorId, input, scope) {
      const id = uuidv7();
      let resolvedParent: string | null = input.parentId;
      try {
        return await withTenant(db, tenantId, async (tx) => {
          // Pai lido sob RLS: categoria de outra empresa não existe aqui (tabela-nova, regra 7).
          const [parent] = await tx
            .select()
            .from(categories)
            .where(eq(categories.id, input.parentId));
          // Na dúvida é sensível: pai que o ator não vê responde como pai inexistente.
          if (!parent || (!scope.includeSensitive && parent.isSensitive !== false)) {
            return fail("UnknownReference", { field: "category" });
          }
          resolvedParent = parent.id;
          const siblings = await siblingsOf(tx, tenantId, parent.id);
          const valid = validateSubcategory({
            name: input.name,
            parent: toRecord(parent),
            siblings,
            nature: input.nature ?? null,
            isSensitive: false,
            supportWords: input.supportWords,
          });
          if (!valid.ok) return valid;
          const [row] = await tx
            .insert(categories)
            .values({
              id,
              tenantId,
              ...valid.value,
              supportWords: [...valid.value.supportWords],
            })
            .returning();
          if (!row) throw new Error("insert de subcategoria sem retorno");
          const settings = toSettings(row);
          const { id: _id, ...after } = settings;
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "category.create",
            target: id,
            metadata: { after },
          });
          return ok(settings);
        });
      } catch (error) {
        if (isUniqueViolation(error, CATEGORY_NAME_UNIQUE)) {
          return {
            ok: false,
            error: await nameTaken(tenantId, resolvedParent, input.name.trim(), id),
          };
        }
        throw error;
      }
    },

    async updateSubcategory(tenantId, actorId, id, patch, scope) {
      let parentId: string | null = null;
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const [seen] = await tx.select().from(categories).where(eq(categories.id, id));
          if (!seen) return null;
          if (!scope.includeSensitive) {
            const hidden = await tx
              .select({ id: categories.id })
              .from(categories)
              .where(and(eq(categories.id, id), hideSensitive));
            if (hidden.length === 0) return null;
          }
          // Categoria do sistema (tenant nulo) é somente leitura (CA01); o RLS de escrita a
          // esconderia do `FOR UPDATE`, então a recusa vem antes da trava.
          if (seen.tenantId === null) return fail("SystemCategoryReadOnly");
          const [current] = await tx
            .select()
            .from(categories)
            .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId)))
            .for("update");
          if (!current) return null;
          parentId = current.parentId;
          const siblings = current.parentId ? await siblingsOf(tx, tenantId, current.parentId) : [];
          const valid = validateSubcategoryPatch(toRecord(current), patch, siblings);
          if (!valid.ok) return valid;
          const before = toSettings(current);
          const changes = diff(audited(before), {
            ...audited(before),
            ...definedOnly(valid.value),
          });
          if (!changes) return ok(before);
          const [row] = await tx
            .update(categories)
            .set({
              ...changes.after,
              supportWords: changes.after.supportWords
                ? [...changes.after.supportWords]
                : undefined,
            })
            .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
            .returning();
          if (!row) throw new Error("update de subcategoria sem retorno");
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "category.update",
            target: id,
            metadata: changes,
          });
          return ok(toSettings(row));
        });
      } catch (error) {
        if (isUniqueViolation(error, CATEGORY_NAME_UNIQUE)) {
          return {
            ok: false,
            error: await nameTaken(tenantId, parentId, patch.name?.trim() ?? "", id),
          };
        }
        throw error;
      }
    },
  };
}

/** Só as chaves auditadas que o domínio devolveu (as outras do patch não existem aqui). */
function definedOnly(value: object): Partial<ReturnType<typeof audited>> {
  const out: Record<string, unknown> = {};
  for (const key of AUDITED) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return out as Partial<ReturnType<typeof audited>>;
}
