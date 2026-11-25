import {
  type BusinessDate,
  type DomainError,
  fail,
  maskCpf,
  normalizeName,
  ok,
  planSupplierMerge,
  type Result,
  reassignSupplier,
  type Supplier,
  validateSupplierPatch,
} from "@app/core";
import type { SupplierPatchInput, SupplierSettings } from "@app/core/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLog, entries, entryVersions, suppliers } from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { arrayLiteral, sensitiveExpression } from "./entry-reader";
import { toEntry, versionValues } from "./entry-store";
import { isUniqueViolation, SUPPLIER_NAME_UNIQUE } from "./panel-entry-writer";
import { uuidv7 } from "./uuid";

export const SUPPLIER_DOCUMENT_UNIQUE = "suppliers_tenant_document_unique";
/** Teto de lançamentos por mesclagem (RF10): acima disso a operação é recusada, sem mover nada. */
export const MERGE_ENTRY_LIMIT = 5000;

/** O que o ator enxerga: unidades, folha e CPF inteiro. Falso e vazio são o padrão seguro. */
export interface SuppliersScope {
  readonly unitIds: "all" | readonly string[];
  /** Lançamento de categoria sensível entra no total e na última compra (RF06.R3). */
  readonly includeSensitive: boolean;
  /** Dono e quem exporta dados veem o CPF inteiro; os outros veem mascarado (RF10.R2). */
  readonly revealCpf: boolean;
}

export interface SuppliersPeriod {
  readonly from: BusinessDate;
  readonly to: BusinessDate;
}

export interface SuppliersFilter extends SuppliersPeriod {
  readonly search?: string;
  readonly status: "active" | "inactive" | "all";
}

export interface MergeOptions {
  readonly now: Date;
  readonly period: SuppliersPeriod;
  /** Teto de lançamentos; o padrão é `MERGE_ENTRY_LIMIT` (os testes usam um valor baixo). */
  readonly limit?: number;
}

export type MergeFailure = DomainError | { readonly code: "MergeTooLarge"; readonly limit: number };

export interface SuppliersSettingsRepo {
  list(
    tenantId: string,
    filter: SuppliersFilter,
    scope: SuppliersScope,
  ): Promise<SupplierSettings[]>;
  /** `null`: id inexistente, de outra empresa ou já mesclado. */
  update(
    tenantId: string,
    actorId: string,
    id: string,
    patch: SupplierPatchInput,
    scope: SuppliersScope,
    period: SuppliersPeriod,
  ): Promise<Result<SupplierSettings, DomainError> | null>;
  /** Lançamentos da origem NO RECORTE do ator, fora da lixeira. `null`: origem ou destino ausente. */
  previewMerge(
    tenantId: string,
    sourceId: string,
    targetId: string,
    scope: SuppliersScope,
  ): Promise<Result<number, DomainError> | null>;
  /** `null`: origem ou destino inexistente (ou de outra empresa). Tudo ou nada. */
  merge(
    tenantId: string,
    actorId: string,
    sourceId: string,
    targetId: string,
    scope: SuppliersScope,
    options: MergeOptions,
  ): Promise<Result<SupplierSettings, MergeFailure> | null>;
}

type SupplierRow = typeof suppliers.$inferSelect;

const toDomain = (row: SupplierRow): Supplier => ({
  id: row.id,
  name: row.name,
  aliases: row.aliases,
  document: row.document,
  status: row.status as Supplier["status"],
  mergedIntoId: row.mergedIntoId,
});

const kindOf = (document: string | null): SupplierSettings["documentKind"] =>
  document === null ? null : document.length === 11 ? "cpf" : "cnpj";

/** CPF mascarado salvo para quem pode ver inteiro; CNPJ sempre inteiro. */
function shownDocument(document: string | null, reveal: boolean): string | null {
  if (document === null) return null;
  return document.length === 11 && !reveal ? maskCpf(document) : document;
}

/** Documento para a auditoria: nunca o CPF completo. */
const auditDocument = (document: string | null) => shownDocument(document, false);

interface Totals {
  readonly total: number;
  readonly last: string | null;
}

/**
 * Total gasto e última compra, somados pelo banco no recorte do ator: unidades, folha
 * (`sensitiveExpression`, falha fechado), sem lixeira, só despesa com fornecedor, por data de
 * negócio no período.
 */
