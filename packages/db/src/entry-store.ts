import {
  type AiUsageRecord,
  type Entry,
  type EntryChange,
  type EntryFlag,
  type EntryStore,
  money,
  type PendingQuestionRecord,
} from "@app/core";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  aiUsage,
  categories,
  entries,
  entryVersions,
  fiscalDocuments,
  inboundMessages,
  outboundMessages,
  paymentMethods,
  pendingQuestions,
  salesChannels,
  suppliers,
  units,
  users,
} from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { uuidv7 } from "./uuid";

type EntryRow = typeof entries.$inferSelect;

function asMoney(value: number) {
  const result = money(value);
  if (!result.ok) throw new Error("valor em centavos inválido vindo do banco");
  return result.value;
}

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    unitId: row.unitId,
    type: row.type as Entry["type"],
    occurredOn: row.occurredOn,
    description: row.description,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    amountCents: asMoney(row.amountCents),
    feePercentBp: row.feePercentBp,
    feeFixedCents: row.feeFixedCents,
    feeCents: asMoney(row.feeCents),
    netCents: asMoney(row.netCents),
    categoryId: row.categoryId,
    supplierId: row.supplierId,
    paymentMethodId: row.paymentMethodId,
    salesChannelId: row.salesChannelId,
    inboundMessageId: row.inboundMessageId,
    flags: row.flags as EntryFlag[],
    confirmationWaMessageId: row.confirmationWaMessageId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  };
}

function entryValues(entry: Entry, position: number) {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    unitId: entry.unitId,
    type: entry.type,
    occurredOn: entry.occurredOn,
    description: entry.description,
    quantity: entry.quantity,
    quantityUnit: entry.quantityUnit,
    amountCents: entry.amountCents,
    feePercentBp: entry.feePercentBp,
    feeFixedCents: entry.feeFixedCents,
    feeCents: entry.feeCents,
    netCents: entry.netCents,
    categoryId: entry.categoryId,
    supplierId: entry.supplierId,
    paymentMethodId: entry.paymentMethodId,
    salesChannelId: entry.salesChannelId,
    inboundMessageId: entry.inboundMessageId,
    position,
    flags: [...entry.flags],
    version: entry.version,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt,
  };
}

function versionValues(change: EntryChange) {
  const { version } = change;
  return {
    id: uuidv7(),
    tenantId: version.tenantId,
    entryId: version.entryId,
    version: version.version,
    action: version.action,
    before: version.before,
    after: version.after,
    changedBy: version.changedBy,
    channel: version.channel,
    changedAt: version.changedAt,
  };
}

function usageValues(
  tenantId: string,
  inboundMessageId: string | null,
  usage: readonly AiUsageRecord[],
) {
  return usage.map((item) => ({
    id: uuidv7(),
    tenantId,
    inboundMessageId,
    provider: item.provider,
    model: item.model,
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    cacheReadTokens: item.cacheReadTokens,
    cacheWriteTokens: item.cacheWriteTokens,
    audioSeconds: item.audioSeconds,
    costUsdMicros: item.costUsdMicros,
  }));
}

async function insertUsage(
  tx: Transaction,
  tenantId: string,
  inboundMessageId: string | null,
  usage: readonly AiUsageRecord[],
) {
  if (usage.length > 0)
    await tx.insert(aiUsage).values(usageValues(tenantId, inboundMessageId, usage));
}

/** O lançamento mudou entre a leitura e a gravação: desfaz a transação inteira. */
class StaleEntryError extends Error {
  constructor() {
    super("lançamento alterado por outra operação");
    this.name = "StaleEntryError";
  }
}

