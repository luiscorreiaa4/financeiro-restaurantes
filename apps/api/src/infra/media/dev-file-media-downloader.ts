import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fail, type MediaDownloader, ok } from "@app/core";

const TYPES: Readonly<Record<string, string>> = {
  ogg: "audio/ogg; codecs=opus",
  opus: "audio/ogg; codecs=opus",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export class DevMediaInProductionError extends Error {
  constructor() {
    super("O DevFileMediaDownloader é só para desenvolvimento e não sobe com NODE_ENV=production");
    this.name = "DevMediaInProductionError";
  }
}

/** Tipo de mídia pela extensão do arquivo que o chat guardou. */
export function mediaTypeOfFile(fileName: string): string | null {
  return TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/**
 * `MediaDownloader` do chat de desenvolvimento (plano do canal, seção 3.6): em vez de baixar da
 * Meta, lê o arquivo que o `/audio` ou o `/foto` copiou para `DEV_MEDIA_DIR/<id>.<extensão>`.
 */
export function createDevFileMediaDownloader(deps: {
  directory: string;
  nodeEnv: string;
}): MediaDownloader {
  if (deps.nodeEnv === "production") throw new DevMediaInProductionError();
  return {
    async download(mediaId) {
      // O id vem do payload: nunca vira caminho sem passar pela listagem da pasta.
      let names: string[];
      try {
        names = await readdir(deps.directory);
      } catch {
        return fail("MediaUnavailable", { detail: "pasta_dev_ausente" });
      }
      const name = names.find((candidate) => candidate.startsWith(`${mediaId}.`));
      const contentType = name === undefined ? null : mediaTypeOfFile(name);
      if (name === undefined || contentType === null) {
        return fail("MediaUnavailable", { detail: "arquivo_dev_ausente" });
      }
      const bytes = await readFile(join(deps.directory, name));
      return ok({ bytes: new Uint8Array(bytes), contentType });
    },
  };
}
