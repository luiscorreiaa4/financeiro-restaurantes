import { pino } from "pino";

/** O que os casos de uso precisam de um logger; o `pino` já satisfaz. */
export interface JobLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Campos que nunca podem chegar ao log (regra 9): conteúdo de mensagem, payload bruto e
 * telefones. Os casos de uso já não os passam; o `redact` é a segunda barreira.
 */
export const REDACTED_FIELDS = [
  "text",
  "raw",
  "transcription",
  "waId",
  "waUserId",
  "phone",
  "*.text",
  "*.raw",
  "*.transcription",
  "*.waId",
  "*.waUserId",
  "*.phone",
];

export function createLogger(level: string, stream?: { write(line: string): void }): pino.Logger {
  return pino({ level, redact: { paths: REDACTED_FIELDS, censor: "[Redacted]" } }, stream);
}
