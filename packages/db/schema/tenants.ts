import {
  ADDITIONAL_PERMISSIONS,
  BRAZILIAN_STATES,
  MEMBERSHIP_STATUSES,
  ROLES,
  UNIT_STATUSES,
} from "@app/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
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
  authRole,
  createdAt,
  currentTenant,
  ingestCanRead,
  oneOf,
  primaryId,
  tenantIsolation,
} from "./_shared";
import { salesChannels } from "./catalog";
import { tenantId, tenants } from "./tenant-base";

export { tenantId, tenants };

export const units = pgTable(
  "units",
  {
    id: primaryId(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    /** Formas curtas de citar a unidade no WhatsApp, até 5 (RF04.R2). */
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    /** Só dígitos. Opcional (RF04.R3). */
    cnpj: text("cnpj"),
    /** Obrigatórios para unidades novas (RF04); nulos só nas unidades anteriores à E11. */
    city: text("city"),
    uf: text("uf"),
    /** ATIVA ou INATIVA (RF04.R5). */
    status: text("status").notNull().default("active"),
    /** Canal usado quando uma receita chega sem canal (RF04.R6, DD-08). */
    defaultSalesChannelId: uuid("default_sales_channel_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "units_default_sales_channel_fk",
      columns: [t.tenantId, t.defaultSalesChannelId],
      foreignColumns: [salesChannels.tenantId, salesChannels.id],
    }),
    oneOf("units_status_check", "status", UNIT_STATUSES),
    check("units_aliases_check", sql`coalesce(array_length(${t.aliases}, 1), 0) <= 5`),
    check(
      "units_uf_check",
      sql.raw(`uf is null or uf in (${BRAZILIAN_STATES.map((state) => `'${state}'`).join(", ")})`),
    ),
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
    /** Opcional: quem entra só pelo painel pode não ter WhatsApp (continua único quando existe). */
    phoneE164: text("phone_e164").unique(),
    /** Colunas do Better Auth. */
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Bloqueio de senha (RF02): 5 erros seguidos travam por 15 min. */
    failedPasswordAttempts: integer("failed_password_attempts").notNull().default(0),
    passwordLockedUntil: timestamp("password_locked_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // E-mail guardado já normalizado (minúsculas, sem espaços nas pontas): o único é de verdade.
    check("users_email_normalized_check", sql`${t.email} = lower(btrim(${t.email}))`),
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
    // Login (Better Auth): acha o usuário e marca e-mail verificado/último acesso, sem tenant.
    pgPolicy("users_auth_select", { for: "select", to: authRole, using: sql`true` }),
    pgPolicy("users_auth_update", {
      for: "update",
      to: authRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
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
    role: text("role").notNull(),
    /**
     * Unidades de acesso (RF05.R5): `true` = TODAS, inclusive as futuras; senão a lista está em
     * `membership_units`. O Dono tem sempre TODAS.
     */
    allUnits: boolean("all_units").notNull().default(false),
    /** Unidade usada quando o colaborador não diz qual (RF05.R6); deve estar entre as de acesso. */
    defaultUnitId: uuid("default_unit_id"),
    /** CONVIDADO, ATIVO ou DESATIVADO (RF05.R8). */
    status: text("status").notNull().default("active"),
    /** Lista de `ADDITIONAL_PERMISSIONS` (RF05.R7). */
    permissions: jsonb("permissions").notNull().default(sql`'[]'::jsonb`),
    /** O Dono liberou o painel (RF05.R3); o contador sempre tem. */
    panelAccess: boolean("panel_access").notNull().default(false),
    invitedBy: uuid("invited_by").references(() => users.id),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    /** Preenchido = acesso retirado. Nada é apagado: o vínculo e o histórico continuam. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("memberships_tenant_user_unique").on(t.tenantId, t.userId),
    // Alvo da chave composta de `membership_units`.
    unique("memberships_tenant_id_id_unique").on(t.tenantId, t.id),
    foreignKey({
      name: "memberships_default_unit_fk",
      columns: [t.tenantId, t.defaultUnitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    oneOf("memberships_role_check", "role", ROLES),
    oneOf("memberships_status_check", "status", MEMBERSHIP_STATUSES),
    check(
      "memberships_permissions_check",
      sql.raw(
        `jsonb_typeof(permissions) = 'array' and permissions <@ '${JSON.stringify(ADDITIONAL_PERMISSIONS)}'::jsonb`,
      ),
    ),
    tenantIsolation("memberships"),
    ingestCanRead("memberships"),
    // O envio do código confere se há vínculo ativo (RF02.R1); só leitura.
    pgPolicy("memberships_auth_select", { for: "select", to: authRole, using: sql`true` }),
  ],
);

/** Lista de unidades de acesso dos vínculos que não têm TODAS (RF05.R5). */
export const membershipUnits = pgTable(
  "membership_units",
  {
    id: primaryId(),
    tenantId: tenantId(),
    membershipId: uuid("membership_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("membership_units_membership_unit_unique").on(t.membershipId, t.unitId),
    foreignKey({
      name: "membership_units_membership_fk",
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: "membership_units_unit_fk",
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    tenantIsolation("membership_units"),
    ingestCanRead("membership_units"),
  ],
);
