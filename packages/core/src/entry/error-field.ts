import type { EntryFieldName } from "../contracts/entries";
import type { DomainError } from "../errors/domain-errors";

/** Campo do formulário a que um erro de domínio se refere; ausente quando não há um (F3c, D4). */
export function entryErrorField(error: DomainError): EntryFieldName | undefined {
  switch (error.code) {
    case "DateTooFarAhead":
      return "occurredOn";
    case "InvalidBusinessDate":
      return error.field ?? "occurredOn";
    case "AmountNotPositive":
    case "InvalidAmount":
    case "MoneyOverflow":
    case "FeeExceedsAmount":
      return "amountCents";
    case "QuantityRequired":
    case "InvalidQuantity":
      return "quantity";
    case "DescriptionEmpty":
      return "description";
    case "CategoryTypeMismatch":
      return "categoryId";
    case "SalesChannelRequired":
      return "salesChannelId";
    case "InvalidOrders":
      return "orders";
    case "UnitInactive":
      return "unitId";
    case "UnknownReference":
      return UNKNOWN_REFERENCE_FIELDS[error.field];
    default:
      return undefined;
  }
}

const UNKNOWN_REFERENCE_FIELDS = {
  category: "categoryId",
  supplier: "supplier",
  payment_method: "paymentMethodId",
  sales_channel: "salesChannelId",
  unit: "unitId",
} as const satisfies Record<
  Extract<DomainError, { code: "UnknownReference" }>["field"],
  EntryFieldName
>;
