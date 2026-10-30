import type { BusinessDate, Clock } from "@app/core";

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** Data de negócio (YYYY-MM-DD) de um instante em um fuso. `en-CA` formata como ISO. */
export function businessDateOf(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): BusinessDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function createSystemClock(): Clock {
  return {
    now: () => new Date(),
    today: (timeZone) => businessDateOf(new Date(), timeZone),
  };
}

/** Relógio determinístico para testes: `set` move o tempo. */
export function createFixedClock(start: Date): Clock & { set(next: Date): void } {
  let current = start;
  return {
    now: () => current,
    today: (timeZone) => businessDateOf(current, timeZone),
    set(next) {
      current = next;
    },
  };
}
