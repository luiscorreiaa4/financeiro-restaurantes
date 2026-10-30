import type { OutboundPurpose, TenantConversationRepo } from "@app/core";
import { and, eq, gt } from "drizzle-orm";
import { outboundMessages, pendingQuestions, whatsappOptIns } from "../schema";
import { type Database, withTenant } from "./client";
import { uuidv7 } from "./uuid";

/** Adaptador de `TenantConversationRepo`: papel `app`, sempre dentro de `withTenant` (regra 2). */
export function createTenantConversationRepo(db: Database): TenantConversationRepo {
  return {
    async recordOptIn({ tenantId, userId, inboundMessageId }) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .insert(whatsappOptIns)
          .values({ id: uuidv7(), tenantId, userId, source: "first_message", inboundMessageId })
          .onConflictDoNothing()
          .returning({ id: whatsappOptIns.id }),
      );
      return rows.length > 0;
    },

    async findReplyTarget(tenantId, waMessageId) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({
            outboundMessageId: outboundMessages.id,
            inboundMessageId: outboundMessages.inboundMessageId,
            purpose: outboundMessages.purpose,
          })
          .from(outboundMessages)
          .where(
            and(
              eq(outboundMessages.tenantId, tenantId),
              eq(outboundMessages.waMessageId, waMessageId),
            ),
          )
          .limit(1),
      );
      return row ? { ...row, purpose: row.purpose as OutboundPurpose } : null;
    },

    async hasPendingQuestion({ tenantId, userId, now }) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ id: pendingQuestions.id })
          .from(pendingQuestions)
          .where(
            and(
              eq(pendingQuestions.tenantId, tenantId),
              eq(pendingQuestions.userId, userId),
              eq(pendingQuestions.status, "open"),
              gt(pendingQuestions.expiresAt, now),
            ),
          )
          .limit(1),
      );
      return rows.length > 0;
    },
  };
}
