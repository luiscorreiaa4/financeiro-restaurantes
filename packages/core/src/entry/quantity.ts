import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

/**
 * Quantidade (ex.: 2,5 kg) em milésimos, inteira. Aceita até 3 casas decimais.
 * Evita multiplicar valor por float: quantidade × preço é feito em bigint.
 */
export function quantityToMilli(
  quantity: number,
): Result<bigint, Extract<DomainError, { code: "InvalidQuantity" }>> {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(quantity));
  if (!Number.isFinite(quantity) || quantity <= 0 || !match) {
    return fail("InvalidQuantity", { value: quantity });
  }
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(3, "0");
  return ok(BigInt(whole) * 1000n + BigInt(fraction));
}
