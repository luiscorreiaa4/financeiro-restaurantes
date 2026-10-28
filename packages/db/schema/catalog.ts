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
import { tenantId, tenants } from "./tenants";

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
    createdAt: createdAt(),
  },
  (t) => [
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
    createdAt: createdAt(),
  },
  (t) => [
    unique("payment_methods_tenant_id_id_unique").on(t.tenantId, t.id),
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
    createdAt: createdAt(),
  },
  (t) => [
    unique("sales_channels_tenant_id_id_unique").on(t.tenantId, t.id),
    unique("sales_channels_tenant_name_unique").on(t.tenantId, t.name),
    check("sales_channels_fee_percent_check", sql`${t.feePercentBp} between 0 and 10000`),
    tenantIsolation("sales_channels"),
  ],
);
