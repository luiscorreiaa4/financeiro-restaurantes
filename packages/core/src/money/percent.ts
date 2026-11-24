import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

const MAX_BP = 10000;

/**
 * Converte o texto digitado ("3,2", "3,25 %", "100") em pontos-base inteiros (320, 325, 10000).
 * Aceita vírgula ou ponto, até 2 casas e de 0 a 100 (RF08.R3, CA05). Sem ponto flutuante.
 */
export function parsePercentToBp(
  text: string,
): Result<number, Extract<DomainError, { code: "InvalidFeeRate" }>> {
  const cleaned = text.replace("%", "").trim();
  const match = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) return fail("InvalidFeeRate", { value: Number.NaN });
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bp = whole * 100 + fraction;
  if (bp > MAX_BP) return fail("InvalidFeeRate", { value: bp });
  return ok(bp);
}

/** 320 vira "3,20 %". */
export function formatBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(bp % 100).padStart(2, "0");
  return `${whole},${fraction} %`;
}
