/** Tipos dos cadastros de apoio (RF08, RF09). Os valores do documento em inglês, no código. */
export const PAYMENT_METHOD_TYPES = [
  "cash",
  "pix",
  "debit",
  "credit",
  "voucher",
  "boleto",
  "transfer",
  "other",
] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/** SALAO, DELIVERY_PROPRIO, APLICATIVO, RETIRADA e OUTRO. */
export const SALES_CHANNEL_TYPES = ["dine_in", "own_delivery", "app", "pickup", "other"] as const;
export type SalesChannelType = (typeof SALES_CHANNEL_TYPES)[number];

export const CATALOG_STATUSES = ["active", "inactive"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** Limites de apelidos (RF08, RF09): até 10 por forma de pagamento e por canal. */
export const CATALOG_ALIASES_MAX = 10;

/** Registro que a IA usa quando a mensagem não diz a forma ou o canal (RF08, RF09). */
export const NOT_INFORMED_PAYMENT_METHOD = "Não informada";
export const NOT_INFORMED_SALES_CHANNEL = "Não informado";
