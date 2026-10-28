import { ROLES } from "@app/core";
import { sql } from "drizzle-orm";
import {
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  appRole,
  createdAt,
  currentTenant,
  ingestCanRead,
  oneOf,
  primaryId,
  tenantIsolation,
} from "./_shared";

export const tenants = pgTable(
  "tenants",
  {
    id: primaryId(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("trial"),
    createdAt: createdAt(),
  },
  () => [
    pgPolicy("tenants_self_select", {
      as: "permissive",
      for: "select",
      to: appRole,
      using: sql`id = ${currentTenant}`,
    }),
    ingestCanRead("tenants"),
  ],
);

/** Coluna `tenant_id` padrão das tabelas de cliente. */
export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

export const units = pgTable(
  "units",
  {
    id: primaryId(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    createdAt: createdAt(),
  },
  (t) => [
    // Alvo das chaves estrangeiras compostas: impede referência a unidade de outro tenant.
    unique("units_tenant_id_id_unique").on(t.tenantId, t.id),
    unique("units_tenant_name_unique").on(t.tenantId, t.name),
    tenantIsolation("units"),
    ingestCanRead("units"),
  ],
);

/** Pessoa. Global (não pertence a um tenant); o vínculo com restaurantes é `memberships`. */
export const users = pgTable(
  "users",
  {
    id: primaryId(),
    name: text("name").notNull(),
    email: text("email").unique(),
    phoneE164: text("phone_e164").notNull().unique(),
    createdAt: createdAt(),
  },
  () => [
    pgPolicy("users_same_tenant_select", {
      as: "permissive",
      for: "select",
      to: appRole,
      using: sql`exists (
        select 1 from memberships m
        where m.user_id = users.id and m.tenant_id = ${currentTenant}
      )`,
    }),
    ingestCanRead("users"),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: primaryId(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Nulo = todas as unidades. */
    unitId: uuid("unit_id"),
    role: text("role").notNull(),
    permissions: jsonb("permissions").notNull().default({}),
    /** Preenchido = acesso retirado. Nada é apagado: o vínculo e o histórico continuam. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("memberships_tenant_user_unique").on(t.tenantId, t.userId),
    foreignKey({
      name: "memberships_unit_fk",
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    oneOf("memberships_role_check", "role", ROLES),
    tenantIsolation("memberships"),
    ingestCanRead("memberships"),
  ],
);
