import {
  type CatalogRow,
  type CatalogStatus,
  type DomainError,
  fail,
  isProtectedCatalogName,
  ok,
  type PaymentMethodType,
  type Result,
  type SalesChannelType,
  validatePaymentMethod,
  validateSalesChannel,
} from "@app/core";
import type {
  PaymentMethodInput,
  PaymentMethodPatch,
  PaymentMethodSettings,
  SalesChannelPatch,
  SalesChannelSettings,
  SalesChannelSettingsInput,
} from "@app/core/contracts";
import { and, asc, eq } from "drizzle-orm";
import { auditLog, paymentMethods, salesChannels, units } from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { isUniqueViolation } from "./panel-entry-writer";
import { uuidv7 } from "./uuid";

export interface CatalogFilter {
  readonly type?: string;
  readonly status?: CatalogStatus;
}

export const PAYMENT_METHOD_NAME_UNIQUE = "payment_methods_tenant_name_unique";
export const SALES_CHANNEL_NAME_UNIQUE = "sales_channels_tenant_name_unique";

export interface CatalogSettingsRepo {
  listPaymentMethods(tenantId: string, f: CatalogFilter): Promise<PaymentMethodSettings[]>;
  createPaymentMethod(
    tenantId: string,
    actorId: string,
    input: PaymentMethodInput,
  ): Promise<Result<PaymentMethodSettings, DomainError>>;
  /** `null`: id inexistente ou de outra empresa. */
  updatePaymentMethod(
    tenantId: string,
    actorId: string,
    id: string,
    patch: PaymentMethodPatch,
  ): Promise<Result<PaymentMethodSettings, DomainError> | null>;
  listSalesChannels(tenantId: string, f: CatalogFilter): Promise<SalesChannelSettings[]>;
  createSalesChannel(
    tenantId: string,
    actorId: string,
    input: SalesChannelSettingsInput,
  ): Promise<Result<SalesChannelSettings, DomainError>>;
  updateSalesChannel(
    tenantId: string,
    actorId: string,
    id: string,
    patch: SalesChannelPatch,
  ): Promise<Result<SalesChannelSettings, DomainError> | null>;
}

type PaymentRow = typeof paymentMethods.$inferSelect;
type ChannelRow = typeof salesChannels.$inferSelect;

const toPayment = (row: PaymentRow): PaymentMethodSettings => ({
  id: row.id,
  name: row.name,
  type: row.type as PaymentMethodType,
  feePercentBp: row.feePercentBp,
  feeFixedCents: row.feeFixedCents,
  aliases: row.aliases,
  status: row.status as CatalogStatus,
  isDefaultCard: row.isDefaultCard,
  protected: isProtectedCatalogName("payment_method", row.name),
});

const toChannel = (row: ChannelRow): SalesChannelSettings => ({
  id: row.id,
  name: row.name,
  type: row.type as SalesChannelType,
  feePercentBp: row.feePercentBp,
  aliases: row.aliases,
  status: row.status as CatalogStatus,
  protected: isProtectedCatalogName("sales_channel", row.name),
});

const catalogRows = (rows: readonly { id: string; name: string; aliases: string[] }[]) =>
  rows.map((r): CatalogRow => ({ id: r.id, name: r.name, aliases: r.aliases }));

