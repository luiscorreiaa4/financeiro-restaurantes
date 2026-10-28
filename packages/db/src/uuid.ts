import { randomBytes } from "node:crypto";

export interface UuidV7Options {
  /** Milissegundos desde a época Unix. Injetável para testes. */
  readonly now?: number;
  /** 10 bytes aleatórios. Injetável para testes. */
  readonly random?: Uint8Array;
}

/** UUID v7 (RFC 9562): 48 bits de timestamp, versão 7, variante 10 e 74 bits aleatórios. */
export function uuidv7(options: UuidV7Options = {}): string {
  const now = options.now ?? Date.now();
  const random = options.random ?? randomBytes(10);
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RangeError("uuidv7: timestamp fora de 48 bits");
  }
  if (random.length < 10) throw new RangeError("uuidv7: são necessários 10 bytes aleatórios");

  const bytes = new Uint8Array(16);
  let rest = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  bytes.set(random.subarray(0, 10), 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
