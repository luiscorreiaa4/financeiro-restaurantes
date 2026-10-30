import {
  type AiUsageRecord,
  type CorrectionExtractor,
  type CorrectionResult,
  type EntryExtractor,
  type ExtractionResult,
  err,
  fail,
  ok,
  type Transcriber,
} from "@app/core";
import type { LlmClient, LlmRequest, LlmResponse } from "./claude/llm-client";

/** Só para testes e para o chat de desenvolvimento sem crédito de IA. */

export const ZERO_USAGE: AiUsageRecord = {
  provider: "fake",
  model: "fake",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  audioSeconds: 0,
  costUsdMicros: 0,
};

export type ScriptedExtraction =
  | { readonly result: ExtractionResult; readonly usage?: readonly AiUsageRecord[] }
  | { readonly error: "ExtractionInvalid" | "LlmRefused" };

/** Devolve as respostas roteirizadas, uma por chamada, na ordem. Sobra de chamada é erro do teste. */
export function createFakeEntryExtractor(script: readonly ScriptedExtraction[]): EntryExtractor & {
  readonly calls: Array<Parameters<EntryExtractor["extract"]>[0]>;
} {
  const queue = [...script];
  const calls: Array<Parameters<EntryExtractor["extract"]>[0]> = [];
  return {
    calls,
    async extract(input) {
      calls.push(input);
      const next = queue.shift();
      if (next === undefined) throw new Error("FakeEntryExtractor sem resposta roteirizada");
      if ("error" in next) {
        return next.error === "LlmRefused"
          ? err({ code: "LlmRefused" })
          : fail("ExtractionInvalid", { detail: "roteirizado" });
      }
      const usage = next.usage ?? [ZERO_USAGE];
      for (const item of usage) input.onUsage?.(item);
      return ok({ result: next.result, usage });
    },
  };
}

export interface ScriptedLlmResponse extends Partial<LlmResponse> {
  /** Atalho: objeto convertido em JSON no texto. */
  readonly json?: unknown;
}

/** `LlmClient` roteirizado: registra os pedidos para o teste conferir modelo e prefixo. */
export function createFakeLlmClient(script: readonly ScriptedLlmResponse[]): LlmClient & {
  readonly requests: LlmRequest[];
} {
  const queue = [...script];
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error("FakeLlmClient sem resposta roteirizada");
      return {
        stopReason: next.stopReason ?? "end_turn",
        text: next.text ?? (next.json === undefined ? null : JSON.stringify(next.json)),
        usage: next.usage ?? {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
  };
}

/** Correção roteirizada, na ordem das chamadas. */
export function createFakeCorrectionExtractor(
  script: readonly (CorrectionResult | { readonly error: "ExtractionInvalid" | "LlmRefused" })[],
): CorrectionExtractor & { readonly calls: Array<Parameters<CorrectionExtractor["extract"]>[0]> } {
  const queue = [...script];
  const calls: Array<Parameters<CorrectionExtractor["extract"]>[0]> = [];
  return {
    calls,
    async extract(input) {
      calls.push(input);
      const next = queue.shift();
      if (next === undefined) throw new Error("FakeCorrectionExtractor sem resposta roteirizada");
      if ("error" in next) {
        return next.error === "LlmRefused"
          ? err({ code: "LlmRefused" })
          : fail("ExtractionInvalid", { detail: "roteirizado" });
      }
      input.onUsage?.(ZERO_USAGE);
      return ok({ result: next, usage: [ZERO_USAGE] });
    },
  };
}

/** Transcrição roteirizada: texto ou erro, na ordem das chamadas. */
export function createFakeTranscriber(
  script: readonly (
    | { readonly text: string }
    | { readonly error: "ExtractionInvalid" | "MediaUnavailable" }
  )[],
): Transcriber & { readonly calls: Array<Parameters<Transcriber["transcribe"]>[0]> } {
  const queue = [...script];
  const calls: Array<Parameters<Transcriber["transcribe"]>[0]> = [];
  return {
    calls,
    async transcribe(input) {
      calls.push(input);
      const next = queue.shift();
      if (next === undefined) throw new Error("FakeTranscriber sem resposta roteirizada");
      if ("error" in next) return fail(next.error, { detail: "roteirizado" });
      return ok({
        text: next.text,
        usage: {
          ...ZERO_USAGE,
          provider: "openai",
          model: "gpt-transcribe",
          audioSeconds: Math.ceil(input.audioSeconds),
          costUsdMicros: Math.round(input.audioSeconds * 100),
        },
      });
    },
  };
}
