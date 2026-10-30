import {
  type AiUsageRecord,
  type EntryExtractor,
  type ExtractionResult,
  ExtractionResultSchema,
  err,
  fail,
  ok,
} from "@app/core";
import { buildSystem, buildUserText } from "../extraction/prompt";
import { llmUsageRecord } from "../pricing";
import type { LlmClient, LlmMessage, LlmResponse } from "./llm-client";

/** Texto acima disso começa direto no modelo avançado (sinal objetivo, RNF08.R3). */
export const LONG_MESSAGE_CHARS = 600;

export interface ClaudeEntryExtractorDeps {
  readonly llm: LlmClient;
  readonly models: { readonly default: string; readonly advanced: string };
}

type Attempt =
  | { readonly kind: "ok"; readonly result: ExtractionResult }
  | { readonly kind: "invalid"; readonly raw: string; readonly detail: string }
  | { readonly kind: "refused" };

/** Resume o erro de validação sem copiar valores (podem conter texto do usuário). */
function describeInvalid(response: LlmResponse): { raw: string; detail: string } | null {
  if (response.stopReason === "max_tokens") return { raw: "", detail: "max_tokens" };
  if (response.text === null) return { raw: "", detail: "sem_texto" };
  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch {
    return { raw: response.text, detail: "json_invalido" };
  }
  const parsed = ExtractionResultSchema.safeParse(json);
  if (parsed.success) return null;
  const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "raiz"))];
  return { raw: response.text, detail: `schema:${paths.slice(0, 5).join(",")}` };
}

/**
 * Extrator de lançamentos por Claude (E6). Começa no Haiku; vai ao Sonnet por sinais objetivos:
 * mensagem longa (já na entrada), saída inválida (a nova tentativa, com o erro, é no Sonnet) e
 * intenção `unclear`. Nunca pela "confiança" declarada pelo modelo. Cada chamada gera um registro
 * de uso (RNF08). Falha de rede/API sobe como exceção para o job ser retentado.
 */
export function createClaudeEntryExtractor(deps: ClaudeEntryExtractorDeps): EntryExtractor {
  return {
    async extract(input) {
      const system = buildSystem(input.context);
      const first: LlmMessage = {
        role: "user",
        text: buildUserText({ today: input.today, ...(input.text ? { text: input.text } : {}) }),
        ...(input.image ? { image: input.image } : {}),
      };
      const usage: AiUsageRecord[] = [];

      const attempt = async (model: string, messages: readonly LlmMessage[]): Promise<Attempt> => {
        const response = await deps.llm.complete({
          model,
          schema: ExtractionResultSchema,
          system,
          messages,
        });
        const record = llmUsageRecord(model, response.usage);
        usage.push(record);
        input.onUsage?.(record);
        if (response.stopReason === "refusal") return { kind: "refused" };
        const invalid = describeInvalid(response);
        if (invalid !== null) return { kind: "invalid", ...invalid };
        return {
          kind: "ok",
          result: ExtractionResultSchema.parse(JSON.parse(response.text ?? "")),
        };
      };

      const long = (input.text?.length ?? 0) > LONG_MESSAGE_CHARS;
      const startModel = long ? deps.models.advanced : deps.models.default;
      let current = await attempt(startModel, [first]);

      if (current.kind === "refused") return err({ code: "LlmRefused" });

      if (current.kind === "invalid") {
        // Nova tentativa com o erro, já no modelo avançado (RF12.R18).
        const retryMessages: LlmMessage[] = [
          first,
          ...(current.raw === "" ? [] : [{ role: "assistant" as const, text: current.raw }]),
          {
            role: "user",
            text: `A resposta anterior foi recusada pela validação (${current.detail}). Responda de novo no formato pedido.`,
          },
        ];
        const firstDetail = current.detail;
        current = await attempt(deps.models.advanced, retryMessages);
        if (current.kind === "refused") return err({ code: "LlmRefused" });
        if (current.kind === "invalid") {
          return fail("ExtractionInvalid", { detail: `${firstDetail}|${current.detail}` });
        }
      } else if (current.result.intent === "unclear" && startModel !== deps.models.advanced) {
        const retried = await attempt(deps.models.advanced, [first]);
        // Se o modelo avançado falhar, vale a pergunta do primeiro.
        if (retried.kind === "ok") current = retried;
      }

      if (current.kind !== "ok") return fail("ExtractionInvalid", { detail: "inesperado" });
      return ok({ result: current.result, usage });
    },
  };
}
