import {
  CATALOG_STATUSES,
  CATEGORY_STATUSES,
  PAYMENT_METHOD_TYPES,
  SALES_CHANNEL_TYPES,
} from "@app/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  appRole,
  cents,
  createdAt,
  currentTenant,
  oneOf,
  primaryId,
  tenantIsolation,
} from "./_shared";
import { tenantId, tenants } from "./tenant-base";

export const CATEGORY_KINDS = ["revenue", "expense", "investment", "deduction"] as const;
export const CATEGORY_NATURES = ["fixed", "variable"] as const;

/** `tenant_id` nulo = categoria padrão do sistema (somente leitura para o papel `app`). */
export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    nature: text("nature"),
    dreGroup: text("dre_group").notNull(),
    /** Folha de pagamento e afins: só o papel `owner` age sobre lançamentos dela. */
    isSensitive: boolean("is_sensitive").notNull().default(false),
    /** Lançamentos da categoria pedem quantidade e unidade de medida (RF07.R7). */
    requiresQuantity: boolean("requires_quantity").notNull().default(false),
    /** Termos que ajudam a IA a classificar, até 30 (RF07.R8). */
    supportWords: text("support_words").array().notNull().default(sql`'{}'::text[]`),
    /** ATIVA ou INATIVA (RF07.R10). A origem SISTEMA/EMPRESA é `tenant_id` nulo ou não. */
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("categories_status_check", "status", CATEGORY_STATUSES),
    check(
      "categories_support_words_check",
      sql`coalesce(array_length(${t.supportWords}, 1), 0) <= 30`,
    ),
    unique("categories_scope_parent_name_unique")
      .on(t.tenantId, t.parentId, t.name)
      .nullsNotDistinct(),
    index("categories_tenant_idx").on(t.tenantId),
    oneOf("categories_kind_check", "kind", CATEGORY_KINDS),
    check(
      "categories_nature_check",
      sql.raw(`nature is null or nature in (${CATEGORY_NATURES.map((n) => `'${n}'`).join(", ")})`),
    ),
    pgPolicy("categories_read", {
      as: "permissive",
      for: "select",
      to: appRole,
      using: sql`tenant_id is null or tenant_id = ${currentTenant}`,
    }),
    // Escrita só no próprio tenant: as categorias do sistema (tenant nulo) não são alteráveis.
    tenantIsolation("categories"),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: primaryId(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    document: text("document"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    unique("suppliers_tenant_id_id_unique").on(t.tenantId, t.id),
    index("suppliers_tenant_name_idx").on(t.tenantId, t.name),
    tenantIsolation("suppliers"),
  ],
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: primaryId(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** Pontos-base: 320 = 3,20%. */
    feePercentBp: integer("fee_percent_bp").notNull().default(0),
    feeFixedCents: cents("fee_fixed_cents").notNull().default(0),
    /** DINHEIRO, PIX, DEBITO, CREDITO, VOUCHER, BOLETO, TRANSFERENCIA ou OUTRO (RF08). */
    type: text("type").notNull().default("other"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("active"),
    /** Forma usada quando a mensagem diz só "cartão" (RF12.R8); uma por empresa. */
    isDefaultCard: boolean("is_default_card").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("payment_methods_tenant_id_id_unique").on(t.tenantId, t.id),
    oneOf("payment_methods_type_check", "type", PAYMENT_METHOD_TYPES),
    oneOf("payment_methods_status_check", "status", CATALOG_STATUSES),
    check("payment_methods_aliases_check", sql`coalesce(array_length(${t.aliases}, 1), 0) <= 10`),
    uniqueIndex("payment_methods_default_card_unique")
      .on(t.tenantId)
      .where(sql`${t.isDefaultCard}`),
    unique("payment_methods_tenant_name_unique").on(t.tenantId, t.name),
    check("payment_methods_fee_percent_check", sql`${t.feePercentBp} between 0 and 10000`),
    check("payment_methods_fee_fixed_check", sql`${t.feeFixedCents} >= 0`),
    tenantIsolation("payment_methods"),
  ],
);

export const salesChannels = pgTable(
  "sales_channels",
  {
    id: primaryId(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    feePercentBp: integer("fee_percent_bp").notNull().default(0),
    /** SALAO, DELIVERY_PROPRIO, APLICATIVO, RETIRADA ou OUTRO (RF09). */
    type: text("type").notNull().default("other"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sales_channels_tenant_id_id_unique").on(t.tenantId, t.id),
    oneOf("sales_channels_type_check", "type", SALES_CHANNEL_TYPES),
    oneOf("sales_channels_status_check", "status", CATALOG_STATUSES),
    check("sales_channels_aliases_check", sql`coalesce(array_length(${t.aliases}, 1), 0) <= 10`),
    unique("sales_channels_tenant_name_unique").on(t.tenantId, t.name),
    check("sales_channels_fee_percent_check", sql`${t.feePercentBp} between 0 and 10000`),
    tenantIsolation("sales_channels"),
  ],
);
