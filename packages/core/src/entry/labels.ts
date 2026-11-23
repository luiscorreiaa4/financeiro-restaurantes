import type { EntryChangeField } from "../contracts/entries";
import type { Channel, EntryType } from "./entry";
import type { EntryFlag } from "./interpret";

// Rótulos em português que o painel e a exportação compartilham (RF22.R4, RF25.R4, RF29.R3).

/** Sinais de revisão (RF22.R4). */
export const FLAG_LABELS: Record<EntryFlag, string> = {
  category_to_review: "Categoria a revisar",
  channel_to_review: "Canal a revisar",
  possible_duplicate: "Possível duplicidade",
  old_date: "Data antiga",
};

export const TYPE_LABELS: Record<EntryType, string> = {
  expense: "Despesa",
  revenue: "Receita",
};

/** Canal de origem do lançamento e de cada versão (RF25.R4). */
export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  web: "Painel",
  import: "Importação",
  email: "E-mail",
  system: "Sistema",
};

/** Nome de cada campo no "antes e depois" do histórico (RF25.R4). */
export const FIELD_LABELS: Record<EntryChangeField, string> = {
  type: "Tipo",
  occurredOn: "Data",
  paidOn: "Data de pagamento",
  description: "Descrição",
  quantity: "Quantidade",
  quantityUnit: "Unidade de medida",
  orders: "Pedidos",
  amountCents: "Valor bruto",
  feePercentBp: "Taxa (%)",
  feeFixedCents: "Taxa fixa",
  feeCents: "Taxa",
  netCents: "Valor líquido",
  category: "Categoria",
  supplier: "Fornecedor",
  paymentMethod: "Forma de pagamento",
  salesChannel: "Canal de venda",
  unit: "Unidade",
  flags: "Sinais de revisão",
  deleteReason: "Motivo da exclusão",
};
