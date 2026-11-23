import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ExportFileStore } from "@app/core";

export type ExportFileExt = "xlsx" | "csv" | "zip";

export function exportFileKey(tenantId: string, exportId: string, ext: ExportFileExt): string {
  return `exports/${tenantId}/${exportId}.${ext}`;
}

// Chave estrita: validada antes de qualquer acesso a disco (sem `..`, barra invertida, `%`, nulo).
const KEY_PATTERN = /^exports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(xlsx|csv|zip)$/;

export function createInMemoryExportStore(): ExportFileStore & { keys(): string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      files.set(key, bytes);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    keys: () => [...files.keys()],
  };
}

/** Em disco, só para desenvolvimento (o S3 vem na E10). Recusa `NODE_ENV=production`. */
export function createLocalExportStore(dir: string, nodeEnv: string): ExportFileStore {
  if (nodeEnv === "production") {
    throw new Error("O store local de exportações é só para desenvolvimento");
  }
  const root = resolve(dir);
  const pathFor = (key: string): string => {
    if (!KEY_PATTERN.test(key)) throw new Error("chave de exportação inválida");
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error("chave de exportação fora da pasta");
    return full;
  };
  return {
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      const path = pathFor(key);
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
