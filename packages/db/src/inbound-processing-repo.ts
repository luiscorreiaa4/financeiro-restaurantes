import type { ClaimedInboundMessage, InboundMessageType, InboundProcessingRepo } from "@app/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { inboundMessages } from "../schema";
import type { Database } from "./client";

/**
 * Adaptador de `InboundProcessingRepo`. Como o `createInboundIngestRepo`, recebe um `Database`
 * com o papel `app_ingest`: na E4 a mensagem ainda não tem tenant. A E5 passa a atribuí-lo.
 */
export function createInboundProcessingRepo(db: Database): InboundProcessingRepo {
  return {
    async claim(id): Promise<ClaimedInboundMessage | null> {
      const [row] = await db
        .update(inboundMessages)
        .set({ status: "processing", updatedAt: sql`now()` })
        .where(and(eq(inboundMessages.id, id), inArray(inboundMessages.status, CLAIMABLE)))
        .returning({
          id: inboundMessages.id,
          waMessageId: inboundMessages.waMessageId,
          waId: inboundMessages.waId,
          waUserId: inboundMessages.waUserId,
          type: inboundMessages.type,
          text: inboundMessages.text,
          // `context.id` do webhook: a mensagem que o usuário citou ao responder.
          replyToWaMessageId: sql<string | null>`${inboundMessages.raw} #>> '{message,context,id}'`,
          // Áudio e imagem: o id da mídia e a legenda vêm no pedaço `message` do payload.
          mediaId: sql<
            string | null
          >`coalesce(${inboundMessages.raw} #>> '{message,audio,id}', ${inboundMessages.raw} #>> '{message,image,id}')`,
          mediaMimeType: sql<
            string | null
          >`coalesce(${inboundMessages.raw} #>> '{message,audio,mime_type}', ${inboundMessages.raw} #>> '{message,image,mime_type}')`,
          mediaCaption: sql<string | null>`${inboundMessages.raw} #>> '{message,image,caption}'`,
        });
      if (!row) return null;
      const { mediaId, mediaMimeType, mediaCaption, ...rest } = row;
      return {
        ...rest,
        type: row.type as InboundMessageType,
        media:
          mediaId === null ? null : { id: mediaId, mimeType: mediaMimeType, caption: mediaCaption },
      };
    },

    async markProcessed(id) {
      const rows = await db
        .update(inboundMessages)
        .set({ status: "processed", error: null, updatedAt: sql`now()` })
        .where(and(eq(inboundMessages.id, id), eq(inboundMessages.status, "processing")))
        .returning({ id: inboundMessages.id });
      return rows.length > 0;
    },

    async markFailed(id, errorCode) {
      const rows = await db
        .update(inboundMessages)
        .set({ status: "failed", error: errorCode, updatedAt: sql`now()` })
        .where(and(eq(inboundMessages.id, id), inArray(inboundMessages.status, CLAIMABLE)))
        .returning({ id: inboundMessages.id });
      return rows.length > 0;
    },
  };
}

const CLAIMABLE = ["received", "processing"];
