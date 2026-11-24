import type { Entry, FeeReapplicationCatalog, SalesChannelType } from "@app/core";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  auditLog,
  entries,
  FEE_REAPPLICATIONS_ACTIVE_TARGET_UNIQUE,
  FEE_REAPPLICATIONS_CLIENT_REQUEST_UNIQUE,
  feeReapplications,
  paymentMethods,
  salesChannels,
} from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { toEntry } from "./entry-store";
import { isUniqueViolation } from "./panel-entry-writer";

/**
 * Linha `queued` mais velha que isto é órfã (a API caiu entre o commit e o enqueue): o job de
 * `expireInSeconds` = 1800 já teria acabado. Constante única, acima desse prazo.
 */
export const FEE_REAPPLY_STALE_QUEUED_MINUTES = 35;

export type FeeTargetKind = "payment_method" | "sales_channel";
export type FeeReapplicationStatus = "queued" | "running" | "done" | "failed";

export interface FeeReapplicationRecord {
  id: string;
  tenantId: string;
  targetKind: FeeTargetKind;
  targetId: string;
  from: string;
  to: string;
  feePercentBp: number;
  feeFixedCents: number;
  status: FeeReapplicationStatus;
  errorCode: string | null;
  matched: number | null;
  updated: number | null;
  skipped: number | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface FeeReapplicationScope {
  readonly targetKind: FeeTargetKind;
  readonly targetId: string;
  readonly from: string;
  readonly to: string;
}

export interface FeeTargetRate {
  readonly feePercentBp: number;
  readonly feeFixedCents: number;
}

export type CreateFeeReapplicationResult =
  | { kind: "created"; record: FeeReapplicationRecord }
  | { kind: "replayed"; record: FeeReapplicationRecord }
  | { kind: "in_progress"; record: FeeReapplicationRecord }
  | { kind: "unknown_target" };

export interface FeeReapplicationTotals {
  matched: number;
  updated: number;
  skipped: number;
}

export interface FeeReapplyBatch {
  entries: Entry[];
  catalog: FeeReapplicationCatalog;
}

/** Reaplicação de taxa (F6a, RF08 e RF09): linha de controle, estados e leitura dos lotes. */
export interface FeeReapplyRepo {
  /** Taxa atual do alvo; `null` se o alvo não existe na empresa (RLS) ou é de outro tipo. */
  findTarget(tenantId: string, kind: FeeTargetKind, id: string): Promise<FeeTargetRate | null>;
  create(
    tenantId: string,
    input: {
      id: string;
      createdBy: string;
      targetKind: FeeTargetKind;
      targetId: string;
      from: string;
      to: string;
      clientRequestId: string;
    },
  ): Promise<CreateFeeReapplicationResult>;
  latest(tenantId: string, kind: FeeTargetKind, id: string): Promise<FeeReapplicationRecord | null>;
  get(tenantId: string, id: string): Promise<FeeReapplicationRecord | null>;
  /** Receitas não excluídas do alvo no período, por id crescente, depois de `after`. */
  loadBatch(
    tenantId: string,
    scope: FeeReapplicationScope,
    after: string | null,
    limit: number,
  ): Promise<FeeReapplyBatch>;
  /**
   * Relê lançamentos pelo id (releitura do lote depois da guarda de versão) com os MESMOS filtros
   * do `loadBatch`: quem saiu do recorte (forma ou canal, data, tipo, excluído) não volta.
   */
  loadEntries(
    tenantId: string,
    scope: FeeReapplicationScope,
    ids: readonly string[],
  ): Promise<FeeReapplyBatch>;
  /** queued -> running. */
  markRunning(tenantId: string, id: string): Promise<boolean>;
  /**
   * Soma os contadores do lote à linha `running` (retry soma ao que já existe: o total final é o
   * real). `false` se a linha não está `running`.
   */
  addProgress(tenantId: string, id: string, delta: FeeReapplicationTotals): Promise<boolean>;
  /** running -> done (só o estado; os totais vêm de `addProgress`). */
  markDone(tenantId: string, id: string): Promise<boolean>;
  /** queued ou running -> failed. Só código curto, nunca mensagem de erro. */
  markFailed(tenantId: string, id: string, errorCode: string): Promise<boolean>;
}

type Row = typeof feeReapplications.$inferSelect;

const toRecord = (row: Row): FeeReapplicationRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  targetKind: row.targetKind as FeeTargetKind,
  targetId: row.targetId,
  from: row.fromDate,
  to: row.toDate,
  feePercentBp: row.feePercentBp,
  feeFixedCents: row.feeFixedCents,
  status: row.status as FeeReapplicationStatus,
  errorCode: row.errorCode,
  matched: row.matched,
  updated: row.updated,
  skipped: row.skipped,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
});

