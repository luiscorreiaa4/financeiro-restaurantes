import { spawn } from "node:child_process";
import { type AudioConverter, fail, ok } from "@app/core";

/** MP3 em taxa constante de 32 kbps: a duração sai do tamanho (limite de 180 s antes da IA). */
export const CONVERTED_BITS_PER_SECOND = 32_000;

export interface FfmpegAudioConverterOptions {
  /** Padrão `ffmpeg` no PATH. Só os testes mudam isto (e `args`). */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
}

/**
 * Converte o áudio recebido (OGG/Opus do WhatsApp, formato que a transcrição da OpenAI não lista)
 * para MP3 mono de 16 kHz, 32 kbps CBR, lendo e escrevendo por pipe (nada vai para o disco). Exige
 * o `ffmpeg` instalado no servidor; sem ele a conversão falha com `ffmpeg_ausente` e o job é
 * retentado até a falha definitiva avisar o usuário.
 */
export function createFfmpegAudioConverter(
  options: FfmpegAudioConverterOptions = {},
): AudioConverter {
  const command = options.command ?? "ffmpeg";
  const args = options.args ?? [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    `${CONVERTED_BITS_PER_SECOND / 1000}k`,
    "-f",
    "mp3",
    "pipe:1",
  ];
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    toMp3({ bytes }) {
      return new Promise((resolve) => {
        const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "ignore"] });
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = (result: Awaited<ReturnType<AudioConverter["toMp3"]>>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(fail("MediaUnavailable", { detail: "ffmpeg_timeout" }));
        }, timeoutMs);

        child.on("error", (error: NodeJS.ErrnoException) => {
          finish(
            fail("MediaUnavailable", {
              detail: error.code === "ENOENT" ? "ffmpeg_ausente" : "ffmpeg_erro",
            }),
          );
        });
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.on("close", (code) => {
          const output = Buffer.concat(chunks);
          if (code !== 0 || output.length === 0) {
            finish(fail("MediaUnavailable", { detail: "ffmpeg_falhou" }));
            return;
          }
          finish(
            ok({
              bytes: new Uint8Array(output),
              contentType: "audio/mpeg" as const,
              bitsPerSecond: CONVERTED_BITS_PER_SECOND,
            }),
          );
        });
        // Se o ffmpeg fechar a entrada antes de ler tudo, o EPIPE não pode derrubar o worker.
        child.stdin.on("error", () => undefined);
        child.stdin.end(Buffer.from(bytes));
      });
    },
  };
}
