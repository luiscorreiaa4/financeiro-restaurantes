import { describe, expect, it } from "vitest";
import { createMetaMediaDownloader } from "./media";
import { parseWebhook } from "./parse";
import { buildMediaWebhookPayload } from "./simulate";

const SENT_AT = new Date("2026-10-30T15:00:00Z");

describe("payload simulado de mídia", () => {
  it("áudio passa pelo mesmo parser do webhook real e vira mensagem de áudio", () => {
    const payload = buildMediaWebhookPayload({
      waId: "551187654321",
      waMessageId: "dev.wamid.1",
      kind: "audio",
      mediaId: "dev.media.1",
      mimeType: "audio/ogg; codecs=opus",
      sentAt: SENT_AT,
    });
    const [message] = parseWebhook(payload).messages;
    expect(message).toMatchObject({ waMessageId: "dev.wamid.1", type: "audio" });
    const raw = message?.raw as { message: { audio: { id: string; mime_type: string } } };
    expect(raw.message.audio).toMatchObject({
      id: "dev.media.1",
      mime_type: "audio/ogg; codecs=opus",
    });
  });

  it("imagem leva a legenda", () => {
    const payload = buildMediaWebhookPayload({
      waId: "551187654321",
      waMessageId: "dev.wamid.2",
      kind: "image",
      mediaId: "dev.media.2",
      mimeType: "image/jpeg",
      caption: "nota do mercado",
      sentAt: SENT_AT,
    });
    const [message] = parseWebhook(payload).messages;
    expect(message?.type).toBe("image");
    const raw = message?.raw as { message: { image: { caption: string } } };
    expect(raw.message.image.caption).toBe("nota do mercado");
  });
});

describe("download de mídia da Meta", () => {
  const options = { accessToken: "SEGREDO-TOKEN", apiVersion: "v21.0" };

  function fakeFetch(routes: Record<string, () => Response>) {
    const calls: { url: string; auth: string | null }[] = [];
    const impl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const route = routes[url];
      if (!route) return new Response("", { status: 404 });
      return route();
    };
    return { impl, calls };
  }

  it("busca a URL pelo id e baixa os bytes, sempre com o token", async () => {
    const { impl, calls } = fakeFetch({
      "https://graph.facebook.com/v21.0/123": () =>
        Response.json({ url: "https://lookaside.example/abc", mime_type: "audio/ogg" }),
      "https://lookaside.example/abc": () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg" } }),
    });
    const result = await createMetaMediaDownloader({ ...options, fetch: impl }).download("123");
    expect(result).toEqual({
      ok: true,
      value: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg" },
    });
    expect(calls.map((call) => call.auth)).toEqual([
      "Bearer SEGREDO-TOKEN",
      "Bearer SEGREDO-TOKEN",
    ]);
  });

  it("id desconhecido vira MediaUnavailable sem vazar o token", async () => {
    const { impl } = fakeFetch({});
    const result = await createMetaMediaDownloader({ ...options, fetch: impl }).download("999");
    expect(result).toEqual({ ok: false, error: { code: "MediaUnavailable", detail: "meta_404" } });
    expect(JSON.stringify(result)).not.toContain("SEGREDO");
  });

  it("URL expirada no segundo passo também é MediaUnavailable (o job será retentado)", async () => {
    const { impl } = fakeFetch({
      "https://graph.facebook.com/v21.0/123": () => Response.json({ url: "https://x.example/y" }),
      "https://x.example/y": () => new Response("", { status: 404 }),
    });
    const result = await createMetaMediaDownloader({ ...options, fetch: impl }).download("123");
    expect(result).toEqual({
      ok: false,
      error: { code: "MediaUnavailable", detail: "download_404" },
    });
  });

  it("resposta sem url e queda de rede são tratadas", async () => {
    const noUrl = fakeFetch({ "https://graph.facebook.com/v21.0/1": () => Response.json({}) });
    expect(
      await createMetaMediaDownloader({ ...options, fetch: noUrl.impl }).download("1"),
    ).toMatchObject({ ok: false, error: { detail: "sem_url" } });

    const down: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    expect(await createMetaMediaDownloader({ ...options, fetch: down }).download("1")).toEqual({
      ok: false,
      error: { code: "MediaUnavailable", detail: "rede" },
    });
  });
});
