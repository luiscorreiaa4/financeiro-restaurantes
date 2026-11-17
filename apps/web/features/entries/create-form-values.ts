import { toQuantityUnit } from "@app/core";
import type { EntryCreateBody, EntryOptions } from "@app/core/contracts";
import { type EntryFormValues, type FormField, QUANTITY_REQUIRED_MESSAGE } from "./form-patch";

type Category = EntryOptions["categories"][number];

/** Valores do formulário de lançamento manual (RF26): os mesmos campos da edição. */
export type CreateFormValues = EntryFormValues;

/** Chave de tentativa: o mesmo envio repetido grava uma vez só (RF26.R3). UUID v4. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Despesa aceita despesa, investimento e dedução; receita só receita (RF26.R1). */
export function categoriesFor(options: EntryOptions, type: CreateFormValues["type"]): Category[] {
  return options.categories.filter(
    (category) =>
      category.active !== false &&
      (type === "revenue" ? category.kind === "revenue" : category.kind !== "revenue"),
  );
}

export function activeUnits(options: EntryOptions) {
  return options.units.filter((unit) => unit.active !== false);
}

/** Canal padrão da unidade (RF12.R9), ou vazio quando não há ou está inativo. */
export function defaultChannelFor(options: EntryOptions, unitId: string): string {
  const channelId = options.units.find((unit) => unit.id === unitId)?.defaultSalesChannelId;
  if (!channelId) return "";
  const channel = options.salesChannels.find((item) => item.id === channelId);
  return channel && channel.active !== false ? channel.id : "";
}

/** Unidade do seletor se for oferecida; com "todas", a única ativa, se só houver uma. */
function startingUnit(options: EntryOptions, unitId: string): string {
  const active = activeUnits(options);
  if (active.some((unit) => unit.id === unitId)) return unitId;
  const [only] = active;
  return active.length === 1 && only ? only.id : "";
}

export function initialCreateValues(
  options: EntryOptions,
  context: { unitId: string; today: string },
): CreateFormValues {
  return {
    type: "expense",
    occurredOn: context.today,
    paidOn: context.today,
    description: "",
    amountCents: null,
    categoryId: "",
    supplier: { kind: "none" },
    paymentMethodId: "",
    salesChannelId: "",
    orders: "",
    quantity: "",
    quantityUnit: "",
    unitId: startingUnit(options, context.unitId),
  };
}

/** Corpo do `POST /api/entries`: só o que o tipo permite; a tela não calcula taxa nem líquido. */
export function buildCreateBody(
  values: CreateFormValues,
  clientRequestId: string,
): EntryCreateBody {
  const revenue = values.type === "revenue";
  const quantityText = values.quantity.trim();
  return {
    clientRequestId,
    type: values.type,
    occurredOn: values.occurredOn,
    paidOn: values.paidOn,
    description: values.description.trim(),
    amountCents: values.amountCents ?? 0,
    categoryId: values.categoryId,
    unitId: values.unitId,
    supplier:
      values.supplier.kind === "id"
        ? { id: values.supplier.id }
        : values.supplier.kind === "new"
          ? { name: values.supplier.name }
          : null,
    paymentMethodId: values.paymentMethodId === "" ? null : values.paymentMethodId,
    salesChannelId: revenue && values.salesChannelId !== "" ? values.salesChannelId : null,
    orders: revenue && values.orders.trim() !== "" ? Number(values.orders.trim()) : null,
    quantity: quantityText === "" ? null : Number(quantityText.replace(",", ".")),
    quantityUnit: toQuantityUnit(values.quantityUnit),
  };
}

/** Erros que a tela já sabe apontar antes de enviar; o servidor repete tudo (RF26.R1, CA01). */
export function createLocalErrors(
  values: CreateFormValues,
  options: EntryOptions,
): Partial<Record<FormField, string>> {
  const errors: Partial<Record<FormField, string>> = {};
  if (values.amountCents === null) errors.amountCents = "Informe o valor.";
  if (values.description.trim() === "") errors.description = "Informe a descrição.";
  if (values.occurredOn === "") errors.occurredOn = "Informe a data.";
  if (values.paidOn === "") errors.paidOn = "Informe a data de pagamento.";
  if (values.categoryId === "") errors.categoryId = "Escolha a categoria.";
  if (values.unitId === "") errors.unitId = "Escolha a unidade.";
  if (values.type === "revenue") {
    if (values.salesChannelId === "") errors.salesChannelId = "Escolha o canal de venda.";
    if (values.orders.trim() !== "" && !/^[1-9]\d*$/.test(values.orders.trim())) {
      errors.orders = "Informe um número inteiro maior que zero.";
    }
  }
  const quantity = values.quantity.trim();
  if (quantity !== "" && !(Number(quantity.replace(",", ".")) > 0)) {
    errors.quantity = "Informe uma quantidade maior que zero.";
  }
  const category = options.categories.find((item) => item.id === values.categoryId);
  const hasQuantity = quantity !== "";
  const hasUnit = values.quantityUnit.trim() !== "";
  if ((category?.requiresQuantity && !(hasQuantity && hasUnit)) || hasQuantity !== hasUnit) {
    errors.quantity ??= QUANTITY_REQUIRED_MESSAGE;
  }
  return errors;
}

/** "Salvar e lançar outro" (RF26.Obs2): mantém tipo, competência e unidade; limpa o resto. */
export function keepForNext(values: CreateFormValues, options: EntryOptions): CreateFormValues {
  const next = initialCreateValues(options, { unitId: values.unitId, today: values.occurredOn });
  return {
    ...next,
    type: values.type,
    unitId: values.unitId,
    salesChannelId:
      values.type === "revenue"
        ? defaultChannelFor(options, values.unitId) || values.salesChannelId
        : "",
  };
}
