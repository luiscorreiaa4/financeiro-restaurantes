import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authRole, createdAt, oneOf, primaryId } from "./_shared";
import { users } from "./tenants";

/**
 * Tabelas do Better Auth (F1a). Globais, sem `tenant_id`: só o papel `app_auth` acessa, com
 * política aberta (`using (true)`); `app` e `app_ingest` não têm privilégio nenhum.
 * Ids são `uuid` com UUID v7 (o createAuth usa `generateId: "uuid"`).
 */
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

const fullAccess = (table: string) =>
  pgPolicy(`${table}_auth`, { for: "all", to: authRole, using: sql`true`, withCheck: sql`true` });

export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** "Manter conectado" (RF02.R5): 30 dias renovando; sem ele, 12 h sem uso. */
    keepConnected: boolean("keep_connected").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), fullAccess("sessions")],
);

export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    accountId: text("account_id").notNull(),
    /** `credential` para senha. */
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Hash scrypt da senha. */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId), fullAccess("accounts")],
);

export const verifications = pgTable(
  "verifications",
  {
    id: primaryId(),
    identifier: text("identifier").notNull(),
    /** Código de e-mail em hash (`storeOTP: "hashed"`). */
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier), fullAccess("verifications")],
);

export const AUTH_EVENTS = [
  "otp_sent",
  "login",
  "login_failed",
  "password_locked",
  "logout",
  // Autocadastro (F1b, RF01).
  "signup_code_sent",
  "signup_verified",
  "signup_completed",
  "company_created",
] as const;

/** Histórico de acessos (RF02): só acréscimo, sem e-mail em claro (só hash). */
export const authAudit = pgTable(
  "auth_audit",
  {
    id: primaryId(),
    userId: uuid("user_id").references(() => users.id),
    emailHash: text("email_hash"),
    event: text("event").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  () => [
    oneOf("auth_audit_event_check", "event", AUTH_EVENTS),
    pgPolicy("auth_audit_auth_select", { for: "select", to: authRole, using: sql`true` }),
    pgPolicy("auth_audit_auth_insert", { for: "insert", to: authRole, withCheck: sql`true` }),
  ],
);

/** `code`: código de 6 dígitos enviado por e-mail; `notice`: e-mail já cadastrado recebe só um aviso. */
export const SIGNUP_VERIFICATION_KINDS = ["code", "notice"] as const;

/**
 * Códigos do autocadastro (RF01) e o comprovante que libera a gravação da conta. Global, sem
 * `tenant_id`: só o papel `app_auth` acessa. Código e comprovante só em hash.
 */
export const signupVerifications = pgTable(
  "signup_verifications",
  {
    id: primaryId(),
    /** Normalizado (minúsculas, sem espaços nas pontas), como `users.email`. */
    email: text("email").notNull(),
    kind: text("kind").notNull(),
    /** Hash do código; nulo em `notice`. */
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Hash do comprovante devolvido depois do código certo. */
    receiptHash: text("receipt_hash"),
    receiptExpiresAt: timestamp("receipt_expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("signup_verifications_email_created_idx").on(t.email, t.createdAt),
    index("signup_verifications_ip_created_idx").on(t.ip, t.createdAt),
    oneOf("signup_verifications_kind_check", "kind", SIGNUP_VERIFICATION_KINDS),
    check(
      "signup_verifications_code_hash_check",
      sql`(${t.kind} = 'code') = (${t.codeHash} is not null)`,
    ),
    check(
      "signup_verifications_email_normalized_check",
      sql`${t.email} = lower(btrim(${t.email}))`,
    ),
    fullAccess("signup_verifications"),
  ],
);
