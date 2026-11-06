import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { appRole, createdAt, currentTenant, ingestCanRead, primaryId } from "./_shared";

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
