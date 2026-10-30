import type { InboundMediaRepo } from "@app/core";
import { eq, sql } from "drizzle-orm";
import { inboundMessages } from "../schema";
import type { Database } from "./client";

/** Papel `app_ingest`, como o resto do tratamento da mensagem recebida (a E4 e a E5 o usam). */
export function createInboundMediaRepo(db: Database): InboundMediaRepo {
  return {
    async attachMedia(inboundMessageId, mediaKey) {
      await db
        .update(inboundMessages)
        .set({ mediaKey, updatedAt: sql`now()` })
        .where(eq(inboundMessages.id, inboundMessageId));
    },
    async saveTranscription(inboundMessageId, text) {
      await db
        .update(inboundMessages)
        .set({ transcription: text, updatedAt: sql`now()` })
        .where(eq(inboundMessages.id, inboundMessageId));
    },
  };
}
