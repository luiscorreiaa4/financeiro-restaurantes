import { sql } from "drizzle-orm";
import { bigint, check, pgPolicy, pgRole, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "../src/uuid";

/** Papéis criados em `docker/postgres/init.sql`; o drizzle-kit não os gerencia. */
export const appRole = pgRole("app").existing();
export const ingestRole = pgRole("app_ingest").existing();

/**
 * Tenant da transação, definido por `withTenant`. `nullif` evita erro de cast quando o
 * parâmetro volta vazio depois de uma transação; sem tenant a comparação é NULL e nenhuma
 * linha passa.
 */
export const currentTenant = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

export const primaryId = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Dinheiro em centavos: `bigint` no banco, `number` seguro no TypeScript. */
export const cents = (name: string) => bigint(name, { mode: "number" });

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** `coluna in ('a','b')` com valores estáticos do código (nunca entrada de usuário). */
export const oneOf = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(", ")})`));

/** Política padrão: o papel `app` só vê e grava linhas do próprio tenant. */
export const tenantIsolation = (table: string) =>
  pgPolicy(`${table}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sql`tenant_id = ${currentTenant}`,
    withCheck: sql`tenant_id = ${currentTenant}`,
  });

/** Tabelas de histórico: o papel `app` lê e acrescenta, nunca altera nem apaga. */
export const appendOnly = (table: string) => [
  pgPolicy(`${table}_tenant_select`, {
    as: "permissive",
    for: "select",
    to: appRole,
    using: sql`tenant_id = ${currentTenant}`,
  }),
  pgPolicy(`${table}_tenant_insert`, {
    as: "permissive",
    for: "insert",
    to: appRole,
    withCheck: sql`tenant_id = ${currentTenant}`,
  }),
];

/** Leitura irrestrita para o papel de ingestão (identificação do remetente). */
export const ingestCanRead = (table: string) =>
  pgPolicy(`${table}_ingest_select`, {
    as: "permissive",
    for: "select",
    to: ingestRole,
    using: sql`true`,
  });
