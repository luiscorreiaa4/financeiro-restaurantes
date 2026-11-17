import { describe, expect, it } from "vitest";
import type { DomainError } from "../errors/domain-errors";
import { entryErrorField } from "./error-field";

describe("entryErrorField", () => {
  const cases: [DomainError, string | undefined][] = [
    [{ code: "DateTooFarAhead", maxDate: "2027-01-15" }, "occurredOn"],
    [{ code: "InvalidBusinessDate", value: "x" }, "occurredOn"],
    [{ code: "InvalidBusinessDate", value: "x", field: "paidOn" }, "paidOn"],
    [{ code: "AmountNotPositive" }, "amountCents"],
    [{ code: "InvalidAmount", value: 1 }, "amountCents"],
    [{ code: "MoneyOverflow" }, "amountCents"],
    [{ code: "FeeExceedsAmount", feeCents: 2, amountCents: 1 }, "amountCents"],
    [{ code: "QuantityRequired" }, "quantity"],
    [{ code: "InvalidQuantity", value: 1.2345 }, "quantity"],
    [{ code: "DescriptionEmpty" }, "description"],
    [{ code: "CategoryTypeMismatch", categoryId: "c" }, "categoryId"],
    [{ code: "SalesChannelRequired" }, "salesChannelId"],
    [{ code: "InvalidOrders", value: 0 }, "orders"],
    [{ code: "UnitInactive", unitId: "u" }, "unitId"],
    [{ code: "UnknownReference", field: "category" }, "categoryId"],
    [{ code: "UnknownReference", field: "unit" }, "unitId"],
    [{ code: "UnknownReference", field: "supplier" }, "supplier"],
    [{ code: "UnknownReference", field: "payment_method" }, "paymentMethodId"],
    [{ code: "UnknownReference", field: "sales_channel" }, "salesChannelId"],
    [{ code: "EntryDeleted" }, undefined],
    [{ code: "NothingToChange" }, undefined],
  ];

  it.each(cases)("mapeia %j para %s", (error, field) => {
    expect(entryErrorField(error)).toBe(field);
  });
});
