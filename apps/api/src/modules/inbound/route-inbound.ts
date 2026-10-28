import {
  type ClaimedInboundMessage,
  decideRoute,
  type InboundSenderRepo,
  type MessageSender,
  normalizeBrazilianPhone,
  type OutboundPurpose,
  type ReplyTarget,
  resolveSender,
  type SenderDirectory,
  type SenderMembership,
  type TenantConversationRepo,
} from "@app/core";
import type { JobLogger } from "../../infra/logger";
import {
  helpText,
  NOTHING_TO_UNDO_TEXT,
  UNSUPPORTED_TYPE_TEXT,
  unknownSenderText,
} from "./messages";
import type { RouteInbound } from "./process-inbound";

/** Remetente já identificado, com o que os ramos precisam para agir. */
export interface RouteContext {
  readonly message: ClaimedInboundMessage;
  readonly sender: SenderMembership;
  readonly defaultUnitId: string | null;
  /** Em mais de um restaurante ativo, a confirmação da E7 cita o nome do restaurante. */
  readonly tenantCount: number;
  reply(text: string, purpose: OutboundPurpose): Promise<void>;
}

/**
 * Ramos que dependem de lançamentos ou de IA. A E5 só decide *qual* ramo e entrega a mensagem
 * a ele; as E6 e E7 trocam os padrões por implementações reais.
 */
export interface RouteHandlers {
  undo(context: RouteContext): Promise<void>;
  correction(context: RouteContext, target: ReplyTarget): Promise<void>;
  pendingAnswer(context: RouteContext): Promise<void>;
  extract(context: RouteContext): Promise<void>;
}

/** Falha ao enviar a resposta: sobe para o pg-boss retentar. Só o nome vai para o banco. */
export class SendFailedError extends Error {
  constructor() {
    super("falha ao enviar a resposta");
    this.name = "SendFailedError";
  }
}

/** A mensagem já pertence a outro restaurante: nunca deveria acontecer, não adianta insistir. */
export class SenderConflictError extends Error {
  constructor() {
    super("a mensagem já foi atribuída a outro restaurante");
    this.name = "SenderConflictError";
  }
}

/** Padrões da E5: undo responde o provisório; os demais ainda não fazem nada (E6 e E7). */
export function defaultHandlers(logger: JobLogger): RouteHandlers {
  const notYet = (branch: string) => async (context: RouteContext) => {
    logger.info(
      { inboundMessageId: context.message.id, branch },
      "ramo ainda não implementado, mensagem sem resposta",
    );
  };
  return {
    undo: (context) => context.reply(NOTHING_TO_UNDO_TEXT, "notice"),
    correction: (context) => notYet("correction")(context),
    pendingAnswer: notYet("pending_answer"),
    extract: notYet("extract"),
  };
}

export interface RouteInboundDeps {
  readonly directory: SenderDirectory;
  readonly senderRepo: InboundSenderRepo;
  readonly conversation: TenantConversationRepo;
  readonly sender: MessageSender;
  readonly clock: { now(): Date };
  readonly handlers: RouteHandlers;
  readonly supportContact: string | undefined;
  readonly logger: JobLogger;
}

/**
 * Roteamento da E5: descobre quem escreveu (telefone → usuário → tenant), registra o opt-in e
 * escolhe o ramo (`decideRoute`) **antes de gastar IA**. Número desconhecido e comandos são
 * respondidos aqui. Erros sobem para o worker retentar; o texto da mensagem nunca vai para o log.
 */
export function createRouteInbound(deps: RouteInboundDeps): RouteInbound {
  return async (message) => {
    const phone = message.waId === null ? null : normalizeBrazilianPhone(message.waId);
    const candidates = phone?.ok ? phone.value.lookupCandidates : [];
    // Resposta sempre para o formato aceito no envio (com o 9º dígito).
    const to = phone?.ok ? phone.value.e164 : message.waId === null ? null : `+${message.waId}`;

    const resolution = resolveSender(await deps.directory.findMemberships(candidates));

    const send = async (
      text: string,
      purpose: OutboundPurpose,
      tenantId: string | null,
    ): Promise<void> => {
      if (to === null) {
        deps.logger.warn({ inboundMessageId: message.id }, "mensagem sem remetente, sem resposta");
        return;
      }
      const result = await deps.sender.sendText({
        to,
        text,
        replyTo: message.waMessageId,
        trace: { tenantId, inboundMessageId: message.id, purpose },
      });
      if (!result.ok) throw new SendFailedError();
    };

    if (resolution.kind === "unknown") {
      deps.logger.info(
        { inboundMessageId: message.id, route: "unknown_sender" },
        "mensagem roteada",
      );
      await send(unknownSenderText(deps.supportContact), "notice", null);
      return;
    }

    const { sender } = resolution;
    const assigned = await deps.senderRepo.assignSender(message.id, {
      tenantId: sender.tenantId,
      userId: sender.userId,
    });
    if (!assigned) throw new SenderConflictError();
    await deps.conversation.recordOptIn({
      tenantId: sender.tenantId,
      userId: sender.userId,
      inboundMessageId: message.id,
    });

    const replyTarget =
      message.replyToWaMessageId === null
        ? null
        : await deps.conversation.findReplyTarget(sender.tenantId, message.replyToWaMessageId);
    const hasPendingQuestion = await deps.conversation.hasPendingQuestion({
      tenantId: sender.tenantId,
      userId: sender.userId,
      now: deps.clock.now(),
    });

    const route = decideRoute({ resolution, message, replyTarget, hasPendingQuestion });
    deps.logger.info(
      { inboundMessageId: message.id, tenantId: sender.tenantId, route: route.kind },
      "mensagem roteada",
    );

    const context: RouteContext = {
      message,
      sender,
      defaultUnitId: resolution.defaultUnitId,
      tenantCount: resolution.tenantCount,
      reply: (text, purpose) => send(text, purpose, sender.tenantId),
    };

    switch (route.kind) {
      case "unknown_sender":
        // Só ocorre com remetente desconhecido, tratado acima; mantém o switch exaustivo.
        return;
      case "unsupported":
        return context.reply(UNSUPPORTED_TYPE_TEXT, "notice");
      case "command":
        return route.command === "help"
          ? context.reply(helpText(deps.supportContact), "help")
          : deps.handlers.undo(context);
      case "correction":
        return deps.handlers.correction(context, route.target);
      case "pending_answer":
        return deps.handlers.pendingAnswer(context);
      case "extract":
        return deps.handlers.extract(context);
    }
  };
}
