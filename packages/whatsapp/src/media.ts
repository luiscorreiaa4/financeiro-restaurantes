import { fail, type MediaDownloader, ok } from "@app/core";

export interface MetaMediaDownloaderOptions {
  readonly accessToken: string;
  /** Ex.: `v21.0`. Mesma versão usada no envio. */
  readonly apiVersion: string;
  readonly fetch?: typeof fetch;
  /** Só os testes mudam isto. */
  readonly graphBaseUrl?: string;
}

/**
 * Download de mídia recebida na Cloud API (doc da Meta, conferida em 30/10/2026): primeiro um GET
 * em `/<media-id>` devolve a `url` (que vale **5 minutos**); depois um GET na `url` com o mesmo
 * token devolve os bytes. Erro de rede ou resposta fora de 2xx vira `MediaUnavailable`, e o job é
 * retentado com uma URL nova. O token nunca vai para log nem para a mensagem de erro.
 */
export function createMetaMediaDownloader(options: MetaMediaDownloaderOptions): MediaDownloader {
  const doFetch = options.fetch ?? fetch;
  const base = options.graphBaseUrl ?? "https://graph.facebook.com";
  const headers = { authorization: `Bearer ${options.accessToken}` };
  return {
    async download(mediaId) {
      try {
        const meta = await doFetch(`${base}/${options.apiVersion}/${encodeURIComponent(mediaId)}`, {
          headers,
        });
        if (!meta.ok) return fail("MediaUnavailable", { detail: `meta_${meta.status}` });
        const info = (await meta.json()) as { url?: unknown; mime_type?: unknown };
        if (typeof info.url !== "string") return fail("MediaUnavailable", { detail: "sem_url" });
        const file = await doFetch(info.url, { headers });
        if (!file.ok) return fail("MediaUnavailable", { detail: `download_${file.status}` });
        const contentType =
          file.headers.get("content-type") ??
          (typeof info.mime_type === "string" ? info.mime_type : "application/octet-stream");
        return ok({ bytes: new Uint8Array(await file.arrayBuffer()), contentType });
      } catch {
        return fail("MediaUnavailable", { detail: "rede" });
      }
    },
  };
}
