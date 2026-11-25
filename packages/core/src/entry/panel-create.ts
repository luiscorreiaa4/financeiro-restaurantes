import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { NO_FEE } from "../money";
import { isBusinessDate } from "./business-date";
import { type CatalogCategory, type CatalogSnapshot, resolveFeeRule } from "./catalog";
import { isPossibleDuplicate, type RecentEntry } from "./duplicate";
import type { EntryDraft, EntryType } from "./entry";
import { daysBefore, type EntryFlag, OLD_DATE_DAYS, sanitizeDescription } from "./interpret";
import { PANEL_FUTURE_DAYS } from "./panel-edit";
import type { QuantityUnit } from "./quantity-units";

/** Dados do formulário de lançamento manual, já com o fornecedor resolvido pela API (RF26.R1). */
export interface PanelCreateInput {
  readonly type: EntryType;
  readonly occurredOn: string;
  /** Omitida = igual à competência (RF26.R2). */
  readonly paidOn?: string;
  readonly description: string;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly unitId: string;
  readonly supplier: { readonly id: string } | null;
  readonly paymentMethodId: string | null;
  readonly salesChannelId: string | null;
  readonly orders: number | null;
  readonly quantity: number | null;
  readonly quantityUnit: QuantityUnit | null;
}

export type PanelCreateError = Extract<
  DomainError,
  {
    code:
      | "InvalidBusinessDate"
      | "DateTooFarAhead"
      | "DescriptionEmpty"
      | "CategoryTypeMismatch"
      | "SalesChannelRequired"
      | "QuantityRequired"
      | "UnitInactive"
      | "UnknownReference";
  }
>;

const dayNumber = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

const kindsFor = (type: EntryType): readonly CatalogCategory["kind"][] =>
  type === "revenue" ? ["revenue"] : ["expense", "investment", "deduction"];

/**
 * Valida o lançamento manual contra o cadastro e monta o rascunho (RF26.R1, R2, R4, R5).
 * `today` é a data de hoje no fuso da unidade escolhida, resolvida por quem chama. Valor,
 * pedidos e taxa em centavos são conferidos por `createEntry`, que grava o rascunho.
 */
export function preparePanelCreate(args: {
  input: PanelCreateInput;
  catalog: CatalogSnapshot;
  today: string;
  recent: readonly RecentEntry[];
}): Result<EntryDraft, PanelCreateError> {
  const { input, catalog, today, recent } = args;

  if (!isBusinessDate(input.occurredOn)) {
    return fail("InvalidBusinessDate", { value: input.occurredOn, field: "occurredOn" });
  }
  if (input.paidOn !== undefined && !isBusinessDate(input.paidOn)) {
    return fail("InvalidBusinessDate", { value: input.paidOn, field: "paidOn" });
  }
  const maxDate = new Date((dayNumber(today) + PANEL_FUTURE_DAYS) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (dayNumber(input.occurredOn) > dayNumber(maxDate)) return fail("DateTooFarAhead", { maxDate });

  const unit = catalog.units.find((item) => item.id === input.unitId);
  if (!unit) return fail("UnknownReference", { field: "unit" });
  if (unit.status !== "active") return fail("UnitInactive", { unitId: unit.id });

  const category = catalog.categories.find((item) => item.id === input.categoryId);
  if (!category || category.status === "inactive") {
    return fail("UnknownReference", { field: "category" });
  }
  if (!kindsFor(input.type).includes(category.kind)) {
    return fail("CategoryTypeMismatch", { categoryId: category.id });
  }

  const description = sanitizeDescription(input.description);
  if (description === "") return fail("DescriptionEmpty");

  // Fornecedor mesclado não recebe lançamento novo: o destino herdou o nome pelo apelido.
  if (
    input.supplier &&
    !catalog.suppliers.some(
      (item) => item.id === input.supplier?.id && (item.mergedIntoId ?? null) === null,
    )
  ) {
    return fail("UnknownReference", { field: "supplier" });
  }
  const paymentMethod =
    input.paymentMethodId === null
      ? null
      : catalog.paymentMethods.find((item) => item.id === input.paymentMethodId);
  if (input.paymentMethodId !== null && paymentMethod?.status !== "active") {
    return fail("UnknownReference", { field: "payment_method" });
  }

  const isRevenue = input.type === "revenue";
  if (isRevenue && input.salesChannelId === null) return fail("SalesChannelRequired");
  const channel =
    isRevenue && input.salesChannelId !== null
      ? catalog.salesChannels.find((item) => item.id === input.salesChannelId)
      : undefined;
  if (isRevenue && channel?.status !== "active") {
    return fail("UnknownReference", { field: "sales_channel" });
  }

  // Quantidade e unidade de medida andam juntas; a categoria que exige quantidade pede as duas.
  const hasQuantity = input.quantity !== null;
  const hasUnit = input.quantityUnit !== null;
  if (hasQuantity !== hasUnit || (category.requiresQuantity && !hasQuantity)) {
    return fail("QuantityRequired");
  }

  const fee = isRevenue
    ? resolveFeeRule({ paymentMethod: paymentMethod ?? null, salesChannel: channel ?? null })
    : NO_FEE;

  const flags: EntryFlag[] = [];
  if (daysBefore(input.occurredOn, today) > OLD_DATE_DAYS) flags.push("old_date");
  const supplierId = input.supplier?.id ?? null;
  if (
    isPossibleDuplicate(
      {
        inboundMessageId: null,
        amountCents: input.amountCents,
        supplierId,
        description,
        occurredOn: input.occurredOn,
      },
      recent,
    )
  ) {
    flags.push("possible_duplicate");
  }

  return ok({
    unitId: input.unitId,
    type: input.type,
    occurredOn: input.occurredOn,
    paidOn: input.paidOn ?? input.occurredOn,
    orders: input.orders,
    description,
    quantity: input.quantity,
    quantityUnit: input.quantityUnit,
    amountCents: input.amountCents as EntryDraft["amountCents"],
    feePercentBp: fee.feePercentBp,
    feeFixedCents: fee.feeFixedCents,
    categoryId: category.id,
    supplierId,
    paymentMethodId: paymentMethod?.id ?? null,
    salesChannelId: channel?.id ?? null,
    inboundMessageId: null,
    flags,
  });
}
