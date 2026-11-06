export { formatBRL } from "@app/core";

const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const brDate = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Data de negócio (`YYYY-MM-DD`, sem hora) como `dd/MM/yyyy`.
 * Nunca usa `new Date("YYYY-MM-DD")`, que lê como UTC e pode mostrar o dia anterior.
 * Meio-dia UTC fica no mesmo dia em America/Sao_Paulo.
 */
export function formatBusinessDate(date: string): string {
  const match = BUSINESS_DATE.exec(date);
  if (!match) throw new RangeError(`Data de negócio inválida: "${date}"`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const instant = new Date(Date.UTC(year, month - 1, day, 12));
  const exists =
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day;
  if (!exists) throw new RangeError(`Data de negócio inexistente: "${date}"`);
  return brDate.format(instant);
}
