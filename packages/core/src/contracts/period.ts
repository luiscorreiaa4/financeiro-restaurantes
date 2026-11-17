import type { BusinessDate } from "../entry/business-date";
import { isBusinessDate } from "../entry/business-date";

/**
 * Atalhos de período da lista de lançamentos (RF22.R1). `custom` é o intervalo digitado
 * pelo usuário: não tem o que resolver.
 */
export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "current_month",
  "previous_month",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
/** Atalhos que viram um intervalo a partir de hoje. */
export type ResolvablePeriodPreset = Exclude<PeriodPreset, "custom">;

/** Máximo de meses por consulta (RF22.R1). */
export const MAX_PERIOD_MONTHS = 24;

export interface Period {
  readonly from: BusinessDate;
  readonly to: BusinessDate;
}

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

// Toda a conta é feita sobre o texto AAAA-MM-DD: sem `Date`, sem fuso (RNF13.R4).
function parts(date: BusinessDate): DateParts {
  if (!isBusinessDate(date)) throw new RangeError("invalid business date");
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function format({ year, month, day }: DateParts): BusinessDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Desloca o mês, sem mexer no dia. */
function shiftMonth(year: number, month: number, months: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function previousDay({ year, month, day }: DateParts): DateParts {
  if (day > 1) return { year, month, day: day - 1 };
  const previous = shiftMonth(year, month, -1);
  return { ...previous, day: daysInMonth(previous.year, previous.month) };
}

function subtractDays(date: DateParts, days: number): DateParts {
  let current = date;
  for (let step = 0; step < days; step += 1) current = previousDay(current);
  return current;
}

function wholeMonth(year: number, month: number): Period {
  return {
    from: format({ year, month, day: 1 }),
    to: format({ year, month, day: daysInMonth(year, month) }),
  };
}

/**
 * Soma meses a uma data de negócio. Quando o dia não existe no mês de destino, vale o
 * último dia dele (30/11 + 3 meses = 28/02).
 */
export function addMonthsToBusinessDate(date: BusinessDate, months: number): BusinessDate {
  const { year, month, day } = parts(date);
  const target = shiftMonth(year, month, months);
  return format({ ...target, day: Math.min(day, daysInMonth(target.year, target.month)) });
}

/**
 * O intervalo cabe no limite de 24 meses: `to` não passa de `from` + 24 meses
 * (exatamente 24 meses é aceito; 24 meses e 1 dia, não). Não confere `from <= to`.
 */
export function periodWithinLimit(from: BusinessDate, to: BusinessDate): boolean {
  // Datas AAAA-MM-DD válidas ordenam como texto.
  return to <= addMonthsToBusinessDate(from, MAX_PERIOD_MONTHS);
}

/**
 * Intervalo de um atalho. `today` é a data de hoje já no fuso de quem consulta; lança
 * `RangeError` se não for uma data de negócio válida.
 */
export function resolvePeriod(preset: ResolvablePeriodPreset, today: BusinessDate): Period {
  const now = parts(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = format(previousDay(now));
      return { from: yesterday, to: yesterday };
    }
    case "last_7_days":
      return { from: format(subtractDays(now, 6)), to: today };
    case "current_month":
      return wholeMonth(now.year, now.month);
    case "previous_month": {
      const previous = shiftMonth(now.year, now.month, -1);
      return wholeMonth(previous.year, previous.month);
    }
  }
}

export const COMPARISON_KINDS = ["previous_period", "previous_year", "none"] as const;
export type ComparisonKind = (typeof COMPARISON_KINDS)[number];

// Número de dias desde 0000-03-01 (calendário gregoriano), só para contar dias entre datas.
function dayNumber({ year, month, day }: DateParts): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

/**
 * Período de comparação do dashboard (RF27.R2). `previous_period` tem o mesmo número de
 * dias, imediatamente antes; `previous_year` anda 12 meses nos dois extremos (29/02 vira
 * 28/02, e o intervalo pode ficar um dia menor, DD-41); `none` não compara.
 */
export function comparisonPeriod(period: Period, kind: ComparisonKind): Period | null {
  switch (kind) {
    case "none":
      return null;
    case "previous_year":
      return {
        from: addMonthsToBusinessDate(period.from, -12),
        to: addMonthsToBusinessDate(period.to, -12),
      };
    case "previous_period": {
      const from = parts(period.from);
      const length = dayNumber(parts(period.to)) - dayNumber(from) + 1;
      const to = previousDay(from);
      return { from: format(subtractDays(to, length - 1)), to: format(to) };
    }
  }
}

/** Janela de `count` meses que termina no mês de `to`: do dia 1 do primeiro mês até `to`. */
export function monthsWindow(to: BusinessDate, count: number): Period {
  const { year, month } = parts(to);
  const first = shiftMonth(year, month, -(count - 1));
  return { from: format({ ...first, day: 1 }), to };
}

/** Meses "AAAA-MM" da janela, em ordem crescente. */
export function monthsOf(to: BusinessDate, count: number): readonly string[] {
  const { year, month } = parts(to);
  return Array.from({ length: count }, (_, index) => {
    const m = shiftMonth(year, month, index - (count - 1));
    return `${String(m.year).padStart(4, "0")}-${String(m.month).padStart(2, "0")}`;
  });
}
