import type { AccessCodeMessage, EmailSender } from "@app/core";

export type SentAccessCode = AccessCodeMessage;

/** Para testes: guarda os envios em memória (código ou aviso de conta existente). */
export function createMemoryEmailSender(): EmailSender & { sent: ReadonlyArray<SentAccessCode> } {
  const sent: SentAccessCode[] = [];
  return {
    sent,
    async sendAccessCode(message) {
      sent.push({ ...message });
    },
  };
}
