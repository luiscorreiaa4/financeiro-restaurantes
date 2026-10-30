/**
 * Limites de uso e proteção contra abuso (RF21). `[PROVISÓRIO – P03]`: valores sugeridos nos
 * requisitos, configuráveis por plano; ficam numa constante única para trocar sem retrabalho.
 */
export interface UsageLimits {
  /** Duração máxima de um áudio, em segundos (RF13.R2). */
  readonly maxAudioSeconds: number;
  /** Tamanho máximo de uma imagem, em bytes (RF14.R1). */
  readonly maxImageBytes: number;
  /** Mensagens por usuário por hora (RF21.R2). */
  readonly messagesPerUserPerHour: number;
  /** Mensagens por empresa por dia (RF21.R2). */
  readonly messagesPerTenantPerDay: number;
}

export const DEFAULT_USAGE_LIMITS: UsageLimits = {
  maxAudioSeconds: 180,
  maxImageBytes: 5 * 1024 * 1024,
  messagesPerUserPerHour: 60,
  messagesPerTenantPerDay: 1000,
};

export type RateLimitDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "limited"; readonly scope: "user" | "tenant" };

/**
 * Decide se a mensagem que acabou de chegar passa. As contagens já incluem a própria mensagem,
 * então o limite é excedido quando a contagem passa de `limit`.
 */
export function evaluateRateLimit(
  counts: { readonly userLastHour: number; readonly tenantLastDay: number },
  limits: UsageLimits = DEFAULT_USAGE_LIMITS,
): RateLimitDecision {
  if (counts.userLastHour > limits.messagesPerUserPerHour)
    return { kind: "limited", scope: "user" };
  if (counts.tenantLastDay > limits.messagesPerTenantPerDay) {
    return { kind: "limited", scope: "tenant" };
  }
  return { kind: "allowed" };
}

/** Duração de um mp3 em taxa constante, a partir do tamanho (o conversor gera 32 kbps). */
export function cbrAudioSeconds(byteLength: number, bitsPerSecond: number): number {
  return (byteLength * 8) / bitsPerSecond;
}
