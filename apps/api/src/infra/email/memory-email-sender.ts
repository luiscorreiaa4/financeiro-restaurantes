import type {
  AccessCodeMessage,
  EmailSender,
  PasswordResetLinkMessage,
  SecurityNoticeMessage,
} from "@app/core";

export type SentAccessCode = AccessCodeMessage;

/** Para testes: guarda os envios em memória (código ou aviso de conta existente) e os avisos de segurança à parte. */
export function createMemoryEmailSender(): EmailSender & {
  sent: ReadonlyArray<SentAccessCode>;
  sentNotices: ReadonlyArray<SecurityNoticeMessage>;
  sentLinks: ReadonlyArray<PasswordResetLinkMessage>;
} {
  const sent: SentAccessCode[] = [];
  const sentNotices: SecurityNoticeMessage[] = [];
  const sentLinks: PasswordResetLinkMessage[] = [];
  return {
    sent,
    sentNotices,
    sentLinks,
    async sendPasswordResetLink(message) {
      sentLinks.push({ ...message });
    },
    async sendAccessCode(message) {
      sent.push({ ...message });
    },
    async sendSecurityNotice(message) {
      sentNotices.push({ ...message });
    },
  };
}
