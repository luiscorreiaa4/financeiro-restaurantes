import { foreignKey, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { appendOnly, cents, createdAt, primaryId } from "./_shared";
import { inboundMessages } from "./messages";
import { tenantId, users } from "./tenants";

/** Custo de IA por tenant (regra 8). Só acrescenta. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: primaryId(),
    tenantId: tenantId(),
    inboundMessageId: uuid("inbound_message_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    /** Custo estimado em micro-dólares (1 US$ = 1.000.000). */
    costUsdMicros: cents("cost_usd_micros").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "ai_usage_inbound_message_fk",
      columns: [t.tenantId, t.inboundMessageId],
      foreignColumns: [inboundMessages.tenantId, inboundMessages.id],
    }),
    index("ai_usage_tenant_created_idx").on(t.tenantId, t.createdAt),
    ...appendOnly("ai_usage"),
  ],
);

/** Trilha de auditoria de ações sensíveis. Só acrescenta. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    tenantId: tenantId(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    target: text("target"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt),
    ...appendOnly("audit_log"),
  ],
);
