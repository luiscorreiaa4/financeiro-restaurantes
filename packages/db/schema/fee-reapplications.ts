import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, primaryId, tenantIsolation } from "./_shared";
import { tenantId, users } from "./tenants";

export const FEE_REAPPLICATION_TARGET_KINDS = ["payment_method", "sales_channel"] as const;
export const FEE_REAPPLICATION_STATUSES = ["queued", "running", "done", "failed"] as const;

/** Nomes dos índices únicos; o repositório os usa para reconhecer a corrida (23505). */
export const FEE_REAPPLICATIONS_CLIENT_REQUEST_UNIQUE = "fee_reapplications_client_request_unique";
export const FEE_REAPPLICATIONS_ACTIVE_TARGET_UNIQUE = "fee_reapplications_active_target_unique";

/**
 * Reaplicação da taxa atual a lançamentos passados (F6a, RF08 e RF09, Alteração). Guarda o alvo
 * (forma ou canal, sem chave estrangeira: o alvo é polimórfico e o worker o relê sob RLS), o período
 * pela data do lançamento, a taxa vista na prévia (o job confere se ainda vale) e o resultado.
 * O papel `app` não apaga: a linha fica como registro.
 */
export const feeReapplications = pgTable(
  "fee_reapplications",
  {
    id: primaryId(),
    tenantId: tenantId(),
    targetKind: text("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    feePercentBp: integer("fee_percent_bp").notNull(),
    feeFixedCents: bigint("fee_fixed_cents", { mode: "number" }).notNull(),
    status: text("status").notNull().default("queued"),
    /** Ex.: `rate_changed`. */
    errorCode: text("error_code"),
    matched: integer("matched"),
    updated: integer("updated"),
    skipped: integer("skipped"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    clientRequestId: uuid("client_request_id"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    tenantIsolation("fee_reapplications"),
    oneOf("fee_reapplications_target_kind_check", "target_kind", FEE_REAPPLICATION_TARGET_KINDS),
    oneOf("fee_reapplications_status_check", "status", FEE_REAPPLICATION_STATUSES),
    check("fee_reapplications_period_check", sql`${t.toDate} >= ${t.fromDate}`),
    check("fee_reapplications_period_max_check", sql`${t.toDate} - ${t.fromDate} <= 366`),
    check(
      "fee_reapplications_fee_check",
      sql`${t.feePercentBp} between 0 and 10000 and ${t.feeFixedCents} >= 0`,
    ),
    // RF26.R3: chave por usuário e empresa; a de outro usuário ou de outra empresa não colide.
    uniqueIndex(FEE_REAPPLICATIONS_CLIENT_REQUEST_UNIQUE)
      .on(t.tenantId, t.createdBy, t.clientRequestId)
      .where(sql`${t.clientRequestId} is not null`),
    // Um só job ativo por alvo.
    uniqueIndex(FEE_REAPPLICATIONS_ACTIVE_TARGET_UNIQUE)
      .on(t.tenantId, t.targetKind, t.targetId)
      .where(sql`${t.status} in ('queued', 'running')`),
    // Última reaplicação do alvo.
    index("fee_reapplications_target_created_idx").on(
      t.tenantId,
      t.targetKind,
      t.targetId,
      sql`${t.createdAt} desc`,
    ),
  ],
);
