import type {
  AccessCodeMessage,
  EmailSender,
  MemberInviteMessage,
  PasswordResetLinkMessage,
  SecurityNoticeMessage,
} from "@app/core";

export type SentAccessCode = AccessCodeMessage;

/** Para testes: guarda os envios em memória (código ou aviso de conta existente) e os avisos de segurança à parte. */
export function createMemoryEmailSender(): EmailSender & {
  sent: ReadonlyArray<SentAccessCode>;
  sentNotices: ReadonlyArray<SecurityNoticeMessage>;
  sentLinks: ReadonlyArray<PasswordResetLinkMessage>;
  sentInvites: ReadonlyArray<MemberInviteMessage>;
  /** Faz o próximo `sendMemberInvite` falhar (teste de que o cadastro não é desfeito). */
  failInvites: boolean;
} {
  const sent: SentAccessCode[] = [];
  const sentNotices: SecurityNoticeMessage[] = [];
  const sentLinks: PasswordResetLinkMessage[] = [];
  const sentInvites: MemberInviteMessage[] = [];
  const sender = {
    sent,
    sentNotices,
    sentLinks,
    sentInvites,
    failInvites: false,
    async sendPasswordResetLink(message: PasswordResetLinkMessage) {
      sentLinks.push({ ...message });
    },
    async sendAccessCode(message: AccessCodeMessage) {
      sent.push({ ...message });
    },
    async sendMemberInvite(message: MemberInviteMessage) {
      if (sender.failInvites) throw new Error("envio falhou");
      sentInvites.push({ ...message });
    },
    async sendSecurityNotice(message: SecurityNoticeMessage) {
      sentNotices.push({ ...message });
    },
  };
  return sender;
}
