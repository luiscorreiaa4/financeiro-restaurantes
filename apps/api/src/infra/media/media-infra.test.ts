import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevFileMediaDownloader, mediaTypeOfFile } from "./dev-file-media-downloader";
import { CONVERTED_BITS_PER_SECOND, createFfmpegAudioConverter } from "./ffmpeg-audio-converter";
import {
  createInMemoryMediaStore,
  createLocalMediaStore,
  LocalMediaStoreInProductionError,
} from "./local-media-store";
import { createQrReader } from "./qr-reader";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const TENANT = "0190a000-0000-7000-8000-000000000001";

describe("armazenamento de mídia", () => {
  it("em memória: a chave é prefixada pelo tenant e a mídia volta igual", async () => {
    const store = createInMemoryMediaStore();
    const { key } = await store.put({
      tenantId: TENANT,
      bytes: new Uint8Array([1, 2]),
      contentType: "audio/ogg; codecs=opus",
    });
    expect(key.startsWith(`${TENANT}/`)).toBe(true);
    expect(key.endsWith(".ogg")).toBe(true);
    expect(await store.get(key)).toEqual({
      bytes: new Uint8Array([1, 2]),
      contentType: "audio/ogg; codecs=opus",
    });
    expect(await store.get("outro/arquivo")).toBeNull();
  });

  it("em disco: grava, lê e não deixa a chave escapar da pasta", async () => {
    const store = createLocalMediaStore({ directory: dir, nodeEnv: "test" });
    const { key } = await store.put({
      tenantId: TENANT,
      bytes: new Uint8Array([9, 8, 7]),
      contentType: "image/jpeg",
    });
    expect(key.endsWith(".jpg")).toBe(true);
    expect(await store.get(key)).toEqual({
      bytes: new Uint8Array([9, 8, 7]),
      contentType: "image/jpeg",
    });
    expect(await store.get("../../etc/passwd")).toBeNull();
  });

  it("em disco: recusa subir em produção", () => {
    expect(() => createLocalMediaStore({ directory: dir, nodeEnv: "production" })).toThrow(
      LocalMediaStoreInProductionError,
    );
  });
});

describe("downloader de desenvolvimento", () => {
  it("lê o arquivo que o chat guardou pelo id e descobre o tipo pela extensão", async () => {
    await writeFile(join(dir, "dev.media.1.ogg"), new Uint8Array([1, 2, 3]));
    const downloader = createDevFileMediaDownloader({ directory: dir, nodeEnv: "test" });
    expect(await downloader.download("dev.media.1")).toEqual({
      ok: true,
      value: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg; codecs=opus" },
    });
  });

  it("id que não existe ou tenta sair da pasta vira MediaUnavailable", async () => {
    const downloader = createDevFileMediaDownloader({ directory: dir, nodeEnv: "test" });
    expect(await downloader.download("nao-existe")).toMatchObject({
      ok: false,
      error: { code: "MediaUnavailable" },
    });
    expect(await downloader.download("../../etc/passwd")).toMatchObject({ ok: false });
  });

  it("extensão desconhecida não vira mídia", () => {
    expect(mediaTypeOfFile("nota.pdf")).toBeNull();
    expect(mediaTypeOfFile("NOTA.JPG")).toBe("image/jpeg");
  });
});

describe("conversor de áudio (ffmpeg)", () => {
  it("lê o áudio pela entrada e devolve o que o programa escreve, como MP3 de 32 kbps", async () => {
    // Um "ffmpeg" de mentira: copia a entrada para a saída.
    const converter = createFfmpegAudioConverter({
      command: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
    });
    const result = await converter.toMp3({
      bytes: new Uint8Array([5, 6, 7]),
      contentType: "audio/ogg; codecs=opus",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        bytes: new Uint8Array([5, 6, 7]),
        contentType: "audio/mpeg",
        bitsPerSecond: CONVERTED_BITS_PER_SECOND,
      },
    });
  });

  it("ffmpeg que não está instalado vira ffmpeg_ausente (o job é retentado)", async () => {
    const converter = createFfmpegAudioConverter({ command: "ffmpeg-que-nao-existe-xyz" });
    expect(await converter.toMp3({ bytes: new Uint8Array([1]), contentType: "audio/ogg" })).toEqual(
      {
        ok: false,
        error: { code: "MediaUnavailable", detail: "ffmpeg_ausente" },
      },
    );
  });

  it("programa que falha ou não produz saída vira ffmpeg_falhou", async () => {
    const fails = createFfmpegAudioConverter({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
    });
    expect(
      await fails.toMp3({ bytes: new Uint8Array([1]), contentType: "audio/ogg" }),
    ).toMatchObject({ ok: false, error: { detail: "ffmpeg_falhou" } });
    const silent = createFfmpegAudioConverter({
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"],
    });
    expect(
      await silent.toMp3({ bytes: new Uint8Array([1]), contentType: "audio/ogg" }),
    ).toMatchObject({ ok: false, error: { detail: "ffmpeg_falhou" } });
  });

  it("programa que trava é morto no tempo limite", async () => {
    const hangs = createFfmpegAudioConverter({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 200,
    });
    expect(await hangs.toMp3({ bytes: new Uint8Array([1]), contentType: "audio/ogg" })).toEqual({
      ok: false,
      error: { code: "MediaUnavailable", detail: "ffmpeg_timeout" },
    });
  });
});

describe("leitor de QR Code", () => {
  const URL =
    "https://www.nfce.fazenda.sp.gov.br/qrcode?p=35261012345678000190650010000001231000001235|2|1|1|ABC";

  it("lê o QR de uma imagem PNG", async () => {
    const png = await QRCode.toBuffer(URL, { type: "png", width: 400, margin: 4 });
    const text = createQrReader().read({ bytes: new Uint8Array(png), contentType: "image/png" });
    expect(text).toBe(URL);
  });

  it("devolve nulo para imagem sem QR, formato não suportado e arquivo corrompido", async () => {
    const reader = createQrReader();
    // PNG todo branco, sem QR.
    const { PNG } = await import("pngjs");
    const blank = new PNG({ width: 50, height: 50 });
    blank.data.fill(255);
    expect(
      reader.read({ bytes: new Uint8Array(PNG.sync.write(blank)), contentType: "image/png" }),
    ).toBeNull();
    expect(reader.read({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp" })).toBeNull();
    expect(reader.read({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" })).toBeNull();
  });
});
