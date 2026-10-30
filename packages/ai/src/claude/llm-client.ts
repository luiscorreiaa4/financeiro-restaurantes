import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { PromptBlock } from "../extraction/prompt";
import type { TokenUsage } from "../pricing";

/** Fronteira fina sobre o SDK: o extrator só conhece isto, então os testes injetam respostas. */
export interface LlmMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly image?: { readonly bytes: Uint8Array; readonly contentType: string };
}

export interface LlmRequest {
  readonly model: string;
  /** Schema da saída estruturada (D1). */
  readonly schema: z.ZodType;
  readonly system: readonly PromptBlock[];
  readonly messages: readonly LlmMessage[];
}

export interface LlmResponse {
  /** `end_turn`, `max_tokens`, `refusal`... como veio da API. */
  readonly stopReason: string | null;
  /** Texto da resposta (o JSON da saída estruturada); nulo se não veio bloco de texto. */
  readonly text: string | null;
  readonly usage: TokenUsage;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Folgado de propósito: o pensamento adaptativo também conta para o limite. */
const MAX_TOKENS = 8000;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function toContent(message: LlmMessage): Anthropic.MessageParam["content"] {
  if (message.image === undefined) return message.text;
  if (!IMAGE_TYPES.includes(message.image.contentType)) {
    throw new Error(`tipo de imagem não suportado pela IA: ${message.image.contentType}`);
  }
  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: message.image.contentType as ImageMediaType,
        data: Buffer.from(message.image.bytes).toString("base64"),
      },
    },
    { type: "text", text: message.text },
  ];
}

/**
 * Adaptador da API da Anthropic: saída estruturada (`output_config.format`, D1), `effort` baixo,
 * sem `temperature` (os modelos novos recusam) e cache no fim do bloco estável do system.
 */
export function createAnthropicLlmClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete(request) {
      const response = await client.messages.create({
        model: request.model,
        max_tokens: MAX_TOKENS,
        system: request.system.map((block) => ({
          type: "text" as const,
          text: block.text,
          ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        })),
        messages: request.messages.map((message) => ({
          role: message.role,
          content: toContent(message),
        })),
        output_config: { effort: "low", format: zodOutputFormat(request.schema) },
      });
      const block = response.content.find((item) => item.type === "text");
      return {
        stopReason: response.stop_reason,
        text: block?.type === "text" ? block.text : null,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}
