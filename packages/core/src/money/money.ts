import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

declare const moneyBrand: unique symbol;

/**
 * Dinheiro em centavos: inteiro seguro, nunca negativo. Nunca float.
 * Só se cria por `money()`, que valida.
 */
export type Money = number & { readonly [moneyBrand]: "Money" };

export const ZERO = 0 as Money;

export function money(
  cents: number,
): Result<Money, Extract<DomainError, { code: "InvalidAmount" }>> {
  if (!Number.isSafeInteger(cents) || cents < 0) return fail("InvalidAmount", { value: cents });
  return ok(cents as Money);
}

export function add(
  a: Money,
  b: Money,
): Result<Money, Extract<DomainError, { code: "MoneyOverflow" }>> {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) return fail("MoneyOverflow");
  return ok(sum as Money);
}

/** Resultado negativo é rejeitado (dinheiro não é negativo neste domínio). */
export function subtract(
  a: Money,
  b: Money,
): Result<Money, Extract<DomainError, { code: "InvalidAmount" }>> {
  return money(a - b);
}

/**
 * Multiplica por pontos-base (320 = 3,20%) com aritmética inteira (bigint) e
 * arredondamento **meio para cima** (half-up): 0,5 centavo sobe para 1.
 * Como o dinheiro nunca é negativo, não há ambiguidade de sinal.
 */
export function mulBasisPoints(
  amount: Money,
  basisPoints: number,
): Result<Money, Extract<DomainError, { code: "InvalidFeeRate" | "MoneyOverflow" }>> {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    return fail("InvalidFeeRate", { value: basisPoints });
  }
  const scaled = BigInt(amount) * BigInt(basisPoints);
  const rounded = (scaled + 5000n) / 10000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return fail("MoneyOverflow");
  return ok(Number(rounded) as Money);
}

/** "R$ 1.234,56". Só na borda; feito com bigint para não depender de float. */
export function formatBRL(amount: Money): string {
  const cents = BigInt(amount);
  const reais = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (cents % 100n).toString().padStart(2, "0");
  return `R$ ${reais},${rest}`;
}
