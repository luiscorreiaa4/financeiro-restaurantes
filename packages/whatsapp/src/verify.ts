import { createHash, timingSafeEqual } from "node:crypto";

export type VerifyResult =
  | { readonly ok: true; readonly challenge: string }
  | { readonly ok: false };

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Comparação em tempo constante, sem vazar o tamanho do segredo (compara os hashes). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Handshake do GET de verificação: `hub.mode=subscribe`, `hub.verify_token` igual ao
 * nosso e `hub.challenge` presente. Qualquer outra coisa é recusada.
 */
export function verifyHandshake(input: {
  query: Record<string, unknown>;
  verifyToken: string;
}): VerifyResult {
  const mode = input.query["hub.mode"];
  const token = input.query["hub.verify_token"];
  const challenge = input.query["hub.challenge"];
  if (mode !== "subscribe") return { ok: false };
  if (typeof token !== "string" || !safeEqual(token, input.verifyToken)) return { ok: false };
  if (typeof challenge !== "string" || challenge === "") return { ok: false };
  return { ok: true, challenge };
}
