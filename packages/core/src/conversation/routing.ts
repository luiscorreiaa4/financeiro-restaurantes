import { type Command, parseCommand } from "./commands";
import type { SenderResolution } from "./sender";

/** Para que serve uma mensagem que enviamos. Só `confirmation` aceita correção por reply. */
export const OUTBOUND_PURPOSES = ["confirmation", "question", "help", "notice"] as const;
export type OutboundPurpose = (typeof OUTBOUND_PURPOSES)[number];

/** Mensagem nossa que o usuário citou ao responder (`context.message_id` do webhook). */
export interface ReplyTarget {
  readonly outboundMessageId: string;
  /** Mensagem do usuário que originou a nossa resposta. */
  readonly inboundMessageId: string | null;
  readonly purpose: OutboundPurpose;
}

export type Route =
  /** Telefone sem cadastro ativo: resposta padrão, sem IA e sem expor dados. */
  | { readonly kind: "unknown_sender" }
  /** Sticker, vídeo, documento, texto vazio…: pedimos texto, áudio ou foto. */
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "command";
      readonly command: Command;
      readonly replyTarget: ReplyTarget | null;
    }
  /** Resposta a uma confirmação nossa: corrige aquele lançamento. */
  | { readonly kind: "correction"; readonly target: ReplyTarget }
  /** Há pergunta nossa em aberto para este usuário. */
  | { readonly kind: "pending_answer" }
  | { readonly kind: "extract" };

export interface RouteInput {
  readonly resolution: SenderResolution;
  readonly message: {
    readonly type: "text" | "audio" | "image" | "unsupported";
    readonly text: string | null;
  };
  /** A mensagem citada é nossa? Nulo se não citou nada ou citou algo que não conhecemos. */
  readonly replyTarget: ReplyTarget | null;
  readonly hasPendingQuestion: boolean;
}

/**
 * Decide o ramo da mensagem sem chamar IA. Ordem (plano do canal, E5): remetente → tipo →
 * comando → resposta a uma confirmação → resposta a pergunta pendente → extração.
 * Resposta a uma mensagem nossa que não é confirmação (ajuda, aviso) não é correção.
 */
export function decideRoute(input: RouteInput): Route {
  const { resolution, message, replyTarget, hasPendingQuestion } = input;
  if (resolution.kind === "unknown") return { kind: "unknown_sender" };

  if (message.type === "unsupported") return { kind: "unsupported" };
  const text = message.type === "text" ? (message.text ?? "") : null;
  if (text !== null && text.trim() === "") return { kind: "unsupported" };

  if (text !== null) {
    const command = parseCommand(text);
    if (command !== null) return { kind: "command", command, replyTarget };
  }
  if (replyTarget?.purpose === "confirmation") return { kind: "correction", target: replyTarget };
  if (hasPendingQuestion) return { kind: "pending_answer" };
  return { kind: "extract" };
}
