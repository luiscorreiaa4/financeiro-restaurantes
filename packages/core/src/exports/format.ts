// Formatação de células da exportação (RF29.R1). Dinheiro é inteiro em centavos: nenhuma
// conta com ponto flutuante (RNF13).

/** Centavos como texto decimal com vírgula e sem separador de milhar: -123456 vira "-1234,56". */
export function centsToDecimalText(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("centavos devem ser inteiro seguro");
  const negative = cents < 0;
  const abs = negative ? -BigInt(cents) : BigInt(cents);
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole},${fraction}`;
}

const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de negócio `AAAA-MM-DD` como `dd/mm/aaaa`, só trocando a ordem (sem `Date`). */
export function businessDateToBR(date: string): string {
  const match = BUSINESS_DATE.exec(date);
  if (!match) throw new RangeError("data de negócio deve ser AAAA-MM-DD");
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Instante ISO 8601 como `dd/mm/aaaa hh:mm` no fuso informado (padrão São Paulo). */
export function timestampToBR(iso: string, tz = "America/Sao_Paulo"): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError("instante inválido");
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Texto que a planilha leria como fórmula ganha um apóstrofo na frente (injeção de fórmula). */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}