/** Só os campos cujo valor mudou, no antes e no depois. */
function diff<T extends object>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } | null {
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

/** O Drizzle não aceita `readonly string[]`; `undefined` em `aliases` é ignorado no SET. */
const mutableSet = <T extends { aliases?: readonly string[] }>(after: T) => ({
  ...after,
  aliases: after.aliases ? [...after.aliases] : undefined,
});

const withoutMeta = <T extends { id: string; protected: boolean }>(value: T) => {
  const { id: _id, protected: _protected, ...rest } = value;
  return rest;
};

export function createCatalogSettingsRepo(db: Database): CatalogSettingsRepo {
  // Serializa as escritas da empresa: trava todas as linhas da tabela, sempre na mesma ordem.
  const lockPayments = (tx: Transaction, tenantId: string) =>
    tx
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.tenantId, tenantId))
      .orderBy(asc(paymentMethods.id))
      .for("update");
  const lockChannels = (tx: Transaction, tenantId: string) =>
    tx
      .select()
      .from(salesChannels)
      .where(eq(salesChannels.tenantId, tenantId))
      .orderBy(asc(salesChannels.id))
      .for("update");

  /** Nome repetido pego pelo índice (corrida): descobre o outro cadastro em transação nova. */
  async function nameTaken(
    tenantId: string,
    kind: "payment" | "channel",
    name: string,
    selfId: string,
  ): Promise<DomainError> {
    const rows = await withTenant(db, tenantId, (tx) =>
      kind === "payment"
        ? tx
            .select({ id: paymentMethods.id })
            .from(paymentMethods)
            .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.name, name)))
        : tx
            .select({ id: salesChannels.id })
            .from(salesChannels)
            .where(and(eq(salesChannels.tenantId, tenantId), eq(salesChannels.name, name))),
    );
    return { code: "NameTaken", conflictId: rows.find((r) => r.id !== selfId)?.id ?? selfId };
  }

  return {
    async listPaymentMethods(tenantId, f) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.tenantId, tenantId))
          .orderBy(asc(paymentMethods.name)),
      );
      return rows
        .filter(
          (r) => (f.type ? r.type === f.type : true) && (f.status ? r.status === f.status : true),
        )
        .map(toPayment);
    },

    async createPaymentMethod(tenantId, actorId, input) {
      const id = uuidv7();
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const existing = await lockPayments(tx, tenantId);
          const valid = validatePaymentMethod(input, { existing: catalogRows(existing) });
          if (!valid.ok) return valid;
          if (valid.value.isDefaultCard) {
            await tx
              .update(paymentMethods)
              .set({ isDefaultCard: false })
              .where(
                and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.isDefaultCard, true)),
              );
          }
          const [row] = await tx
            .insert(paymentMethods)
            .values({ id, tenantId, ...valid.value, aliases: [...valid.value.aliases] })
            .returning();
          if (!row) throw new Error("insert de forma de pagamento sem retorno");
          const settings = toPayment(row);
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "payment_method.create",
            target: id,
            metadata: { after: withoutMeta(settings) },
          });
          return ok(settings);
        });
      } catch (error) {
        if (isUniqueViolation(error, PAYMENT_METHOD_NAME_UNIQUE)) {
          return { ok: false, error: await nameTaken(tenantId, "payment", input.name.trim(), id) };
        }
        throw error;
      }
    },

    async updatePaymentMethod(tenantId, actorId, id, patch) {
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const existing = await lockPayments(tx, tenantId);
          const current = existing.find((r) => r.id === id);
          if (!current) return null;
          const before = toPayment(current);
          const { id: _i, protected: _p, ...base } = before;
          const valid = validatePaymentMethod(
            { ...base, ...patch },
            { existing: catalogRows(existing), currentId: id, currentName: current.name },
          );
          if (!valid.ok) return valid;
          // Desmarcar o cartão padrão sem marcar outro deixaria a empresa sem padrão (RF08).
          if (current.isDefaultCard && patch.isDefaultCard === false) {
            return fail("DefaultCardInactive");
          }
          const changes = diff(base, valid.value);
          if (!changes) return ok(before);
          if (valid.value.isDefaultCard && !current.isDefaultCard) {
            await tx
              .update(paymentMethods)
              .set({ isDefaultCard: false })
              .where(
                and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.isDefaultCard, true)),
              );
          }
          const [row] = await tx
            .update(paymentMethods)
            .set(mutableSet(changes.after))
            .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.id, id)))
            .returning();
          if (!row) throw new Error("update de forma de pagamento sem retorno");
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "payment_method.update",
            target: id,
            metadata: changes,
          });
          return ok(toPayment(row));
        });
      } catch (error) {
        if (isUniqueViolation(error, PAYMENT_METHOD_NAME_UNIQUE)) {
          return {
            ok: false,
            error: await nameTaken(tenantId, "payment", patch.name?.trim() ?? "", id),
          };
        }
        throw error;
      }
    },

    async listSalesChannels(tenantId, f) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(salesChannels)
          .where(eq(salesChannels.tenantId, tenantId))
          .orderBy(asc(salesChannels.name)),
      );
      return rows
        .filter(
          (r) => (f.type ? r.type === f.type : true) && (f.status ? r.status === f.status : true),
        )
        .map(toChannel);
    },

    async createSalesChannel(tenantId, actorId, input) {
      const id = uuidv7();
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const existing = await lockChannels(tx, tenantId);
          const valid = validateSalesChannel(input, { existing: catalogRows(existing) });
          if (!valid.ok) return valid;
          const [row] = await tx
            .insert(salesChannels)
            .values({ id, tenantId, ...valid.value, aliases: [...valid.value.aliases] })
            .returning();
          if (!row) throw new Error("insert de canal sem retorno");
          const settings = toChannel(row);
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "sales_channel.create",
            target: id,
            metadata: { after: withoutMeta(settings) },
          });
          return ok(settings);
        });
      } catch (error) {
        if (isUniqueViolation(error, SALES_CHANNEL_NAME_UNIQUE)) {
          return { ok: false, error: await nameTaken(tenantId, "channel", input.name.trim(), id) };
        }
        throw error;
      }
    },

    async updateSalesChannel(tenantId, actorId, id, patch) {
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const existing = await lockChannels(tx, tenantId);
          const current = existing.find((r) => r.id === id);
          if (!current) return null;
          const before = toChannel(current);
          const { id: _i, protected: _p, ...base } = before;
          const valid = validateSalesChannel(
            { ...base, ...patch },
            { existing: catalogRows(existing), currentId: id, currentName: current.name },
          );
          if (!valid.ok) return valid;
          const changes = diff(base, valid.value);
          if (!changes) return ok(before);
          if (valid.value.status === "inactive" && current.status !== "inactive") {
            const using = await tx
              .select({ id: units.id })
              .from(units)
              .where(and(eq(units.tenantId, tenantId), eq(units.defaultSalesChannelId, id)))
              .limit(1);
            if (using.length > 0) return fail("ChannelIsUnitDefault");
          }
          const [row] = await tx
            .update(salesChannels)
            .set(mutableSet(changes.after))
            .where(and(eq(salesChannels.tenantId, tenantId), eq(salesChannels.id, id)))
            .returning();
          if (!row) throw new Error("update de canal sem retorno");
          await tx.insert(auditLog).values({
            id: uuidv7(),
            tenantId,
            actorId,
            action: "sales_channel.update",
            target: id,
            metadata: changes,
          });
          return ok(toChannel(row));
        });
      } catch (error) {
        if (isUniqueViolation(error, SALES_CHANNEL_NAME_UNIQUE)) {
          return {
            ok: false,
            error: await nameTaken(tenantId, "channel", patch.name?.trim() ?? "", id),
          };
        }
        throw error;
      }
    },
  };
}
