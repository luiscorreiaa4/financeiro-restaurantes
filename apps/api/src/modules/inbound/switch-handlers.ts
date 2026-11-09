import {
  accessibleUnitIds,
  buildChoice,
  type ChoiceDraft,
  ChoiceDraftSchema,
  type ChoiceStore,
  type EntryStore,
  type PendingQuestionRecord,
  parseChoiceAnswer,
} from "@app/core";
import {
  CHOICE_DISCARDED_TEXT,
  CHOICE_FAILED_TEXT,
  CHOICE_INVALID_TEXT,
  companySwitchedText,
  onlyOneCompanyText,
  onlyOneUnitText,
  unitSwitchedText,
} from "./messages";
import type { RouteContext, RouteHandlers } from "./route-inbound";

/** A lista numerada vale pelo mesmo tempo da pergunta de volta (RF15.R3). */
const CHOICE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SwitchHandlersDeps {
  readonly choices: ChoiceStore;
  readonly store: Pick<EntryStore, "closePendingQuestion">;
  readonly clock: { now(): Date };
  /** UUID v7. */
  readonly newId: () => string;
}

export interface SwitchHandlers extends Pick<RouteHandlers, "switchUnit" | "switchTenant"> {
  /** Trata a resposta (o número) a uma pergunta `choice`, sem chamar a IA. */
  answerChoice(context: RouteContext, pending: PendingQuestionRecord): Promise<void>;
}

/**
 * `trocar unidade`, `trocar empresa` e a resposta à lista numerada (RF19, DE-25). A escolha
 * mora no vínculo; aqui só se monta a lista, se lê o número e se chama o `ChoiceStore`.
 */
export function createSwitchHandlers(deps: SwitchHandlersDeps): SwitchHandlers {
  const { choices, clock } = deps;

  async function openList(
    context: RouteContext,
    target: ChoiceDraft["target"],
    items: readonly { id: string; label: string }[],
  ): Promise<void> {
    const { draft, text } = buildChoice(target, items);
    await choices.open({
      tenantId: context.sender.tenantId,
      userId: context.sender.userId,
      inboundMessageId: context.message.id,
      id: deps.newId(),
      draft,
      question: text,
      expiresAt: new Date(clock.now().getTime() + CHOICE_TTL_MS),
    });
    await context.reply(text, "question");
  }

  return {
    async switchUnit(context) {
      const accessible = accessibleUnitIds(context.sender);
      // Ordem por nome: a numeração não pode depender da ordem em que o banco devolve as linhas.
      const units = context.sender.tenantUnits
        .filter((unit) => unit.status === "active" && accessible.includes(unit.id))
        .toSorted((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      if (units.length <= 1) {
        const only = units[0]?.name ?? context.sender.tenantName;
        await context.reply(onlyOneUnitText(only), "notice");
        return;
      }
      await openList(
        context,
        "unit",
        units.map((unit) => ({ id: unit.id, label: unit.name })),
      );
    },

    async switchTenant(context) {
      const byTenant = new Map<string, string>();
      for (const link of context.activeMemberships) {
        if (!byTenant.has(link.tenantId)) byTenant.set(link.tenantId, link.tenantName);
      }
      if (byTenant.size <= 1) {
        await context.reply(onlyOneCompanyText(context.sender.tenantName), "notice");
        return;
      }
      await openList(
        context,
        "tenant",
        [...byTenant]
          .map(([id, label]) => ({ id, label }))
          .toSorted((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      );
    },

    async answerChoice(context, pending) {
      const { tenantId, userId } = context.sender;
      const parsed = ChoiceDraftSchema.safeParse(pending.draft);
      if (!parsed.success) {
        // Rascunho fora do formato: não deixa a conversa presa nesta pergunta.
        await deps.store.closePendingQuestion(tenantId, pending.id, "cancelled");
        await context.reply(CHOICE_FAILED_TEXT, "notice");
        return;
      }
      const draft = parsed.data;
      const answer = parseChoiceAnswer(draft, context.message.text ?? "");
      if (answer.kind === "invalid") {
        const { text } = buildChoice(
          draft.target,
          draft.options.map((option) => ({ id: option.id, label: option.label })),
        );
        await context.reply(`${CHOICE_INVALID_TEXT}\n\n${text}`, "question");
        return;
      }
      const done = await choices.apply({
        tenantId,
        userId,
        questionId: pending.id,
        target: draft.target,
        chosenId: answer.id,
        now: clock.now(),
      });
      if (!done) {
        await context.reply(CHOICE_FAILED_TEXT, "notice");
        return;
      }
      await context.reply(
        draft.target === "unit"
          ? unitSwitchedText(answer.label)
          : companySwitchedText(answer.label),
        "notice",
      );
      // Só fecha depois de responder: se o envio falhar, o job repetido reaplica a mesma escolha
      // (idempotente) em vez de mandar o número para a IA (DE-26).
      await deps.store.closePendingQuestion(tenantId, pending.id, "answered");
    },
  };
}

export interface PendingAnswerRouterDeps {
  readonly store: Pick<EntryStore, "findOpenPendingQuestion" | "closePendingQuestion">;
  readonly clock: { now(): Date };
  readonly answerChoice: SwitchHandlers["answerChoice"];
  /** Resposta a pergunta de esclarecimento: o caminho da IA (RF15). */
  readonly fallback: RouteHandlers["pendingAnswer"];
  /** Mensagem nova de lançamento (texto, áudio ou foto) com a lista aberta: segue para a extração. */
  readonly extract: RouteHandlers["extract"];
}

/** A resposta à lista numerada é só o número de uma opção. */
const isNumberAnswer = (context: RouteContext): boolean =>
  context.message.type === "text" &&
  /^\d+$/.test((context.message.text ?? "").trim().replace(/\.$/, "").trim());

/** Separa a resposta à lista numerada (sem IA) da resposta a um esclarecimento (com IA). */
export function createPendingAnswerRouter(
  deps: PendingAnswerRouterDeps,
): RouteHandlers["pendingAnswer"] {
  return async (context) => {
    const pending = await deps.store.findOpenPendingQuestion({
      tenantId: context.sender.tenantId,
      userId: context.sender.userId,
      now: deps.clock.now(),
    });
    if (pending?.kind === "choice") {
      if (isNumberAnswer(context)) return deps.answerChoice(context, pending);
      // Lançamento novo com a lista aberta: a lista sai de cena com aviso e a mensagem é registrada
      // (DN-09), em vez de a pessoa ficar presa nela por até 24 h.
      await deps.store.closePendingQuestion(context.sender.tenantId, pending.id, "cancelled");
      await context.reply(CHOICE_DISCARDED_TEXT, "notice");
      return deps.extract(context);
    }
    return deps.fallback(context);
  };
}
