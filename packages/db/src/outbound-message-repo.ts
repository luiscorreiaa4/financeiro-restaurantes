import type { OutboundPurpose } from "@app/core";
import { and, asc, eq, gt } from "drizzle-orm";
import { outboundMessages } from "../schema";
import type { Database } from "./client";
import { uuidv7 } from "./uuid";

export interface NewOutboundMessage {
  readonly waMessageId: string;
  /** E.164 sem o "+" (formato `wa_id` da Meta). */
  readonly toWaId: string;
  readonly text: string;
  readonly purpose: OutboundPurpose;
  readonly tenantId: string | null;
  readonly inboundMessageId: string | null;
  readonly repliedToWaMessageId: string | null;
}

export interface StoredOutboundMessage {
  readonly waMessageId: string;
  readonly text: string;
  readonly purpose: OutboundPurpose;
  readonly createdAt: Date;
}

/**
 * Registro das mensagens que enviamos (papel `app_ingest`, porque a resposta a um número
 * desconhecido não tem tenant). Hoje alimenta o `DevMessageSender` e o chat de
 * desenvolvimento; o envio real (E10) grava aqui também, para a correção por reply.
 */
export interface OutboundMessageRepo {
  save(message: NewOutboundMessage): Promise<void>;
  /** Mensagens para `toWaId` gravadas depois de `since`, da mais antiga para a mais nova. */
  listSince(toWaId: string, since: Date): Promise<readonly StoredOutboundMessage[]>;
}

export function createOutboundMessageRepo(db: Database): OutboundMessageRepo {
  return {
    async save(message) {
      await db.insert(outboundMessages).values({ id: uuidv7(), ...message });
    },

    async listSince(toWaId, since) {
      const rows = await db
        .select({
          waMessageId: outboundMessages.waMessageId,
          text: outboundMessages.text,
          purpose: outboundMessages.purpose,
          createdAt: outboundMessages.createdAt,
        })
        .from(outboundMessages)
        .where(and(eq(outboundMessages.toWaId, toWaId), gt(outboundMessages.createdAt, since)))
        .orderBy(asc(outboundMessages.createdAt), asc(outboundMessages.id));
      return rows.map((row) => ({ ...row, purpose: row.purpose as OutboundPurpose }));
    },
  };
}