async function targetRate(
  tx: Transaction,
  kind: FeeTargetKind,
  id: string,
): Promise<FeeTargetRate | null> {
  if (kind === "payment_method") {
    const [row] = await tx
      .select({ bp: paymentMethods.feePercentBp, fixed: paymentMethods.feeFixedCents })
      .from(paymentMethods)
      .where(eq(paymentMethods.id, id))
      .limit(1);
    return row ? { feePercentBp: row.bp, feeFixedCents: row.fixed } : null;
  }
  const [row] = await tx
    .select({ bp: salesChannels.feePercentBp })
    .from(salesChannels)
    .where(eq(salesChannels.id, id))
    .limit(1);
  return row ? { feePercentBp: row.bp, feeFixedCents: 0 } : null;
}

async function loadCatalog(tx: Transaction): Promise<FeeReapplicationCatalog> {
  const methods = await tx
    .select({
      id: paymentMethods.id,
      bp: paymentMethods.feePercentBp,
      fixed: paymentMethods.feeFixedCents,
    })
    .from(paymentMethods);
  const channels = await tx
    .select({ id: salesChannels.id, type: salesChannels.type, bp: salesChannels.feePercentBp })
    .from(salesChannels);
  return {
    paymentMethods: new Map(
      methods.map((m) => [m.id, { feePercentBp: m.bp, feeFixedCents: m.fixed }]),
    ),
    salesChannels: new Map(
      channels.map((c) => [c.id, { type: c.type as SalesChannelType, feePercentBp: c.bp }]),
    ),
  };
}

/** Recorte da reaplicação: receita não excluída do alvo, no período (data do lançamento). */
const inScope = (tenantId: string, scope: FeeReapplicationScope) =>
  and(
    eq(entries.tenantId, tenantId),
    eq(entries.type, "revenue"),
    isNull(entries.deletedAt),
    gte(entries.occurredOn, scope.from),
    lte(entries.occurredOn, scope.to),
    scope.targetKind === "payment_method"
      ? eq(entries.paymentMethodId, scope.targetId)
      : eq(entries.salesChannelId, scope.targetId),
  );

const activeOf = (tx: Transaction, kind: FeeTargetKind, id: string) =>
  tx
    .select()
    .from(feeReapplications)
    .where(
      and(
        eq(feeReapplications.targetKind, kind),
        eq(feeReapplications.targetId, id),
        inArray(feeReapplications.status, ["queued", "running"]),
      ),
    )
    .limit(1);

