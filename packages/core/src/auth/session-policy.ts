/** Sem "manter conectado", a sessão vence após 12 h sem uso (RF02.R5). */
export const SESSION_IDLE_HOURS = 12;
/** Com "manter conectado", 30 dias renovados a cada uso (RF02.R5). */
export const SESSION_KEEP_CONNECTED_DAYS = 30;
/** A renovação é gravada no máximo a cada 5 min, para não escrever a cada requisição. */
export const SESSION_TOUCH_MINUTES = 5;

const HOUR_MS = 60 * 60 * 1000;

/** Novo vencimento da sessão a partir do uso em `now`. */
export function sessionExpiresAt(input: { keepConnected: boolean; now: Date }): Date {
  const ms = input.keepConnected
    ? SESSION_KEEP_CONNECTED_DAYS * 24 * HOUR_MS
    : SESSION_IDLE_HOURS * HOUR_MS;
  return new Date(input.now.getTime() + ms);
}

/** O último registro de uso é velho o bastante para renovar o vencimento. */
export function shouldTouchSession(input: { lastTouchedAt: Date; now: Date }): boolean {
  return input.now.getTime() - input.lastTouchedAt.getTime() >= SESSION_TOUCH_MINUTES * 60 * 1000;
}
