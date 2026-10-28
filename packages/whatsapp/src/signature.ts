import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/**
 * Valida `X-Hub-Signature-256` sobre os bytes exatos recebidos (HMAC-SHA256 com o App
 * Secret). A comparação é em tempo constante. Cabeçalho ausente, sem o prefixo ou com
 * tamanho errado é inválido, nunca erro.
 */
export function isValidSignature(input: {
  rawBody: Uint8Array;
  header: string | undefined;
  appSecret: string;
}): boolean {
  const { rawBody, header, appSecret } = input;
  if (!header?.startsWith(PREFIX)) return false;
  const received = Buffer.from(header.slice(PREFIX.length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  // Hex malformado vira buffer menor; timingSafeEqual exige tamanhos iguais.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/** Gera o cabeçalho que a Meta enviaria. Útil em testes e em ferramentas de simulação. */
export function signBody(rawBody: Uint8Array, appSecret: string): string {
  return `${PREFIX}${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}