export function createFeeReapplyRepo(db: Database): FeeReapplyRepo {
  const create = async (
    tenantId: string,
    input: Parameters<FeeReapplyRepo["create"]>[1],
    retried = false,
  ): Promise<CreateFeeReapplicationResult> => {
    type Inner = CreateFeeReapplicationResult;
    const byKey = async (tx: Transaction) => {
      const [row] = await tx
        .select()
        .from(feeReapplications)
        .where(
          and(
            eq(feeReapplications.createdBy, input.createdBy),
            eq(feeReapplications.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      return row ? toRecord(row) : null;
    };
    const run = async (tx: Transaction): Promise<Inner> => {
      // Um withTenant só: chave, alvo, ativo, gravação e auditoria.
      const replay = await byKey(tx);
      if (replay) return { kind: "replayed", record: replay };
      const rate = await targetRate(tx, input.targetKind, input.targetId);
      if (rate === null) return { kind: "unknown_target" };
      // Órfã (API caiu antes do enqueue): libera o alvo, guardado em `queued`.
      await tx
        .update(feeReapplications)
        .set({ status: "failed", errorCode: "stale", finishedAt: sql`now()` })
        .where(
          and(
            eq(feeReapplications.targetKind, input.targetKind),
            eq(feeReapplications.targetId, input.targetId),
            eq(feeReapplications.status, "queued"),
            sql`${feeReapplications.createdAt} < now() - make_interval(mins => ${FEE_REAPPLY_STALE_QUEUED_MINUTES})`,
          ),
        );
      const [active] = await activeOf(tx, input.targetKind, input.targetId);
      if (active) return { kind: "in_progress", record: toRecord(active) };
      const [row] = await tx
        .insert(feeReapplications)
        .values({
          id: input.id,
          tenantId,
          targetKind: input.targetKind,
          targetId: input.targetId,
          fromDate: input.from,
          toDate: input.to,
          feePercentBp: rate.feePercentBp,
          feeFixedCents: rate.feeFixedCents,
          status: "queued",
          createdBy: input.createdBy,
          clientRequestId: input.clientRequestId,
        })
        .returning();
      if (!row) throw new Error("insert em fee_reapplications não devolveu a linha");
      await tx.insert(auditLog).values({
        id: input.id,
        tenantId,
        actorId: input.createdBy,
        action: "fee_reapplication_requested",
        target: input.id,
        metadata: {
          targetKind: input.targetKind,
          targetId: input.targetId,
          from: input.from,
          to: input.to,
        },
      });
      return { kind: "created", record: toRecord(row) };
    };

    try {
      return await withTenant(db, tenantId, run);
    } catch (error) {
      // 23505 desfaz a transação inteira: relê numa transação nova, fora do withTenant acima.
      if (isUniqueViolation(error, FEE_REAPPLICATIONS_CLIENT_REQUEST_UNIQUE)) {
        const record = await withTenant(db, tenantId, byKey);
        if (record) return { kind: "replayed", record };
        // A outra transação desfez: tenta uma vez mais antes de propagar.
        if (!retried) return create(tenantId, input, true);
      }
      if (isUniqueViolation(error, FEE_REAPPLICATIONS_ACTIVE_TARGET_UNIQUE)) {
        const [active] = await withTenant(db, tenantId, (tx) =>
          activeOf(tx, input.targetKind, input.targetId),
        );
        if (active) return { kind: "in_progress", record: toRecord(active) };
      }
      throw error;
    }
  };

  return {
    findTarget: (tenantId, kind, id) => withTenant(db, tenantId, (tx) => targetRate(tx, kind, id)),

    create: (tenantId, input) => create(tenantId, input),

    async latest(tenantId, kind, id) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(feeReapplications)
          .where(and(eq(feeReapplications.targetKind, kind), eq(feeReapplications.targetId, id)))
          .orderBy(desc(feeReapplications.createdAt), desc(feeReapplications.id))
          .limit(1),
      );
      return row ? toRecord(row) : null;
    },

    async get(tenantId, id) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(feeReapplications).where(eq(feeReapplications.id, id)).limit(1),
      );
      return row ? toRecord(row) : null;
    },

    loadBatch: (tenantId, scope, after, limit) =>
      withTenant(db, tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(entries)
          .where(and(inScope(tenantId, scope), after === null ? undefined : gt(entries.id, after)))
          .orderBy(asc(entries.id))
          .limit(limit);
        return { entries: rows.map(toEntry), catalog: await loadCatalog(tx) };
      }),

    loadEntries: (tenantId, scope, ids) =>
      withTenant(db, tenantId, async (tx) => {
        const rows =
          ids.length === 0
            ? []
            : await tx
                .select()
                .from(entries)
                .where(and(inScope(tenantId, scope), inArray(entries.id, [...ids])))
                .orderBy(asc(entries.id));
        return { entries: rows.map(toEntry), catalog: await loadCatalog(tx) };
      }),

    async markRunning(tenantId, id) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .update(feeReapplications)
          .set({ status: "running" })
          .where(and(eq(feeReapplications.id, id), eq(feeReapplications.status, "queued")))
          .returning({ id: feeReapplications.id }),
      );
      return rows.length === 1;
    },

    async addProgress(tenantId, id, delta) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .update(feeReapplications)
          .set({
            matched: sql`coalesce(${feeReapplications.matched}, 0) + ${delta.matched}`,
            updated: sql`coalesce(${feeReapplications.updated}, 0) + ${delta.updated}`,
            skipped: sql`coalesce(${feeReapplications.skipped}, 0) + ${delta.skipped}`,
          })
          .where(and(eq(feeReapplications.id, id), eq(feeReapplications.status, "running")))
          .returning({ id: feeReapplications.id }),
      );
      return rows.length === 1;
    },

    async markDone(tenantId, id) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .update(feeReapplications)
          .set({
            status: "done",
            // Sem lote com dado, os contadores ficam 0 (não nulos) na linha terminada.
            matched: sql`coalesce(${feeReapplications.matched}, 0)`,
            updated: sql`coalesce(${feeReapplications.updated}, 0)`,
            skipped: sql`coalesce(${feeReapplications.skipped}, 0)`,
            finishedAt: sql`now()`,
          })
          .where(and(eq(feeReapplications.id, id), eq(feeReapplications.status, "running")))
          .returning({ id: feeReapplications.id }),
      );
      return rows.length === 1;
    },

    async markFailed(tenantId, id, errorCode) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .update(feeReapplications)
          .set({ status: "failed", errorCode, finishedAt: sql`now()` })
          .where(
            and(
              eq(feeReapplications.id, id),
              inArray(feeReapplications.status, ["queued", "running"]),
            ),
          )
          .returning({ id: feeReapplications.id }),
      );
      return rows.length === 1;
    },
  };
}
