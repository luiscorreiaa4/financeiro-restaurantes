import { fail, ok, type Transcriber } from "@app/core";
import { TRANSCRIPTION_USD_MICROS_PER_SECOND } from "../pricing";

export interface OpenAiTranscriberOptions {
  readonly apiKey: string;
  /** Padrão `gpt-transcribe`; o `gpt-4o-transcribe` será desligado em 26/02/2027 (doc da OpenAI). */
  readonly model: string;
  readonly fetch?: typeof fetch;
  /** Só os testes mudam isto. */
  readonly baseUrl?: string;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
};

/**
 * Transcrição por `POST /v1/audio/transcriptions` (multipart: `file`, `model`, `language`).
 * Conforme a doc da OpenAI (30/10/2026), os formatos aceitos são mp3, mp4, mpeg, mpga, m4a, wav e
 * webm, até 25 MB; **OGG/Opus não está na lista**, então o áudio chega aqui já convertido para MP3
 * (`AudioConverter`). A API não devolve duração: ela vem de quem chamou (`audioSeconds`) e é o que
 * se cobra no registro de uso (RNF08). Erros nunca carregam o texto transcrito nem a chave.
 */
export function createOpenAiTranscriber(options: OpenAiTranscriberOptions): Transcriber {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl ?? "https://api.openai.com"}/v1/audio/transcriptions`;
  return {
    async transcribe({ audio, contentType, audioSeconds }) {
      const extension = EXTENSIONS[contentType.split(";")[0]?.trim().toLowerCase() ?? ""];
      if (extension === undefined) {
        return fail("ExtractionInvalid", { detail: "formato_de_audio_nao_aceito" });
      }
      const form = new FormData();
      form.set(
        "file",
        new Blob([new Uint8Array(audio)], { type: contentType }),
        `audio.${extension}`,
      );
      form.set("model", options.model);
      form.set("language", "pt");
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${options.apiKey}` },
          body: form,
        });
      } catch {
        return fail("MediaUnavailable", { detail: "transcricao_rede" });
      }
      if (!response.ok) {
        // 429 e 5xx valem uma nova tentativa do job; 4xx é problema do áudio ou da configuração.
        return response.status === 429 || response.status >= 500
          ? fail("MediaUnavailable", { detail: `transcricao_${response.status}` })
          : fail("ExtractionInvalid", { detail: `transcricao_${response.status}` });
      }
      const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== "string") {
        return fail("ExtractionInvalid", { detail: "transcricao_sem_texto" });
      }
      return ok({
        text: body.text.trim(),
        usage: {
          provider: "openai",
          model: options.model,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          audioSeconds: Math.ceil(audioSeconds),
          costUsdMicros: Math.round(audioSeconds * TRANSCRIPTION_USD_MICROS_PER_SECOND),
        },
      });
    },
  };
}
