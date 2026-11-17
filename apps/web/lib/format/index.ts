import { formatBRL, money } from "@app/core";

export { formatBRL };

/**
 * Centavos do contrato da API (`number` inteiro, D-F4) como "R$ 1.234,56". O sinal só existe
 * no resultado (receitas menos despesas, que o servidor calcula) e vai na frente: "-R$ 5,00".
 * Não faz conta com dinheiro; valor que não é inteiro seguro é erro, nunca arredondamento.
 */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Centavos inválidos: ${cents}`);
  const amount = money(Math.abs(cents));
  if (!amount.ok) throw new RangeError(`Centavos inválidos: ${cents}`);
  return cents < 0 ? `-${formatBRL(amount.value)}` : formatBRL(amount.value);
}

/**
 * Percentual em décimos de ponto percentual (`123` é "12,3%", DD-41) com uma casa. Só formata
 * o que o servidor calculou: não arredonda nem converte. `null` (sem denominador) vira "—".
 */
export function formatPermille(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isSafeInteger(value)) throw new RangeError(`Percentual inválido: ${value}`);
  const abs = Math.abs(value);
  const text = `${Math.trunc(abs / 10)},${abs % 10}%`;
  return value < 0 ? `-${text}` : text;
}

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

const businessDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia de hoje em America/Sao_Paulo como data de negócio (`YYYY-MM-DD`). `now` é um instante. */
export function todayBusinessDate(now: Date = new Date()): string {
  return businessDay.format(now);
}
