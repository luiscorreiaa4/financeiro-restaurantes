import {
  type AiUsageRecord,
  type CorrectionExtractor,
  CorrectionResultSchema,
  err,
  fail,
  ok,
} from "@app/core";
import { buildCorrectionSystem, buildCorrectionUserText } from "../extraction/correction-prompt";
import { llmUsageRecord } from "../pricing";
import type { LlmClient, LlmMessage } from "./llm-client";

export interface ClaudeCorrectionExtractorDeps {
  readonly llm: LlmClient;
  readonly models: { readonly default: string; readonly advanced: string };
}

/**
 * Interpreta a resposta a uma confirmação (RF17): a IA só devolve o que mudar; quem aplica e
 * recalcula é o sistema (`planCorrection`). Saída inválida: uma nova tentativa no modelo avançado.
 */
export function createClaudeCorrectionExtractor(
  deps: ClaudeCorrectionExtractorDeps,
): CorrectionExtractor {
  return {
    async extract(input) {
      const system = buildCorrectionSystem();
      const first: LlmMessage = {
        role: "user",
        text: buildCorrectionUserText({
          today: input.today,
          text: input.text,
          entries: input.entries,
        }),
      };
      const usage: AiUsageRecord[] = [];

      const attempt = async (model: string, messages: readonly LlmMessage[]) => {
        const response = await deps.llm.complete({
          model,
          schema: CorrectionResultSchema,
          system,
          messages,
        });
        const record = llmUsageRecord(model, response.usage);
        usage.push(record);
        input.onUsage?.(record);
        if (response.stopReason === "refusal") return { kind: "refused" as const };
        if (response.stopReason !== "max_tokens" && response.text !== null) {
          try {
            const parsed = CorrectionResultSchema.safeParse(JSON.parse(response.text));
            if (parsed.success) return { kind: "ok" as const, result: parsed.data };
          } catch {
            // JSON inválido: cai na nova tentativa.
          }
        }
        return { kind: "invalid" as const, raw: response.text ?? "" };
      };

      let current = await attempt(deps.models.default, [first]);
      if (current.kind === "refused") return err({ code: "LlmRefused" });
      if (current.kind === "invalid") {
        current = await attempt(deps.models.advanced, [
          first,
          ...(current.raw === "" ? [] : [{ role: "assistant" as const, text: current.raw }]),
          {
            role: "user",
            text: "A resposta anterior foi recusada pela validação. Responda de novo no formato pedido.",
          },
        ]);
        if (current.kind === "refused") return err({ code: "LlmRefused" });
      }
      if (current.kind !== "ok") return fail("ExtractionInvalid", { detail: "correcao_invalida" });
      return ok({ result: current.result, usage });
    },
  };
}
