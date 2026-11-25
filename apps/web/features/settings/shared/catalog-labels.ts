import type { CatalogStatus, PaymentMethodType, SalesChannelType } from "@app/core";

export const PAYMENT_TYPE_LABELS: Record<PaymentMethodType, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
  voucher: "Voucher",
  boleto: "Boleto",
  transfer: "Transferência",
  other: "Outra",
};

export const CHANNEL_TYPE_LABELS: Record<SalesChannelType, string> = {
  dine_in: "Salão",
  own_delivery: "Delivery próprio",
  app: "Aplicativo",
  pickup: "Retirada",
  other: "Outro",
};

export const STATUS_LABELS: Record<CatalogStatus, string> = {
  active: "Ativa",
  inactive: "Inativa",
};

export const CATEGORY_KIND_LABELS = {
  revenue: "Receita",
  expense: "Despesa",
  investment: "Investimento",
  deduction: "Dedução",
} as const;

export const CATEGORY_NATURE_LABELS = { fixed: "Fixa", variable: "Variável" } as const;