async function totalsOf(
  tx: Transaction,
  ids: readonly string[],
  scope: SuppliersScope,
  period: SuppliersPeriod,
): Promise<Map<string, Totals>> {
  const out = new Map<string, Totals>();
  if (ids.length === 0) return out;
  const unitFilter =
    scope.unitIds === "all"
      ? sql`true`
      : sql`e.unit_id = any(${arrayLiteral(scope.unitIds)}::uuid[])`;
  const sensitiveFilter = scope.includeSensitive
    ? sql`true`
    : sql`not ${sql.raw(sensitiveExpression("e", "c"))}`;
  const result = await tx.execute<{ supplier_id: string; total: string; last: string | null }>(sql`
    select e.supplier_id, sum(e.amount_cents)::text as total, max(e.occurred_on)::text as last
      from entries e
      left join categories c on c.id = e.category_id
     where e.supplier_id = any(${arrayLiteral(ids)}::uuid[])
       and e.deleted_at is null
       and e.type = 'expense'
       and e.occurred_on between ${period.from}::date and ${period.to}::date
       and ${unitFilter}
       and ${sensitiveFilter}
     group by e.supplier_id`);
  for (const row of result.rows) {
    out.set(row.supplier_id, { total: Number(row.total), last: row.last });
  }
  return out;
}

function toSettings(
  row: SupplierRow,
  totals: Totals | undefined,
  scope: SuppliersScope,
): SupplierSettings {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    document: shownDocument(row.document, scope.revealCpf),
    documentKind: kindOf(row.document),
    status: row.status as SupplierSettings["status"],
    origin: row.origin as SupplierSettings["origin"],
    totalSpentCents: totals?.total ?? 0,
    lastPurchaseOn: totals?.last ?? null,
  };
}

async function settingsOf(
  tx: Transaction,
  row: SupplierRow,
  scope: SuppliersScope,
  period: SuppliersPeriod,
): Promise<SupplierSettings> {
  const totals = await totalsOf(tx, [row.id], scope, period);
  return toSettings(row, totals.get(row.id), scope);
}

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

const audited = (value: {
  name: string;
  aliases: readonly string[];
  document: string | null;
  status: string;
}) => ({
  name: value.name,
  aliases: value.aliases,
  document: auditDocument(value.document),
  status: value.status,
});

const matchesSearch = (row: SupplierRow, search: string, revealCpf: boolean) => {
  const key = normalizeName(search);
  if (key === "") return true;
  if (normalizeName(row.name).includes(key)) return true;
  if (row.aliases.some((alias) => normalizeName(alias).includes(key))) return true;
  const digits = search.replace(/\D/g, "");
  if (digits.length < 3 || row.document === null) return false;
  // CPF escondido não pode ser descoberto pela busca (oráculo, RF10.R2): só os dígitos que a
  // máscara mostra (7 a 11) entram na comparação.
  const searchable =
    !revealCpf && row.document.length === 11 ? row.document.slice(6) : row.document;
  return searchable.includes(digits);
};

