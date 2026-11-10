import { ACCOUNT_STATUSES, REVENUE_RANGES, SEGMENTS } from "@app/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  appRole,
  authCanInsert,
  authRole,
  createdAt,
  currentTenant,
  ingestCanRead,
  oneOf,
  primaryId,
} from "./_shared";

/**
 * Pessoa. Global (não pertence a um tenant); o vínculo com restaurantes é `memberships`.
 * Fica aqui, e não em `tenants.ts`, porque `tenants.terms_accepted_by` aponta para ela.
 */
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
    // Autocadastro (RF01): cria o Dono.
    authCanInsert("users"),
  ],
);

export const tenants = pgTable(
  "tenants",
  {
    id: primaryId(),
    /** Nome fantasia (RF01). */
    name: text("name").notNull(),
    /** TESTE = `trial` (RF37). */
    plan: text("plan").notNull().default("trial"),
    /** Razão social, opcional (RF01). */
    legalName: text("legal_name"),
    /** Só dígitos, opcional; único entre contas não encerradas (RF01.R3, CA04). */
    cnpj: text("cnpj"),
    /** RF01.R4. */
    segment: text("segment"),
    /** RF01.R6. */
    revenueRange: text("revenue_range"),
    /** Situação da Conta (RF01.R16). */
    status: text("status").notNull().default("active"),
    /** Período de teste (RF01.R15). */
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** Aceite dos termos, da privacidade e do DPA, com as versões aceitas (RF01.R13, CA06). */
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    termsVersion: text("terms_version"),
    privacyVersion: text("privacy_version"),
    dpaVersion: text("dpa_version"),
    termsAcceptedBy: uuid("terms_accepted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("tenants_status_check", "status", ACCOUNT_STATUSES),
    oneOf("tenants_segment_check", "segment", SEGMENTS),
    oneOf("tenants_revenue_range_check", "revenue_range", REVENUE_RANGES),
    check("tenants_cnpj_check", sql`${t.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$'`),
    // Também vale em cadastros simultâneos: o segundo recebe 23505 com este nome (CA04).
    uniqueIndex("tenants_cnpj_open_unique")
      .on(t.cnpj)
      .where(sql`${t.cnpj} is not null and ${t.status} <> 'closed'`),
    pgPolicy("tenants_self_select", {
      as: "permissive",
      for: "select",
      to: appRole,
      using: sql`id = ${currentTenant}`,
    }),
    ingestCanRead("tenants"),
    authCanInsert("tenants"),
  ],
);

/** Coluna `tenant_id` padrão das tabelas de cliente. */
export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);
