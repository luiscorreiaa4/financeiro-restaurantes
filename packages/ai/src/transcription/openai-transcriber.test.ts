import { describe, expect, it } from "vitest";
import { createOpenAiTranscriber } from "./openai-transcriber";

const AUDIO = new Uint8Array([1, 2, 3]);

function setup(respond: () => Response | Promise<Response>) {
  const requests: { url: string; auth: string | null; form: FormData }[] = [];
  const impl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
      form: init?.body as FormData,
    });
    return respond();
  };
  const transcriber = createOpenAiTranscriber({
    apiKey: "SEGREDO-CHAVE",
    model: "gpt-transcribe",
    fetch: impl,
  });
  return { transcriber, requests };
}

describe("transcrição de áudio", () => {
  it("envia o arquivo, o modelo e o idioma em português e devolve o texto com o uso", async () => {
    const { transcriber, requests } = setup(() =>
      Response.json({ text: "  camarão 450 no pix  " }),
    );
    const result = await transcriber.transcribe({
      audio: AUDIO,
      contentType: "audio/mpeg",
      audioSeconds: 20,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        text: "camarão 450 no pix",
        usage: {
          provider: "openai",
          model: "gpt-transcribe",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          audioSeconds: 20,
          costUsdMicros: 2000,
        },
      },
    });
    const [request] = requests;
    expect(request?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(request?.auth).toBe("Bearer SEGREDO-CHAVE");
    expect(request?.form.get("model")).toBe("gpt-transcribe");
    expect(request?.form.get("language")).toBe("pt");
    const file = request?.form.get("file");
    expect(file instanceof File && file.name).toBe("audio.mp3");
  });

  it("arredonda os segundos para cima no registro de uso (RF13.Obs3)", async () => {
    const { transcriber } = setup(() => Response.json({ text: "oi" }));
    const result = await transcriber.transcribe({
      audio: AUDIO,
      contentType: "audio/mpeg",
      audioSeconds: 20.2,
    });
    expect(result.ok && result.value.usage.audioSeconds).toBe(21);
  });

  it("não aceita OGG/Opus: a doc da OpenAI não lista o formato, o áudio precisa vir convertido", async () => {
    const { transcriber, requests } = setup(() => Response.json({ text: "x" }));
    const result = await transcriber.transcribe({
      audio: AUDIO,
      contentType: "audio/ogg; codecs=opus",
      audioSeconds: 5,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "ExtractionInvalid", detail: "formato_de_audio_nao_aceito" },
    });
    expect(requests).toHaveLength(0);
  });

  it("limite de uso e erro do servidor valem nova tentativa; erro de pedido não", async () => {
    for (const status of [429, 503]) {
      const { transcriber } = setup(() => new Response("", { status }));
      const result = await transcriber.transcribe({
        audio: AUDIO,
        contentType: "audio/mpeg",
        audioSeconds: 5,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "MediaUnavailable" } });
    }
    const { transcriber } = setup(() => new Response("", { status: 400 }));
    expect(
      await transcriber.transcribe({ audio: AUDIO, contentType: "audio/mpeg", audioSeconds: 5 }),
    ).toMatchObject({ ok: false, error: { code: "ExtractionInvalid", detail: "transcricao_400" } });
  });

  it("resposta sem texto e queda de rede são tratadas, sem vazar a chave", async () => {
    const { transcriber } = setup(() => Response.json({}));
    const empty = await transcriber.transcribe({
      audio: AUDIO,
      contentType: "audio/mpeg",
      audioSeconds: 5,
    });
    expect(empty).toMatchObject({ ok: false, error: { detail: "transcricao_sem_texto" } });

    const down = createOpenAiTranscriber({
      apiKey: "SEGREDO-CHAVE",
      model: "gpt-transcribe",
      fetch: async () => {
        throw new Error("ECONNRESET SEGREDO-CHAVE");
      },
    });
    const result = await down.transcribe({
      audio: AUDIO,
      contentType: "audio/mpeg",
      audioSeconds: 5,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "MediaUnavailable" } });
    expect(JSON.stringify(result)).not.toContain("SEGREDO");
  });
});
