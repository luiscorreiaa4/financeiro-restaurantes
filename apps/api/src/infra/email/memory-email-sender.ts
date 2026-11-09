import type { EmailSender } from "@app/core";

export interface SentAccessCode {
  to: string;
  code: string;
  purpose: string;
}

/** Para testes: guarda os envios em memória. */
export function createMemoryEmailSender(): EmailSender & { sent: ReadonlyArray<SentAccessCode> } {
  const sent: SentAccessCode[] = [];
  return {
    sent,
    async sendAccessCode(message) {
      sent.push({ to: message.to, code: message.code, purpose: message.purpose });
    },
  };
}