export function createSuppliersSettingsRepo(db: Database): SuppliersSettingsRepo {
  /** Trava origem e destino em ordem de id (sem deadlock entre mesclagens opostas). */
  async function lockPair(tx: Transaction, a: string, b: string) {
    const rows = await tx
      .select()
      .from(suppliers)
      .where(inArray(suppliers.id, [a, b]))
      .orderBy(suppliers.id)
      .for("update");
    return { source: rows.find((r) => r.id === a), target: rows.find((r) => r.id === b) };
  }

  return {
    async list(tenantId, filter, scope) {
      return withTenant(db, tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), sql`${suppliers.mergedIntoId} is null`));
        const kept = rows
          .filter((row) => (filter.status === "all" ? true : row.status === filter.status))
          .filter((row) =>
            filter.search ? matchesSearch(row, filter.search, scope.revealCpf) : true,
          );
        const totals = await totalsOf(
          tx,
          kept.map((row) => row.id),
          scope,
          filter,
        );
        return kept
          .map((row) => toSettings(row, totals.get(row.id), scope))
          .sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      });
    },

    async update(tenantId, actorId, id, patch, scope, period) {
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const [current] = await tx
            .select()
            .from(suppliers)
            .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)))
            .for("update");
          if (!current || current.mergedIntoId !== null) return null;
          const others = await tx.select().from(suppliers).where(eq(suppliers.tenantId, tenantId));
          const valid = validateSupplierPatch(toDomain(current), patch, others.map(toDomain));
          if (!valid.ok) return valid;
          const next = {
            name: valid.value.name ?? current.name,
            aliases: valid.value.aliases ?? current.aliases,
            document: valid.value.document !== undefined ? valid.value.document : current.document,
            status: valid.value.status ?? current.status,
          };
          // "Mudou?" decide-se pelos valores reais: a máscara do CPF esconde parte dos dígitos.
          const changed =
            next.name !== current.name ||
            next.status !== current.status ||
            next.document !== current.document ||
            JSON.stringify(next.aliases) !== JSON.stringify(current.aliases);
          if (!changed) return ok(await settingsOf(tx, current, scope, period));
          const changes = diff(audited(current), audited(next)) ?? {
            before: { document: auditDocument(current.document) },
            after: { document: auditDocument(next.document) },
          };
          const [row] = await tx
            .update(suppliers)
            .set(next)
            .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)))
            .returning();
          if (!row) throw new Error("update de fornecedor sem retorno");
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "supplier.update",
            target: id,
            metadata: changes,
          });
          return ok(await settingsOf(tx, row, scope, period));
        });
      } catch (error) {
        if (isUniqueViolation(error, SUPPLIER_NAME_UNIQUE)) {
          return fail("NameTaken", { conflictId: id });
        }
        if (isUniqueViolation(error, SUPPLIER_DOCUMENT_UNIQUE)) {
          return fail("DocumentTaken", { conflictId: id });
        }
        throw error;
      }
    },

    async previewMerge(tenantId, sourceId, targetId, scope) {
      return withTenant(db, tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(suppliers)
          .where(
            and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, [sourceId, targetId])),
          );
        const source = rows.find((r) => r.id === sourceId);
        const target = rows.find((r) => r.id === targetId);
        if (!source || !target) return null;
        const plan = planSupplierMerge(toDomain(source), toDomain(target));
        if (!plan.ok) return plan;
        const unitFilter =
          scope.unitIds === "all"
            ? sql`true`
            : sql`e.unit_id = any(${arrayLiteral(scope.unitIds)}::uuid[])`;
        const sensitiveFilter = scope.includeSensitive
          ? sql`true`
          : sql`not ${sql.raw(sensitiveExpression("e", "c"))}`;
        const result = await tx.execute<{ n: string }>(sql`
          select count(*)::text as n
            from entries e
            left join categories c on c.id = e.category_id
           where e.supplier_id = ${sourceId}::uuid
             and e.deleted_at is null
             and ${unitFilter}
             and ${sensitiveFilter}`);
        return ok(Number(result.rows[0]?.n ?? 0));
      });
    },

    async merge(tenantId, actorId, sourceId, targetId, scope, options) {
      const limit = options.limit ?? MERGE_ENTRY_LIMIT;
      return withTenant(db, tenantId, async (tx) => {
        if (sourceId === targetId) {
          const [same] = await tx
            .select({ id: suppliers.id })
            .from(suppliers)
            .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, sourceId)));
          return same ? fail("SameSupplier") : null;
        }
        const { source, target } = await lockPair(tx, sourceId, targetId);
        if (!source || !target || source.tenantId !== tenantId || target.tenantId !== tenantId) {
          return null;
        }
        const plan = planSupplierMerge(toDomain(source), toDomain(target));
        if (!plan.ok) return plan;

        // Todos os lançamentos da origem, inclusive da lixeira e de unidades que o ator não vê.
        const rows = await tx
          .select()
          .from(entries)
          .where(and(eq(entries.tenantId, tenantId), eq(entries.supplierId, sourceId)))
          .limit(limit + 1)
          .for("update");
        if (rows.length > limit) return { ok: false, error: { code: "MergeTooLarge", limit } };

        const changes = [];
        for (const row of rows) {
          const change = reassignSupplier(toEntry(row), targetId, {
            actorId,
            channel: "web",
            at: options.now,
          });
          if (change.ok) changes.push(change.value);
        }
        if (changes.length > 0) {
          await tx
            .update(entries)
            .set({
              supplierId: targetId,
              version: sql`${entries.version} + 1`,
              updatedAt: options.now,
            })
            .where(
              and(
                eq(entries.tenantId, tenantId),
                inArray(
                  entries.id,
                  changes.map((c) => c.entry.id),
                ),
              ),
            );
          for (let i = 0; i < changes.length; i += 500) {
            await tx
              .insert(entryVersions)
              .values(changes.slice(i, i + 500).map((c) => versionValues(c)));
          }
        }

        // A origem sai primeiro: o documento dela deixa o índice único antes de ir ao destino.
        await tx
          .update(suppliers)
          .set({ status: plan.value.source.status, mergedIntoId: plan.value.source.mergedIntoId })
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, sourceId)));
        const [merged] = await tx
          .update(suppliers)
          .set({ aliases: plan.value.target.aliases, document: plan.value.target.document })
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, targetId)))
          .returning();
        if (!merged) throw new Error("update do destino da mesclagem sem retorno");
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId,
          actorId,
          action: "supplier.merge",
          target: targetId,
          metadata: {
            sourceId,
            targetId,
            moved: changes.length,
            sourceName: source.name,
            targetDocument: auditDocument(merged.document),
          },
        });
        return ok(await settingsOf(tx, merged, scope, options.period));
      });
    },
  };
}
