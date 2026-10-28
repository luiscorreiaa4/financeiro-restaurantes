import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { type Money, money } from "../money";
import type { ExtractedEntry } from "./extraction";
import { quantityToMilli } from "./quantity";

/** Diferença aceita (em centavos) entre quantidade × preço e o total, por arredondamento de nota. */
export const AMOUNT_TOLERANCE_CENTS = 1;

type AmountError = Extract<
  DomainError,
  {
    code:
      | "AmountMissing"
      | "AmountNotPositive"
      | "AmountInconsistent"
      | "InvalidAmount"
      | "InvalidQuantity";
  }
>;

/**
 * Valor final do lançamento, decidido pelo sistema (a IA nunca faz conta):
 * - só total → usa o total;
 * - só quantidade × preço unitário → calcula (meio para cima, em inteiros);
 * - os três → confere; se divergir mais que a tolerância, `AmountInconsistent`
 *   (o fluxo pergunta ao usuário); se bater, vale o total informado.
 */
export function resolveAmount(extracted: ExtractedEntry): Result<Money, AmountError> {
  const { quantity, unit_price_cents: unitPrice, total_cents: total } = extracted;

  let computed: number | null = null;
  if (quantity !== null && unitPrice !== null) {
    const milli = quantityToMilli(quantity);
    if (!milli.ok) return milli;
    const unit = money(unitPrice);
    if (!unit.ok) return unit;
    const value = (milli.value * BigInt(unit.value) + 500n) / 1000n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return fail("InvalidAmount", { value: unitPrice });
    computed = Number(value);
  }

  const chosen = total ?? computed;
  if (chosen === null) return fail("AmountMissing");

  const amount = money(chosen);
  if (!amount.ok) return amount;
  if (total !== null && computed !== null && Math.abs(total - computed) > AMOUNT_TOLERANCE_CENTS) {
    return fail("AmountInconsistent", { computedCents: computed, statedCents: total });
  }
  if (amount.value === 0) return fail("AmountNotPositive");
  return amount;
}
