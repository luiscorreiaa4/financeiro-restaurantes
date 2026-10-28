import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
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
  appendOnly,
  createdAt,
  ingestCanRead,
  ingestRole,
  oneOf,
  primaryId,
  tenantIsolation,
} from "./_shared";
import { tenantId, tenants, users } from "./tenants";

export const INBOUND_TYPES = ["text", "audio", "image", "unsupported"] as const;
export const INBOUND_STATUSES = [
  "received",
  "processing",
  "needs_answer",
  "processed",
  "failed",
] as const;

/**
 * Mensagem bruta do WhatsApp. `tenant_id` é nulo entre o recebimento e a identificação do
 * remetente: nesse intervalo só o papel `app_ingest` enxerga a linha.
 */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: primaryId(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    waMessageId: text("wa_message_id").notNull().unique(),
    waId: text("wa_id"),
    waUserId: text("wa_user_id"),
    type: text("type").notNull(),
    text: text("text"),
    mediaKey: text("media_key"),
    transcription: text("transcription"),
    /** Payload original da Meta, gravado antes de qualquer interpretação. */
    raw: jsonb("raw").notNull(),
    status: text("status").notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Alvo das chaves estrangeiras compostas de `entries`.
    unique("inbound_messages_tenant_id_id_unique").on(t.tenantId, t.id),
    index("inbound_messages_tenant_received_idx").on(t.tenantId, t.receivedAt),
    index("inbound_messages_status_idx").on(t.status),
    oneOf("inbound_messages_type_check", "type", INBOUND_TYPES),
    oneOf("inbound_messages_status_check", "status", INBOUND_STATUSES),
    tenantIsolation("inbound_messages"),
    pgPolicy("inbound_messages_ingest_select", {
      as: "permissive",
      for: "select",
      to: ingestRole,
      using: sql`true`,
    }),
    pgPolicy("inbound_messages_ingest_insert", {
      as: "permissive",
      for: "insert",
      to: ingestRole,
      withCheck: sql`true`,
    }),
    pgPolicy("inbound_messages_ingest_update", {
      as: "permissive",
      for: "update",
      to: ingestRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

/**
 * Eventos de `statuses` da Meta (enviada, entregue, lida, falhou) sobre mensagens que nós
 * enviamos. É por aqui que aparecem erros como o 130497. `tenant_id` é nulo até a mensagem
 * enviada ser atribuída a um tenant; até lá só o papel `app_ingest` enxerga a linha. Só
 * acrescenta: um mesmo `(wa_message_id, status)` nunca é gravado duas vezes.
 */
export const whatsappStatusEvents = pgTable(
  "whatsapp_status_events",
  {
    id: primaryId(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    /** Id da mensagem enviada por nós (`statuses[].id`). */
    waMessageId: text("wa_message_id").notNull(),
    status: text("status").notNull(),
    recipientId: text("recipient_id"),
    errorCode: integer("error_code"),
    errorTitle: text("error_title"),
    errorDetail: text("error_detail"),
    /** Momento do evento segundo a Meta. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    raw: jsonb("raw").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("whatsapp_status_events_message_status_unique").on(t.waMessageId, t.status),
    index("whatsapp_status_events_tenant_received_idx").on(t.tenantId, t.receivedAt),
    index("whatsapp_status_events_error_idx").on(t.errorCode),
    ...appendOnly("whatsapp_status_events"),
    ingestCanRead("whatsapp_status_events"),
    pgPolicy("whatsapp_status_events_ingest_insert", {
      as: "permissive",
      for: "insert",
      to: ingestRole,
      withCheck: sql`true`,
    }),
  ],
);

export const pendingQuestions = pgTable(
  "pending_questions",
  {
    id: primaryId(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    inboundMessageId: uuid("inbound_message_id").notNull(),
    draft: jsonb("draft").notNull(),
    question: text("question").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "pending_questions_inbound_message_fk",
      columns: [t.tenantId, t.inboundMessageId],
      foreignColumns: [inboundMessages.tenantId, inboundMessages.id],
    }),
    index("pending_questions_tenant_user_idx").on(t.tenantId, t.userId, t.expiresAt),
    tenantIsolation("pending_questions"),
  ],
);
