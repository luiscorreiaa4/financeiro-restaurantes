import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryExportStore,
  createLocalExportStore,
  exportFileKey,
} from "./local-export-store";

const TENANT = "0192f0a0-0000-7000-8000-000000000001";
const EXPORT = "0192f0a0-0000-7000-8000-000000000002";
const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "export-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("exportFileKey", () => {
  it("monta a chave com o tenant e o id da exportação", () => {
    expect(exportFileKey(TENANT, EXPORT, "xlsx")).toBe(`exports/${TENANT}/${EXPORT}.xlsx`);
  });
});

describe("store em memória", () => {
  it("grava, lê, sobrescreve e apaga; apagar chave ausente não é erro", async () => {
    const store = createInMemoryExportStore();
    const key = exportFileKey(TENANT, EXPORT, "csv");
    expect(await store.get(key)).toBeNull();
    await store.put(key, new Uint8Array([1, 2]));
    await store.put(key, new Uint8Array([3]));
    expect([...((await store.get(key)) ?? [])]).toEqual([3]);
    expect(store.keys()).toEqual([key]);
    await store.delete(key);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
});

describe("store local", () => {
  it("recusa NODE_ENV=production", () => {
    expect(() => createLocalExportStore("x", "production")).toThrow();
  });

  it("grava dentro da pasta, lê de volta, sobrescreve e apaga", async () => {
    const dir = await tempDir();
    const store = createLocalExportStore(dir, "development");
    const key = exportFileKey(TENANT, EXPORT, "zip");
    expect(await store.get(key)).toBeNull();
    await store.put(key, new Uint8Array([9, 8]));
    await store.put(key, new Uint8Array([7]));
    expect([...((await store.get(key)) ?? [])]).toEqual([7]);
    await store.delete(key);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });

  it("recusa chaves maliciosas antes de tocar o disco", async () => {
    const dir = await tempDir();
    const store = createLocalExportStore(dir, "development");
    const bad = [
      "../x",
      "../../etc/passwd",
      `/exports/${TENANT}/${EXPORT}.xlsx`,
      `exports\\${TENANT}\\${EXPORT}.xlsx`,
      `exports/%2e%2e/${EXPORT}.xlsx`,
      `exports/${TENANT}/${EXPORT}.xlsx\0.png`,
      `exports/${TENANT}/../${EXPORT}.xlsx`,
      `exports/${TENANT}/${EXPORT}.exe`,
      `C:/exports/${TENANT}/${EXPORT}.xlsx`,
      "",
    ];
    for (const key of bad) {
      await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow();
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.delete(key)).rejects.toThrow();
    }
    expect(await readdir(dir)).toEqual([]);
  });
});
