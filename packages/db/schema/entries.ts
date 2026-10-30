import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appendOnly, cents, createdAt, oneOf, primaryId, tenantIsolation } from "./_shared";
import { categories, paymentMethods, salesChannels, suppliers } from "./catalog";
import { inboundMessages } from "./messages";
import { tenantId, units, users } from "./tenants";

export const ENTRY_TYPES = ["expense", "revenue"] as const;
export const CHANNELS = ["whatsapp", "web", "import", "system"] as const;
export const VERSION_ACTIONS = ["create", "update", "delete", "restore"] as const;
/** Sinais que não impedem a gravação (RF12.R13). */
export const ENTRY_FLAGS = ["category_to_review", "possible_duplicate", "old_date"] as const;

/**
 * Lançamento. Nunca é apagado: `deleted_at` marca o soft delete e cada mudança gera uma
 * linha em `entry_versions`. Taxa e líquido são calculados no domínio (`@app/core`); o
 * banco só garante a consistência (`net = amount - fee`).
 */
export const entries = pgTable(
  "entries",
  {
    id: primaryId(),
    tenantId: tenantId(),
    unitId: uuid("unit_id").notNull(),
    type: text("type").notNull(),
    occurredOn: pgDate("occurred_on", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }),
    quantityUnit: text("quantity_unit"),
    amountCents: cents("amount_cents").notNull(),
    feePercentBp: integer("fee_percent_bp").notNull().default(0),
    feeFixedCents: cents("fee_fixed_cents").notNull().default(0),
    feeCents: cents("fee_cents").notNull().default(0),
    netCents: cents("net_cents").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    supplierId: uuid("supplier_id"),
    paymentMethodId: uuid("payment_method_id"),
    salesChannelId: uuid("sales_channel_id"),
    inboundMessageId: uuid("inbound_message_id"),
    /** Posição do lançamento dentro da mensagem de origem (uma mensagem pode gerar vários). */
    position: integer("position").notNull().default(0),
    /** Id da mensagem de confirmação enviada, usado para corrigir por reply. */
    confirmationWaMessageId: text("confirmation_wa_message_id"),
    aiConfidence: numeric("ai_confidence", { precision: 4, scale: 3, mode: "number" }),
    /** Sinais de revisão (RF12.R13): `ENTRY_FLAGS`. */
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("entries_tenant_id_id_unique").on(t.tenantId, t.id),
    // Reprocessar uma mensagem nunca duplica lançamentos.
    unique("entries_inbound_position_unique").on(t.inboundMessageId, t.position),
    // Chaves compostas: uma referência nunca aponta para dado de outro tenant.
    foreignKey({
      name: "entries_unit_fk",
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    foreignKey({
      name: "entries_supplier_fk",
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
    }),
    foreignKey({
      name: "entries_payment_method_fk",
      columns: [t.tenantId, t.paymentMethodId],
      foreignColumns: [paymentMethods.tenantId, paymentMethods.id],
    }),
    foreignKey({
      name: "entries_sales_channel_fk",
      columns: [t.tenantId, t.salesChannelId],
      foreignColumns: [salesChannels.tenantId, salesChannels.id],
    }),
    foreignKey({
      name: "entries_inbound_message_fk",
      columns: [t.tenantId, t.inboundMessageId],
      foreignColumns: [inboundMessages.tenantId, inboundMessages.id],
    }),
    index("entries_unit_date_idx").on(t.tenantId, t.unitId, t.occurredOn),
    index("entries_category_date_idx").on(t.tenantId, t.categoryId, t.occurredOn),
    // Não é único: uma confirmação cobre todos os lançamentos da mensagem (RF16.Obs2).
    index("entries_confirmation_idx")
      .on(t.tenantId, t.confirmationWaMessageId)
      .where(sql`${t.confirmationWaMessageId} is not null`),
    oneOf("entries_type_check", "type", ENTRY_TYPES),
    check("entries_amount_check", sql`${t.amountCents} > 0`),
    check("entries_fee_check", sql`${t.feeCents} >= 0 and ${t.feeCents} <= ${t.amountCents}`),
    check("entries_net_check", sql`${t.netCents} = ${t.amountCents} - ${t.feeCents}`),
    check("entries_fee_percent_check", sql`${t.feePercentBp} between 0 and 10000`),
    check("entries_fee_fixed_check", sql`${t.feeFixedCents} >= 0`),
    check("entries_quantity_check", sql`${t.quantity} is null or ${t.quantity} > 0`),
    check(
      "entries_confidence_check",
      sql`${t.aiConfidence} is null or ${t.aiConfidence} between 0 and 1`,
    ),
    tenantIsolation("entries"),
  ],
);

/** Histórico imutável: quem, quando, canal, antes e depois. O papel `app` só lê e acrescenta. */
export const entryVersions = pgTable(
  "entry_versions",
  {
    id: primaryId(),
    tenantId: tenantId(),
    entryId: uuid("entry_id").notNull(),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after").notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    channel: text("channel").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("entry_versions_entry_version_unique").on(t.entryId, t.version),
    foreignKey({
      name: "entry_versions_entry_fk",
      columns: [t.tenantId, t.entryId],
      foreignColumns: [entries.tenantId, entries.id],
    }),
    index("entry_versions_tenant_entry_idx").on(t.tenantId, t.entryId),
    oneOf("entry_versions_action_check", "action", VERSION_ACTIONS),
    oneOf("entry_versions_channel_check", "channel", CHANNELS),
    ...appendOnly("entry_versions"),
  ],
);
