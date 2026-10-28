import { fail, type MessageSender, ok } from "@app/core";
import { type OutboundMessageRepo, uuidv7 } from "@app/db";

export class DevAdapterInProductionError extends Error {
  constructor() {
    super("O DevMessageSender é só para desenvolvimento e não sobe com NODE_ENV=production");
    this.name = "DevAdapterInProductionError";
  }
}

/**
 * `MessageSender` do chat de desenvolvimento (plano do canal, seção 3.6): em vez de falar com a
 * Meta, grava a resposta em `outbound_messages` com id `dev.out.<uuid>`, e o `pnpm dev:chat` a
 * mostra. Recusa subir em produção, para nunca "enviar" resposta a cliente real só para o banco.
 */
export function createDevMessageSender(deps: {
  repo: OutboundMessageRepo;
  nodeEnv: string;
}): MessageSender {
  if (deps.nodeEnv === "production") throw new DevAdapterInProductionError();
  return {
    async sendText({ to, text, replyTo, trace }) {
      const waMessageId = `dev.out.${uuidv7()}`;
      try {
        await deps.repo.save({
          waMessageId,
          toWaId: to.replace(/^\+/, ""),
          text,
          purpose: trace?.purpose ?? "notice",
          tenantId: trace?.tenantId ?? null,
          inboundMessageId: trace?.inboundMessageId ?? null,
          repliedToWaMessageId: replyTo ?? null,
        });
      } catch (error) {
        // Só o nome: a mensagem do erro do banco pode trazer o texto da resposta.
        return fail("SendFailed", { detail: error instanceof Error ? error.name : "Error" });
      }
      return ok({ waMessageId });
    },
    async markAsRead() {
      return ok(true as const);
    },
    async showTyping() {
      return ok(true as const);
    },
  };
}
