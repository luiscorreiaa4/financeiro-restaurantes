import { EXPORT_CONTENTS, EXPORT_FORMATS, EXPORT_STATUSES } from "@app/core/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, primaryId, tenantIsolation } from "./_shared";
import { tenantId, users } from "./tenants";

/** Nome do índice único da idempotência do pedido; o repositório o usa para reconhecer a corrida. */
export const EXPORTS_CLIENT_REQUEST_UNIQUE = "exports_client_request_unique";

/**
 * Pedido de exportação (F5, RF29). O arquivo gerado fica no armazenamento de arquivos, em `file_key`
 * (`exports/<tenantId>/<exportId>.<ext>`); o banco guarda só o pedido, a situação e os metadados. O papel
 * `app` não apaga: o arquivo expira (`file_deleted_at`), a linha fica como registro.
 */
export const exports = pgTable(
  "exports",
  {
    id: primaryId(),
    tenantId: tenantId(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    /** `'all'` ou o id da unidade ativa no momento do pedido. */
    unitChoice: text("unit_choice").notNull(),
    format: text("format").notNull(),
    content: text("content").notNull(),
    /** `EntryFilters` já validado, sem ordem. */
    filters: jsonb("filters").notNull(),
    status: text("status").notNull(),
    rowCount: integer("row_count"),
    fileSize: integer("file_size"),
    fileKey: text("file_key"),
    /**
     * O arquivo foi gerado por quem via folha (`scope.includeSensitive` na geração). Conservador: o
     * link e o download só saem para quem ainda vê folha (RF06.R3).
     */
    includedSensitive: boolean("included_sensitive").notNull().default(false),
    /** `forbidden`, `too_many_rows` ou `generation_failed`. */
    errorCode: text("error_code"),
    clientRequestId: uuid("client_request_id").notNull(),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    fileDeletedAt: timestamp("file_deleted_at", { withTimezone: true }),
  },
  (t) => [
    tenantIsolation("exports"),
    oneOf("exports_format_check", "format", EXPORT_FORMATS),
    oneOf("exports_content_check", "content", EXPORT_CONTENTS),
    oneOf("exports_status_check", "status", EXPORT_STATUSES),
    // Uma chave por usuário e empresa: a de outro usuário ou de outra empresa não colide (RF26.R3).
    uniqueIndex(EXPORTS_CLIENT_REQUEST_UNIQUE).on(t.tenantId, t.requestedBy, t.clientRequestId),
    // Lista "minhas exportações": as mais recentes primeiro.
    index("exports_user_created_idx").on(t.tenantId, t.requestedBy, sql`${t.createdAt} desc`),
  ],
);
