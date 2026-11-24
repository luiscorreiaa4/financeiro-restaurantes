import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { CATALOG_ALIASES_MAX, type CatalogStatus, type SalesChannelType } from "./catalog-types";
import {
  findNameCollision,
  isProtectedCatalogName,
  validateAliases,
  validateCatalogName,
} from "./names";
import {
  CATALOG_NAME_MAX,
  CATALOG_NAME_MIN,
  type CatalogValidationContext,
  checkFeeRate,
} from "./payment-method";

export interface SalesChannelInput {
  readonly name: string;
  readonly type: SalesChannelType;
  readonly feePercentBp: number;
  readonly aliases: readonly string[];
  readonly status: CatalogStatus;
}

export function validateSalesChannel(
  input: SalesChannelInput,
  ctx: CatalogValidationContext,
): Result<SalesChannelInput, DomainError> {
  if (ctx.currentName !== undefined && isProtectedCatalogName("sales_channel", ctx.currentName)) {
    return fail("SystemCatalogReadOnly");
  }
  const name = validateCatalogName(input.name, { min: CATALOG_NAME_MIN, max: CATALOG_NAME_MAX });
  if (!name.ok) return name;
  if (isProtectedCatalogName("sales_channel", name.value)) return fail("SystemCatalogReadOnly");
  const aliases = validateAliases(input.aliases, {
    max: CATALOG_ALIASES_MAX,
    maxLength: CATALOG_NAME_MAX,
  });
  if (!aliases.ok) return aliases;

  const feeError = checkFeeRate(input.feePercentBp);
  if (feeError) return { ok: false, error: feeError };

  const conflictId = findNameCollision(
    { id: ctx.currentId, name: name.value, aliases: aliases.value },
    ctx.existing,
  );
  if (conflictId !== null) return fail("NameTaken", { conflictId });

  return ok({ ...input, name: name.value, aliases: aliases.value });
}
