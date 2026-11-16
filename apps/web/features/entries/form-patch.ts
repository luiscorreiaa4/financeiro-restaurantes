import type { EntryDetail, EntryOptions, EntryPatch } from "@app/core/contracts";
import type { SupplierChoice } from "./supplier-field";

/** Valores do formulário de edição: tudo texto, exceto o valor em centavos e o fornecedor. */
export type EntryFormValues = {
  type: EntryDetail["type"];
  occurredOn: string;
  paidOn: string;
  description: string;
  amountCents: number | null;
  categoryId: string;
  supplier: SupplierChoice;
  paymentMethodId: string;
  salesChannelId: string;
  orders: string;
  quantity: string;
  quantityUnit: string;
  unitId: string;
};

export type FormField = Exclude<keyof EntryFormValues, "supplier"> | "supplier";

export function quantityText(quantity: number | null): string {
  return quantity === null ? "" : String(quantity).replace(".", ",");
}

export function initialValues(entry: EntryDetail): EntryFormValues {
  return {
    type: entry.type,
    occurredOn: entry.occurredOn,
    paidOn: entry.paidOn,
    description: entry.description,
    amountCents: entry.amountCents,
    categoryId: entry.category?.id ?? "",
    supplier: entry.supplier
      ? { kind: "id", id: entry.supplier.id, name: entry.supplier.name }
      : { kind: "none" },
    paymentMethodId: entry.paymentMethod?.id ?? "",
    salesChannelId: entry.salesChannel?.id ?? "",
    orders: entry.orders === null ? "" : String(entry.orders),
    quantity: quantityText(entry.quantity),
    quantityUnit: entry.quantityUnit ?? "",
    unitId: entry.unit.id,
  };
}

/** Só os campos que mudaram em relação ao lançamento aberto (campo ausente = não muda). */
export function buildPatch(values: EntryFormValues, entry: EntryDetail): EntryPatch {
  const patch: { -readonly [K in keyof EntryPatch]?: EntryPatch[K] } = {};
  const revenue = values.type === "revenue";

  if (values.type !== entry.type) patch.type = values.type;
  if (values.occurredOn !== entry.occurredOn) patch.occurredOn = values.occurredOn;
  if (values.paidOn !== entry.paidOn) patch.paidOn = values.paidOn;
  if (values.description.trim() !== entry.description)
    patch.description = values.description.trim();
  if (values.amountCents !== null && values.amountCents !== entry.amountCents) {
    patch.amountCents = values.amountCents;
  }
  if (values.categoryId !== (entry.category?.id ?? "") && values.categoryId !== "") {
    patch.categoryId = values.categoryId;
  }
  if (values.unitId !== entry.unit.id) patch.unitId = values.unitId;

  const before = entry.supplier?.id ?? null;
  if (values.supplier.kind === "none") {
    if (before !== null) patch.supplier = null;
  } else if (values.supplier.kind === "id") {
    if (values.supplier.id !== before) patch.supplier = { id: values.supplier.id };
  } else {
    patch.supplier = { name: values.supplier.name };
  }

  if (values.paymentMethodId !== (entry.paymentMethod?.id ?? "")) {
    patch.paymentMethodId = values.paymentMethodId === "" ? null : values.paymentMethodId;
  }
  if (revenue && values.salesChannelId !== (entry.salesChannel?.id ?? "")) {
    patch.salesChannelId = values.salesChannelId === "" ? null : values.salesChannelId;
  }
  if (revenue && values.orders !== (entry.orders === null ? "" : String(entry.orders))) {
    patch.orders = values.orders.trim() === "" ? null : Number(values.orders);
  }
  if (values.quantity !== quantityText(entry.quantity)) {
    patch.quantity =
      values.quantity.trim() === "" ? null : Number(values.quantity.replace(",", "."));
  }
  if (values.quantityUnit !== (entry.quantityUnit ?? "")) {
    patch.quantityUnit = values.quantityUnit.trim() === "" ? null : values.quantityUnit.trim();
  }
  return patch as EntryPatch;
}

export const QUANTITY_REQUIRED_MESSAGE = "Informe a quantidade e a unidade de medida.";

/**
 * Erros que a tela já sabe apontar antes de enviar. O servidor repete tudo (RF12.R4, RF23.R1);
 * aqui é conforto. Quantidade só é cobrada quando o envio mexe em categoria, quantidade ou unidade
 * de medida, como na API.
 */
export function localErrors(
  values: EntryFormValues,
  patch: EntryPatch,
  options: EntryOptions,
): Partial<Record<FormField, string>> {
  const errors: Partial<Record<FormField, string>> = {};
  if (values.description.trim() === "") errors.description = "Informe a descrição.";
  if (values.amountCents === null) errors.amountCents = "Informe o valor.";
  if (values.occurredOn === "") errors.occurredOn = "Informe a data.";
  if (values.paidOn === "") errors.paidOn = "Informe a data de pagamento.";
  if (values.orders.trim() !== "" && !/^[1-9]\d*$/.test(values.orders.trim())) {
    errors.orders = "Informe um número inteiro maior que zero.";
  }
  if (values.quantity.trim() !== "" && !(Number(values.quantity.replace(",", ".")) > 0)) {
    errors.quantity = "Informe uma quantidade maior que zero.";
  }
  const touchesQuantity =
    patch.categoryId !== undefined ||
    patch.quantity !== undefined ||
    patch.quantityUnit !== undefined;
  const category = options.categories.find((item) => item.id === values.categoryId);
  if (
    touchesQuantity &&
    category?.requiresQuantity &&
    (values.quantity.trim() === "" || values.quantityUnit.trim() === "")
  ) {
    errors.quantity = QUANTITY_REQUIRED_MESSAGE;
  }
  return errors;
}
