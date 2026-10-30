import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, primaryId, tenantIsolation } from "./_shared";
import { inboundMessages } from "./messages";
import { tenantId, users } from "./tenants";

export const FISCAL_SOURCES = ["qrcode_sefaz", "ai_reading"] as const;

/**
 * Nota fiscal lida por foto (RF14). A chave de acesso (44 dígitos) é única por empresa: a mesma
 * nota nunca gera lançamento duplicado (RF14.R2). `needs_recheck` marca a nota lida só pela IA,
 * para nova conferência na SEFAZ (RF14.R5).
 */
export const fiscalDocuments = pgTable(
  "fiscal_documents",
  {
    id: primaryId(),
    tenantId: tenantId(),
    accessKey: text("access_key").notNull(),
    inboundMessageId: uuid("inbound_message_id").notNull(),
    source: text("source").notNull(),
    needsRecheck: boolean("needs_recheck").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("fiscal_documents_tenant_key_unique").on(t.tenantId, t.accessKey),
    foreignKey({
      name: "fiscal_documents_inbound_message_fk",
      columns: [t.tenantId, t.inboundMessageId],
      foreignColumns: [inboundMessages.tenantId, inboundMessages.id],
    }),
    index("fiscal_documents_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("fiscal_documents_key_check", sql`${t.accessKey} ~ '^[0-9]{44}$'`),
    oneOf("fiscal_documents_source_check", "source", FISCAL_SOURCES),
    tenantIsolation("fiscal_documents"),
  ],
);
