import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { MediaStore } from "@app/core";
import { uuidv7 } from "@app/db";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extensionOf(contentType: string): string {
  return EXTENSIONS[contentType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? "bin";
}

/**
 * `MediaStore` em memória, para testes. A chave é sempre prefixada pelo tenant (a mídia nunca é
 * exposta por endereço público, RF13.R1).
 */
export function createInMemoryMediaStore(): MediaStore & {
  readonly files: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    files,
    async put({ tenantId, bytes, contentType }) {
      const key = `${tenantId}/${uuidv7()}.${extensionOf(contentType)}`;
      files.set(key, { bytes, contentType });
      return { key };
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async signedUrl(key) {
      return `memory://${key}`;
    },
  };
}

/**
 * `MediaStore` em disco, só para desenvolvimento (o S3 chega na E10, com a regra de ciclo de vida
 * de 90 dias do áudio). Recusa `NODE_ENV=production` e qualquer chave que escape da pasta.
 */
export class LocalMediaStoreInProductionError extends Error {
  constructor() {
    super("O LocalMediaStore é só para desenvolvimento e não sobe com NODE_ENV=production");
    this.name = "LocalMediaStoreInProductionError";
  }
}

export function createLocalMediaStore(deps: { directory: string; nodeEnv: string }): MediaStore {
  if (deps.nodeEnv === "production") throw new LocalMediaStoreInProductionError();
  const root = resolve(deps.directory, "store");
  const pathFor = (key: string) => {
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error("chave de mídia fora da pasta");
    return full;
  };
  return {
    async put({ tenantId, bytes, contentType }) {
      const key = `${tenantId}/${uuidv7()}.${extensionOf(contentType)}`;
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      await writeFile(`${path}.type`, contentType);
      return { key };
    },
    async get(key) {
      try {
        const path = pathFor(key);
        const [bytes, contentType] = await Promise.all([
          readFile(path),
          readFile(`${path}.type`, "utf8"),
        ]);
        return { bytes: new Uint8Array(bytes), contentType };
      } catch {
        return null;
      }
    },
    async signedUrl(key) {
      return `file://${join(root, key)}`;
    },
  };
}
