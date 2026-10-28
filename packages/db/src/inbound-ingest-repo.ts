import type {
  InboundIngestRepo,
  NewInboundMessage,
  NewStatusEvent,
  StoredInboundMessage,
} from "@app/core";
import { inArray } from "drizzle-orm";
import { inboundMessages, whatsappStatusEvents } from "../schema";
import type { Database } from "./client";

/**
 * Adaptador de `InboundIngestRepo`. Deve receber um `Database` conectado com o papel
 * `app_ingest`: a mensagem ainda não tem tenant, então não existe `withTenant` aqui.
 */
export function createInboundIngestRepo(db: Database): InboundIngestRepo {
  return {
    async saveMessages(messages): Promise<readonly StoredInboundMessage[]> {
      if (messages.length === 0) return [];
      // O mesmo id duas vezes no mesmo POST vale como uma mensagem só.
      const unique = [...new Map(messages.map((m) => [m.waMessageId, m])).values()];
      const inserted = await db
        .insert(inboundMessages)
        .values(unique.map(toRow))
        .onConflictDoNothing({ target: inboundMessages.waMessageId })
        .returning({
          id: inboundMessages.id,
          waMessageId: inboundMessages.waMessageId,
          status: inboundMessages.status,
        });
      const newIds = new Set(inserted.map((row) => row.waMessageId));
      const existing = unique.filter((m) => !newIds.has(m.waMessageId));
      const stored: StoredInboundMessage[] = inserted.map((row) => ({ ...row, isNew: true }));
      if (existing.length > 0) {
        const rows = await db
          .select({
            id: inboundMessages.id,
            waMessageId: inboundMessages.waMessageId,
            status: inboundMessages.status,
          })
          .from(inboundMessages)
          .where(
            inArray(
              inboundMessages.waMessageId,
              existing.map((m) => m.waMessageId),
            ),
          );
        stored.push(...rows.map((row) => ({ ...row, isNew: false })));
      }
      return stored;
    },

    async saveStatuses(events) {
      if (events.length === 0) return 0;
      const inserted = await db
        .insert(whatsappStatusEvents)
        .values(events.map(toStatusRow))
        .onConflictDoNothing({
          target: [whatsappStatusEvents.waMessageId, whatsappStatusEvents.status],
        })
        .returning({ id: whatsappStatusEvents.id });
      return inserted.length;
    },
  };
}

function toRow(message: NewInboundMessage): typeof inboundMessages.$inferInsert {
  return {
    waMessageId: message.waMessageId,
    waId: message.waId,
    waUserId: message.waUserId,
    type: message.type,
    text: message.text,
    raw: message.raw,
  };
}

function toStatusRow(event: NewStatusEvent): typeof whatsappStatusEvents.$inferInsert {
  return {
    waMessageId: event.waMessageId,
    status: event.status,
    recipientId: event.recipientId,
    errorCode: event.errorCode,
    errorTitle: event.errorTitle,
    errorDetail: event.errorDetail,
    occurredAt: event.occurredAt,
    raw: event.raw,
  };
}
