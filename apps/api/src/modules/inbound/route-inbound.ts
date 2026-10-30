import {
  type ClaimedInboundMessage,
  decideRoute,
  evaluateRateLimit,
  type InboundSenderRepo,
  type MessageSender,
  normalizeBrazilianPhone,
  type OutboundPurpose,
  type ReplyTarget,
  resolveSender,
  type SenderDirectory,
  type SenderMembership,
  type TenantConversationRepo,
  type UsageGuardStore,
  type UsageLimits,
} from "@app/core";
import type { JobLogger } from "../../infra/logger";
import {
  helpText,
  NOTHING_TO_CANCEL_TEXT,
  NOTHING_TO_UNDO_TEXT,
  RATE_LIMITED_TEXT,
  supportText,
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
  /** Devolve o id da mensagem enviada (para guardar na confirmação) ou nulo se não houve envio. */
  reply(text: string, purpose: OutboundPurpose): Promise<string | null>;
  /**
   * Marca a mensagem como lida e mostra "digitando" enquanto processa (RF11.Obs3). Melhor esforço:
   * falha aqui nunca derruba o processamento.
   */
  ack(): Promise<void>;
}

/**
 * Ramos que dependem de lançamentos ou de IA. A E5 só decide *qual* ramo e entrega a mensagem
 * a ele; as E6 e E7 trocam os padrões por implementações reais.
 */
export interface RouteHandlers {
  /** `target` é a confirmação citada quando o usuário respondeu a ela com "desfazer" (RF18.R2). */
  undo(context: RouteContext, target: ReplyTarget | null): Promise<void>;
  cancel(context: RouteContext): Promise<void>;
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
    undo: async (context) => {
      await context.reply(NOTHING_TO_UNDO_TEXT, "notice");
    },
    cancel: async (context) => {
      await context.reply(NOTHING_TO_CANCEL_TEXT, "notice");
    },
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
  /** Limites de uso (RF21). Sem isto não há limite (testes unitários antigos). */
  readonly usageGuard?: { readonly store: UsageGuardStore; readonly limits: UsageLimits };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
    ): Promise<string | null> => {
      if (to === null) {
        deps.logger.warn({ inboundMessageId: message.id }, "mensagem sem remetente, sem resposta");
        return null;
      }
      const result = await deps.sender.sendText({
        to,
        text,
        replyTo: message.waMessageId,
        trace: { tenantId, inboundMessageId: message.id, purpose },
      });
      if (!result.ok) throw new SendFailedError();
      return result.value.waMessageId;
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

    if (deps.usageGuard) {
      const now = deps.clock.now();
      const counts = await deps.usageGuard.store.countMessages({
        tenantId: sender.tenantId,
        userId: sender.userId,
        userSince: new Date(now.getTime() - HOUR_MS),
        tenantSince: new Date(now.getTime() - DAY_MS),
      });
      const decision = evaluateRateLimit(counts, deps.usageGuard.limits);
      if (decision.kind === "limited") {
        deps.logger.warn(
          { inboundMessageId: message.id, tenantId: sender.tenantId, scope: decision.scope },
          "limite de uso excedido",
        );
        // Avisa no máximo uma vez por hora; as demais mensagens barradas ficam sem resposta.
        const warnedRecently =
          to !== null &&
          (await deps.usageGuard.store.hasRecentNotice({
            tenantId: sender.tenantId,
            toWaId: to.replace(/^\+/, ""),
            text: RATE_LIMITED_TEXT,
            since: new Date(now.getTime() - HOUR_MS),
          }));
        if (!warnedRecently) await send(RATE_LIMITED_TEXT, "notice", sender.tenantId);
        return;
      }
    }

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
      async ack() {
        try {
          await deps.sender.markAsRead(message.waMessageId);
          await deps.sender.showTyping(message.waMessageId);
        } catch {
          // Melhor esforço (RF11.Obs3): o processamento segue sem o "lida" e o "digitando".
        }
      },
    };

    switch (route.kind) {
      case "unknown_sender":
        // Só ocorre com remetente desconhecido, tratado acima; mantém o switch exaustivo.
        return;
      case "unsupported":
        await context.reply(UNSUPPORTED_TYPE_TEXT, "notice");
        return;
      case "command":
        switch (route.command) {
          case "help":
            await context.reply(helpText(deps.supportContact), "help");
            return;
          case "support":
            await context.reply(supportText(deps.supportContact), "help");
            return;
          case "cancel":
            return deps.handlers.cancel(context);
          case "undo":
            return deps.handlers.undo(context, route.replyTarget);
        }
        return;
      case "correction":
        await context.ack();
        return deps.handlers.correction(context, route.target);
      case "pending_answer":
        await context.ack();
        return deps.handlers.pendingAnswer(context);
      case "extract":
        await context.ack();
        return deps.handlers.extract(context);
    }
  };
}
