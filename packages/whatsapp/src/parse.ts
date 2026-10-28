import {
  changeValueSchema,
  contactSchema,
  envelopeSchema,
  messageSchema,
  statusSchema,
} from "./schemas/webhook";

export type InboundType = "text" | "audio" | "image" | "unsupported";

export interface ParsedMessage {
  readonly waMessageId: string;
  readonly waId: string | null;
  readonly waUserId: string | null;
  readonly type: InboundType;
  readonly text: string | null;
  /** Só o evento desta mensagem: metadata, contato e a própria mensagem. */
  readonly raw: unknown;
}

export interface ParsedStatus {
  readonly waMessageId: string;
  readonly status: string;
  readonly recipientId: string | null;
  readonly errorCode: number | null;
  readonly errorTitle: string | null;
  readonly errorDetail: string | null;
  readonly occurredAt: Date | null;
  readonly raw: unknown;
}

export interface ParsedWebhook {
  readonly messages: readonly ParsedMessage[];
  readonly statuses: readonly ParsedStatus[];
  /** Itens que não passaram na validação mínima (sem id, por exemplo). Nunca derrubam o lote. */
  readonly invalidItems: number;
}

const EMPTY: ParsedWebhook = { messages: [], statuses: [], invalidItems: 0 };

/**
 * Extrai todas as mensagens e todos os status de um payload da Meta. Um POST pode trazer
 * vários eventos; nunca lança: payload desconhecido vira resultado vazio.
 */
export function parseWebhook(payload: unknown): ParsedWebhook {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return EMPTY;

  const messages: ParsedMessage[] = [];
  const statuses: ParsedStatus[] = [];
  let invalidItems = 0;

  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const value = changeValueSchema.safeParse(change.value);
      if (!value.success) {
        invalidItems += 1;
        continue;
      }
      const { metadata, contacts, messages: rawMessages, statuses: rawStatuses } = value.data;

      for (const item of rawMessages) {
        const parsed = messageSchema.safeParse(item);
        if (!parsed.success) {
          invalidItems += 1;
          continue;
        }
        const message = parsed.data;
        const contact = findContact(contacts, message.from);
        messages.push({
          waMessageId: message.id,
          waId: message.from ?? null,
          waUserId: message.from_user_id ?? contact?.user_id ?? null,
          type: classify(message.type, message.text?.body),
          text: message.type === "text" ? (message.text?.body ?? null) : null,
          raw: { metadata, contact: contact ?? null, message: item },
        });
      }

      for (const item of rawStatuses) {
        const parsed = statusSchema.safeParse(item);
        if (!parsed.success) {
          invalidItems += 1;
          continue;
        }
        const status = parsed.data;
        const error = status.errors?.[0];
        statuses.push({
          waMessageId: status.id,
          status: status.status,
          recipientId: status.recipient_id ?? null,
          errorCode: error?.code ?? null,
          errorTitle: error?.title ?? null,
          errorDetail: error?.error_data?.details ?? error?.message ?? null,
          occurredAt: toDate(status.timestamp),
          raw: item,
        });
      }
    }
  }
  return { messages, statuses, invalidItems };
}

function classify(type: string, textBody: string | undefined): InboundType {
  if (type === "text") return textBody === undefined ? "unsupported" : "text";
  if (type === "audio" || type === "image") return type;
  return "unsupported";
}

function findContact(contacts: readonly unknown[], waId: string | undefined) {
  for (const item of contacts) {
    const contact = contactSchema.safeParse(item);
    if (contact.success && contact.data.wa_id === waId) return contact.data;
  }
  return undefined;
}

function toDate(timestamp: string | number | undefined): Date | null {
  if (timestamp === undefined) return null;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}
