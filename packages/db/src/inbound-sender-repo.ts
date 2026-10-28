import type { InboundSenderRepo } from "@app/core";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { inboundMessages } from "../schema";
import type { Database } from "./client";

/**
 * Adaptador de `InboundSenderRepo` (papel `app_ingest`). A atribuição é um `UPDATE` guardado:
 * só preenche mensagem ainda sem dono, ou confirma o mesmo dono. Repetir (retry do job) é
 * inofensivo, e uma mensagem nunca troca de tenant.
 */
export function createInboundSenderRepo(db: Database): InboundSenderRepo {
  return {
    async assignSender(inboundMessageId, sender) {
      const rows = await db
        .update(inboundMessages)
        .set({ tenantId: sender.tenantId, userId: sender.userId, updatedAt: sql`now()` })
        .where(
          and(
            eq(inboundMessages.id, inboundMessageId),
            or(isNull(inboundMessages.tenantId), eq(inboundMessages.tenantId, sender.tenantId)),
          ),
        )
        .returning({ id: inboundMessages.id });
      return rows.length > 0;
    },
  };
}
