import { type ClaimedInboundMessage, type MessageSender, normalizeBrazilianPhone } from "@app/core";
import type { JobLogger } from "../../infra/logger";
import { failureText } from "./messages";

/**
 * Aviso de falha definitiva (RF19.R4): depois de todas as tentativas, o usuário é avisado de que a
 * mensagem NÃO foi registrada. A falha nunca é silenciosa. O envio é de melhor esforço: se ele
 * mesmo falhar, só registra no log (sem o conteúdo da mensagem) e a mensagem fica `failed`.
 */
export function createFailureNotifier(deps: {
  sender: MessageSender;
  supportContact: string | undefined;
  logger: JobLogger;
}): (message: ClaimedInboundMessage) => Promise<void> {
  return async (message) => {
    if (message.waId === null) return;
    const phone = normalizeBrazilianPhone(message.waId);
    const to = phone.ok ? phone.value.e164 : `+${message.waId}`;
    try {
      const result = await deps.sender.sendText({
        to,
        text: failureText(deps.supportContact),
        replyTo: message.waMessageId,
        trace: { tenantId: null, inboundMessageId: message.id, purpose: "notice" },
      });
      if (!result.ok) {
        deps.logger.warn({ inboundMessageId: message.id }, "aviso de falha não foi enviado");
      }
    } catch {
      deps.logger.warn({ inboundMessageId: message.id }, "aviso de falha não foi enviado");
    }
  };
}
