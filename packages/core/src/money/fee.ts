import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { add, type Money, money, mulBasisPoints, subtract } from "./money";

export interface FeeRule {
  /** Pontos-base: 320 = 3,20%. De 0 a 10000. */
  readonly feePercentBp: number;
  readonly feeFixedCents: number;
}

export interface FeeBreakdown {
  readonly feeCents: Money;
  readonly netCents: Money;
}

export const NO_FEE: FeeRule = { feePercentBp: 0, feeFixedCents: 0 };

/**
 * Taxa e líquido de um lançamento.
 *
 * Regra de arredondamento (decidida com o dono do produto): a parte percentual
 * é arredondada **meio para cima** em centavos; a taxa fixa já é inteira e é
 * somada depois. `feeCents = round_half_up(amount × bp / 10000) + fixo` e
 * `netCents = amount − feeCents`, então bruto = taxa + líquido fecha sempre.
 * Taxa maior que o valor é erro, não líquido negativo.
 */
export function computeFee(
  amount: Money,
  rule: FeeRule,
): Result<
  FeeBreakdown,
  Extract<
    DomainError,
    { code: "InvalidFeeRate" | "InvalidAmount" | "MoneyOverflow" | "FeeExceedsAmount" }
  >
> {
  if (
    !Number.isSafeInteger(rule.feePercentBp) ||
    rule.feePercentBp < 0 ||
    rule.feePercentBp > 10000
  ) {
    return fail("InvalidFeeRate", { value: rule.feePercentBp });
  }
  const fixed = money(rule.feeFixedCents);
  if (!fixed.ok) return fixed;
  const percent = mulBasisPoints(amount, rule.feePercentBp);
  if (!percent.ok) return percent;
  const fee = add(percent.value, fixed.value);
  if (!fee.ok) return fee;
  if (fee.value > amount) {
    return fail("FeeExceedsAmount", { feeCents: fee.value, amountCents: amount });
  }
  const net = subtract(amount, fee.value);
  if (!net.ok) return net;
  return ok({ feeCents: fee.value, netCents: net.value });
}
