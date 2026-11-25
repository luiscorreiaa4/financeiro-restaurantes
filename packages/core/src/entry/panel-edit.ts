import type { EntryPatch } from "../contracts/entries";
import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { isBusinessDate } from "./business-date";
import { type CatalogSnapshot, resolveFeeRule } from "./catalog";
import type { Entry, EntryFields } from "./entry";

/** Data de competência na edição pelo painel: até 60 dias depois de hoje (RF23.R1). */
export const PANEL_FUTURE_DAYS = 60;

/** Patch do painel já com o fornecedor resolvido: o nome novo é tratado pela API, não aqui. */
export type PanelPatch = Omit<EntryPatch, "supplier"> & {
  readonly supplier?: { readonly id: string } | null;
};

type PanelEditError = Extract<
  DomainError,
  { code: "DateTooFarAhead" | "QuantityRequired" | "UnknownReference" | "InvalidBusinessDate" }
>;

const dayNumber = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

const dateFromDayNumber = (days: number): string =>
  new Date(days * 86_400_000).toISOString().slice(0, 10);

/**
 * Valida o patch do painel contra o cadastro e devolve os campos a gravar (RF23.R1, Obs4).
 * As taxas copiadas só são recopiadas quando a forma de pagamento ou o canal muda de fato;
 * taxa em valor e líquido quem recalcula é `editEntry`. `today` é a data de hoje no fuso da
 * unidade, resolvida por quem chama.
 */
export function preparePanelEdit(input: {
  entry: Entry;
  patch: PanelPatch;
  catalog: CatalogSnapshot;
  today: string;
}): Result<Partial<EntryFields>, PanelEditError> {
  const { entry, patch, catalog, today } = input;

  if (patch.occurredOn !== undefined) {
    if (!isBusinessDate(patch.occurredOn)) {
      return fail("InvalidBusinessDate", { value: patch.occurredOn });
    }
    const maxDate = dateFromDayNumber(dayNumber(today) + PANEL_FUTURE_DAYS);
    if (dayNumber(patch.occurredOn) > dayNumber(maxDate))
      return fail("DateTooFarAhead", { maxDate });
  }

  const category =
    patch.categoryId === undefined
      ? undefined
      : catalog.categories.find((item) => item.id === patch.categoryId);
  if (patch.categoryId !== undefined && (!category || category.status === "inactive")) {
    return fail("UnknownReference", { field: "category" });
  }
  if (patch.unitId !== undefined) {
    const unit = catalog.units.find((item) => item.id === patch.unitId);
    if (unit?.status !== "active") return fail("UnknownReference", { field: "unit" });
  }
  // Fornecedor mesclado não recebe lançamento: o destino herdou o nome pelo apelido.
  if (
    patch.supplier &&
    !catalog.suppliers.some(
      (item) => item.id === patch.supplier?.id && (item.mergedIntoId ?? null) === null,
    )
  ) {
    return fail("UnknownReference", { field: "supplier" });
  }
  const paymentMethod = catalog.paymentMethods.find(
    (item) =>
      item.id ===
      (patch.paymentMethodId !== undefined ? patch.paymentMethodId : entry.paymentMethodId),
  );
  if (patch.paymentMethodId && paymentMethod?.status !== "active") {
    return fail("UnknownReference", { field: "payment_method" });
  }
  const channel = catalog.salesChannels.find(
    (item) =>
      item.id ===
      (patch.salesChannelId !== undefined ? patch.salesChannelId : entry.salesChannelId),
  );
  if (patch.salesChannelId && channel?.status !== "active") {
    return fail("UnknownReference", { field: "sales_channel" });
  }

  // Quantidade só é exigida quando o patch mexe em categoria, quantidade ou unidade de medida:
  // lançamento antigo sem quantidade continua editável nos outros campos.
  if (
    patch.categoryId !== undefined ||
    patch.quantity !== undefined ||
    patch.quantityUnit !== undefined
  ) {
    const effectiveCategory = catalog.categories.find(
      (item) => item.id === (patch.categoryId ?? entry.categoryId),
    );
    if (effectiveCategory?.requiresQuantity) {
      const quantity = patch.quantity !== undefined ? patch.quantity : entry.quantity;
      const unit = patch.quantityUnit !== undefined ? patch.quantityUnit : entry.quantityUnit;
      if (quantity === null || unit === null) return fail("QuantityRequired");
    }
  }

  const fields: { -readonly [K in keyof EntryFields]?: EntryFields[K] } = {};
  if (patch.type !== undefined) fields.type = patch.type;
  if (patch.occurredOn !== undefined) fields.occurredOn = patch.occurredOn;
  if (patch.paidOn !== undefined) fields.paidOn = patch.paidOn;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.quantity !== undefined) fields.quantity = patch.quantity;
  if (patch.quantityUnit !== undefined) fields.quantityUnit = patch.quantityUnit;
  if (patch.orders !== undefined) fields.orders = patch.orders;
  if (patch.amountCents !== undefined)
    fields.amountCents = patch.amountCents as Entry["amountCents"];
  if (patch.categoryId !== undefined) fields.categoryId = patch.categoryId;
  if (patch.supplier !== undefined)
    fields.supplierId = patch.supplier === null ? null : patch.supplier.id;
  if (patch.paymentMethodId !== undefined) fields.paymentMethodId = patch.paymentMethodId;
  if (patch.salesChannelId !== undefined) fields.salesChannelId = patch.salesChannelId;
  if (patch.unitId !== undefined) fields.unitId = patch.unitId;

  const methodChanged =
    patch.paymentMethodId !== undefined && patch.paymentMethodId !== entry.paymentMethodId;
  const channelChanged =
    patch.salesChannelId !== undefined && patch.salesChannelId !== entry.salesChannelId;
  const typeChanged = patch.type !== undefined && patch.type !== entry.type;
  if (typeChanged && patch.type === "expense") {
    // Despesa nunca tem taxa: ao virar despesa, as taxas copiadas da receita saem.
    fields.feePercentBp = 0;
    fields.feeFixedCents = 0;
  } else if (
    (methodChanged || channelChanged || typeChanged) &&
    (patch.type ?? entry.type) === "revenue"
  ) {
    const fee = resolveFeeRule({
      paymentMethod: paymentMethod ?? null,
      salesChannel: channel ?? null,
    });
    fields.feePercentBp = fee.feePercentBp;
    fields.feeFixedCents = fee.feeFixedCents;
  }
  return ok(fields);
}