/** Adaptador de `EntryStore`: papel `app`, sempre dentro de `withTenant` (regra 2). */
export function createEntryStore(db: Database): EntryStore {
  return {
    async loadCatalog(tenantId) {
      return withTenant(db, tenantId, async (tx) => {
        const [categoryRows, supplierRows, paymentRows, channelRows, unitRows] = await Promise.all([
          tx
            .select({ id: categories.id, name: categories.name, kind: categories.kind })
            .from(categories)
            .where(or(eq(categories.tenantId, tenantId), isNull(categories.tenantId))),
          tx
            .select({ id: suppliers.id, name: suppliers.name, aliases: suppliers.aliases })
            .from(suppliers)
            .where(eq(suppliers.tenantId, tenantId)),
          tx
            .select({
              id: paymentMethods.id,
              name: paymentMethods.name,
              feePercentBp: paymentMethods.feePercentBp,
              feeFixedCents: paymentMethods.feeFixedCents,
            })
            .from(paymentMethods)
            .where(eq(paymentMethods.tenantId, tenantId)),
          tx
            .select({
              id: salesChannels.id,
              name: salesChannels.name,
              feePercentBp: salesChannels.feePercentBp,
            })
            .from(salesChannels)
            .where(eq(salesChannels.tenantId, tenantId)),
          tx
            .select({ id: units.id, name: units.name })
            .from(units)
            .where(eq(units.tenantId, tenantId)),
        ]);
        return {
          categories: categoryRows.map((row) => ({
            ...row,
            kind: row.kind as "revenue" | "expense" | "investment" | "deduction",
          })),
          suppliers: supplierRows.map((row) => ({ ...row, aliases: row.aliases ?? [] })),
          paymentMethods: paymentRows,
          salesChannels: channelRows,
          units: unitRows,
        };
      });
    },

    async findRecentEntries(tenantId, since) {
      return withTenant(db, tenantId, (tx) =>
        tx
          .select({
            inboundMessageId: entries.inboundMessageId,
            amountCents: entries.amountCents,
            supplierId: entries.supplierId,
            description: entries.description,
            occurredOn: entries.occurredOn,
          })
          .from(entries)
          .where(
            and(
              eq(entries.tenantId, tenantId),
              isNull(entries.deletedAt),
              gt(entries.createdAt, since),
            ),
          ),
      );
    },

    async findEntriesByInbound(tenantId, inboundMessageId) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(entries)
          .where(
            and(eq(entries.tenantId, tenantId), eq(entries.inboundMessageId, inboundMessageId)),
          )
          .orderBy(entries.position),
      );
      return rows.map(toEntry);
    },

    async findLatestActiveBatch({ tenantId, userId, since }) {
      return withTenant(db, tenantId, async (tx) => {
        const [latest] = await tx
          .select({ inboundMessageId: entries.inboundMessageId })
          .from(entries)
          .where(
            and(
              eq(entries.tenantId, tenantId),
              eq(entries.createdBy, userId),
              isNull(entries.deletedAt),
              gt(entries.createdAt, since),
            ),
          )
          .orderBy(desc(entries.createdAt), desc(entries.id))
          .limit(1);
        if (!latest?.inboundMessageId) return [];
        const rows = await tx
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.tenantId, tenantId),
              eq(entries.inboundMessageId, latest.inboundMessageId),
              isNull(entries.deletedAt),
            ),
          )
          .orderBy(entries.position);
        return rows.map(toEntry);
      });
    },

    async register(registration) {
      const { tenantId } = registration;
      await withTenant(db, tenantId, async (tx) => {
        if (registration.closePendingQuestion) {
          await tx
            .update(pendingQuestions)
            .set({ status: registration.closePendingQuestion.status })
            .where(
              and(
                eq(pendingQuestions.tenantId, tenantId),
                eq(pendingQuestions.id, registration.closePendingQuestion.id),
              ),
            );
        }
        if (registration.newSuppliers.length > 0) {
          await tx.insert(suppliers).values(
            registration.newSuppliers.map((supplier) => ({
              id: supplier.id,
              tenantId,
              name: supplier.name,
            })),
          );
        }
        for (const { position, change } of registration.entries) {
          await tx.insert(entries).values(entryValues(change.entry, position));
          await tx.insert(entryVersions).values(versionValues(change));
        }
        if (registration.fiscalDocument) {
          await tx.insert(fiscalDocuments).values({
            id: registration.fiscalDocument.id,
            tenantId,
            accessKey: registration.fiscalDocument.accessKey,
            inboundMessageId: registration.inboundMessageId,
            source: registration.fiscalDocument.source,
            needsRecheck: registration.fiscalDocument.needsRecheck,
            createdBy: registration.userId,
          });
        }
        await insertUsage(tx, tenantId, registration.inboundMessageId, registration.usage);
        if (registration.openPendingQuestion) {
          // Pergunta velha que ninguém respondeu: sai de cena para a nova poder abrir.
          await tx
            .update(pendingQuestions)
            .set({ status: "expired" })
            .where(
              and(
                eq(pendingQuestions.tenantId, tenantId),
                eq(pendingQuestions.userId, registration.userId),
                eq(pendingQuestions.status, "open"),
                lte(pendingQuestions.expiresAt, sql`now()`),
              ),
            );
          await tx.insert(pendingQuestions).values({
            id: registration.openPendingQuestion.id,
            tenantId,
            userId: registration.userId,
            inboundMessageId: registration.inboundMessageId,
            draft: registration.openPendingQuestion.draft,
            question: registration.openPendingQuestion.question,
            expiresAt: registration.openPendingQuestion.expiresAt,
          });
        }
      });
    },

    async applyChanges(tenantId, changes) {
      return withTenant(db, tenantId, async (tx) => {
        for (const { entry, version } of changes) {
          // Guarda de versão: só aplica se ninguém mexeu no lançamento desde que o lemos.
          const updated = await tx
            .update(entries)
            .set({
              unitId: entry.unitId,
              type: entry.type,
              occurredOn: entry.occurredOn,
              description: entry.description,
              quantity: entry.quantity,
              quantityUnit: entry.quantityUnit,
              amountCents: entry.amountCents,
              feePercentBp: entry.feePercentBp,
              feeFixedCents: entry.feeFixedCents,
              feeCents: entry.feeCents,
              netCents: entry.netCents,
              categoryId: entry.categoryId,
              supplierId: entry.supplierId,
              paymentMethodId: entry.paymentMethodId,
              salesChannelId: entry.salesChannelId,
              flags: [...entry.flags],
              version: entry.version,
              updatedAt: entry.updatedAt,
              deletedAt: entry.deletedAt,
            })
            .where(
              and(
                eq(entries.tenantId, tenantId),
                eq(entries.id, entry.id),
                eq(entries.version, entry.version - 1),
              ),
            )
            .returning({ id: entries.id });
          if (updated.length === 0) throw new StaleEntryError();
          await tx.insert(entryVersions).values(versionValues({ entry, version }));
        }
        return true;
      }).catch((error: unknown) => {
        if (error instanceof StaleEntryError) return false;
        throw error;
      });
    },

    async setConfirmation(tenantId, inboundMessageId, waMessageId) {
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(entries)
          .set({ confirmationWaMessageId: waMessageId })
          .where(
            and(
              eq(entries.tenantId, tenantId),
              eq(entries.inboundMessageId, inboundMessageId),
              isNull(entries.confirmationWaMessageId),
            ),
          ),
      );
    },

    async findFiscalDocument(tenantId, accessKey) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ registeredAt: fiscalDocuments.createdAt, userName: users.name })
          .from(fiscalDocuments)
          .innerJoin(users, eq(users.id, fiscalDocuments.createdBy))
          .where(
            and(eq(fiscalDocuments.tenantId, tenantId), eq(fiscalDocuments.accessKey, accessKey)),
          )
          .limit(1),
      );
      return row ?? null;
    },

    async hasOutbound(tenantId, inboundMessageId, purpose) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ id: outboundMessages.id })
          .from(outboundMessages)
          .where(
            and(
              eq(outboundMessages.tenantId, tenantId),
              eq(outboundMessages.inboundMessageId, inboundMessageId),
              eq(outboundMessages.purpose, purpose),
            ),
          )
          .limit(1),
      );
      return rows.length > 0;
    },

    async loadInboundText(tenantId, inboundMessageId) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ text: inboundMessages.text, transcription: inboundMessages.transcription })
          .from(inboundMessages)
          .where(
            and(eq(inboundMessages.tenantId, tenantId), eq(inboundMessages.id, inboundMessageId)),
          )
          .limit(1),
      );
      return row ? (row.transcription ?? row.text) : null;
    },

    async findOpenPendingQuestion({ tenantId, userId, now }) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(pendingQuestions)
          .where(
            and(
              eq(pendingQuestions.tenantId, tenantId),
              eq(pendingQuestions.userId, userId),
              eq(pendingQuestions.status, "open"),
              gt(pendingQuestions.expiresAt, now),
            ),
          )
          .limit(1),
      );
      const record: PendingQuestionRecord | null = row
        ? {
            id: row.id,
            inboundMessageId: row.inboundMessageId,
            draft: row.draft,
            question: row.question,
            expiresAt: row.expiresAt,
          }
        : null;
      return record;
    },

    async closePendingQuestion(tenantId, id, status) {
      await withTenant(db, tenantId, (tx) =>
        tx
          .update(pendingQuestions)
          .set({ status })
          .where(
            and(
              eq(pendingQuestions.tenantId, tenantId),
              eq(pendingQuestions.id, id),
              eq(pendingQuestions.status, "open"),
            ),
          ),
      );
    },

    async recordAiUsage({ tenantId, inboundMessageId, usage }) {
      await withTenant(db, tenantId, (tx) => insertUsage(tx, tenantId, inboundMessageId, usage));
    },

    async sumAiUsageForUser({ tenantId, userId }) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({
            calls: sql<number>`count(*)::int`,
            cost: sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::bigint`,
          })
          .from(aiUsage)
          .innerJoin(
            inboundMessages,
            and(
              eq(inboundMessages.tenantId, aiUsage.tenantId),
              eq(inboundMessages.id, aiUsage.inboundMessageId),
            ),
          )
          .where(and(eq(aiUsage.tenantId, tenantId), eq(inboundMessages.userId, userId))),
      );
      return { calls: Number(row?.calls ?? 0), costUsdMicros: Number(row?.cost ?? 0) };
    },
  };
}
