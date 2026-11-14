import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import type { Money } from "./money";

/** Milhar bem formado: "1.234", "12.345.678". Não começa com zero. */
const GROUPED = String.raw`[1-9]\d{0,2}(?:\.\d{3})+`;

/** Vírgula é sempre decimal; antes dela, dígitos corridos ou milhar com ponto. */
const WITH_COMMA = new RegExp(String.raw`^(\d+|${GROUPED}),(\d{1,2})$`);
/** Sem vírgula: ponto separando grupos de exatamente 3 dígitos é milhar. */
const GROUPED_ONLY = new RegExp(`^${GROUPED}$`);
/** Sem vírgula: ponto único com 1 ou 2 dígitos depois é decimal. */
const WITH_DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;
const DIGITS_ONLY = /^\d+$/;

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

type Parts = { readonly reais: string; readonly fraction: string };

function splitParts(text: string): Parts | null {
  const withComma = WITH_COMMA.exec(text);
  if (withComma) return { reais: withComma[1] ?? "", fraction: withComma[2] ?? "" };
  if (DIGITS_ONLY.test(text) || GROUPED_ONLY.test(text)) return { reais: text, fraction: "" };
  const withDot = WITH_DOT_DECIMAL.exec(text);
  if (withDot) return { reais: withDot[1] ?? "", fraction: withDot[2] ?? "" };
  return null;
}

/**
 * Converte o valor digitado em reais ("1.234,56", "R$ 12,5", "1234.56") para
 * centavos (RF23.R1). Só aritmética inteira (bigint): o texto nunca passa por
 * `parseFloat` nem `Number`. O valor precisa ser maior que zero.
 *
 * No erro, `value` é `NaN` quando o texto não é um valor legível ou passa do
 * inteiro seguro, e `0` quando o valor digitado é zero.
 */
export function parseBRLInput(
  text: string,
): Result<Money, Extract<DomainError, { code: "InvalidAmount" }>> {
  const cleaned = text.trim().replace(/^R\$/i, "").trim();
  const parts = splitParts(cleaned);
  if (!parts) return fail("InvalidAmount", { value: Number.NaN });

  const reais = BigInt(parts.reais.replaceAll(".", ""));
  const fraction = BigInt(parts.fraction.padEnd(2, "0"));
  const cents = reais * 100n + fraction;

  if (cents > MAX_CENTS) return fail("InvalidAmount", { value: Number.NaN });
  if (cents === 0n) return fail("InvalidAmount", { value: 0 });
  return ok(Number(cents) as Money);
}
