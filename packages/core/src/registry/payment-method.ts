import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { CATALOG_ALIASES_MAX, type CatalogStatus, type PaymentMethodType } from "./catalog-types";
import {
  type CatalogRow,
  findNameCollision,
  isProtectedCatalogName,
  validateAliases,
  validateCatalogName,
} from "./names";

export const CATALOG_NAME_MIN = 2;
export const CATALOG_NAME_MAX = 40;
export const MAX_FEE_BP = 10000;

export interface PaymentMethodInput {
  readonly name: string;
  readonly type: PaymentMethodType;
  readonly feePercentBp: number;
  readonly feeFixedCents: number;
  readonly aliases: readonly string[];
  readonly status: CatalogStatus;
  readonly isDefaultCard: boolean;
}

export interface CatalogValidationContext {
  /** Cadastros da empresa (o editado pode estar na lista; passe `currentId`). */
  readonly existing: readonly CatalogRow[];
  /** Id do cadastro em edição, para não colidir consigo. */
  readonly currentId?: string;
  /** Nome atual do cadastro em edição; se for protegido, a edição é recusada. */
  readonly currentName?: string;
}

/** Confere taxa percentual (RF08.R3) e fixa; usado também pelo canal (só percentual). */
export function checkFeeRate(feePercentBp: number, feeFixedCents = 0): DomainError | null {
  if (!Number.isInteger(feePercentBp) || feePercentBp < 0 || feePercentBp > MAX_FEE_BP) {
    return { code: "InvalidFeeRate", value: feePercentBp };
  }
  if (!Number.isSafeInteger(feeFixedCents) || feeFixedCents < 0) {
    return { code: "InvalidAmount", value: feeFixedCents };
  }
  return null;
}

export function validatePaymentMethod(
  input: PaymentMethodInput,
  ctx: CatalogValidationContext,
): Result<PaymentMethodInput, DomainError> {
  if (ctx.currentName !== undefined && isProtectedCatalogName("payment_method", ctx.currentName)) {
    return fail("SystemCatalogReadOnly");
  }
  const name = validateCatalogName(input.name, { min: CATALOG_NAME_MIN, max: CATALOG_NAME_MAX });
  if (!name.ok) return name;
  if (isProtectedCatalogName("payment_method", name.value)) return fail("SystemCatalogReadOnly");
  const aliases = validateAliases(input.aliases, {
    max: CATALOG_ALIASES_MAX,
    maxLength: CATALOG_NAME_MAX,
  });
  if (!aliases.ok) return aliases;

  const feeError = checkFeeRate(input.feePercentBp, input.feeFixedCents);
  if (feeError) return { ok: false, error: feeError };

  if (input.isDefaultCard) {
    if (input.type !== "credit" && input.type !== "debit") return fail("DefaultCardType");
    if (input.status !== "active") return fail("DefaultCardInactive");
  }

  const conflictId = findNameCollision(
    { id: ctx.currentId, name: name.value, aliases: aliases.value },
    ctx.existing,
  );
  if (conflictId !== null) return fail("NameTaken", { conflictId });

  return ok({ ...input, name: name.value, aliases: aliases.value });
}
