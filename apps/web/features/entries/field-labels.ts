import type { EntryChangeField, EntryItem, EntryVersion } from "@app/core/contracts";

type EntryFlag = EntryItem["flags"][number];

/** Sinais de revisão (RF22.R4). */
export const FLAG_LABELS: Record<EntryFlag, string> = {
  category_to_review: "Categoria a revisar",
  channel_to_review: "Canal a revisar",
  possible_duplicate: "Possível duplicidade",
  old_date: "Data antiga",
};

export const TYPE_LABELS: Record<EntryItem["type"], string> = {
  expense: "Despesa",
  revenue: "Receita",
};

/** Canal de origem do lançamento e de cada versão (RF25.R4). */
export const CHANNEL_LABELS: Record<EntryItem["originChannel"], string> = {
  whatsapp: "WhatsApp",
  web: "Painel",
  import: "Importação",
  email: "E-mail",
  system: "Sistema",
};

/** Ação de cada versão do histórico (RF25.R4). */
export const ACTION_LABELS: Record<EntryVersion["action"], string> = {
  create: "Criação",
  update: "Alteração",
  delete: "Exclusão",
  restore: "Restauração",
};

/** Nome de cada campo no "antes e depois" do histórico. */
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

const quantityFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** Quantidade com a unidade de medida ("12,5 kg"); sem quantidade, texto vazio. */
export function formatQuantity(quantity: number | null, unit: string | null): string {
  if (quantity === null) return "";
  const text = quantityFormat.format(quantity);
  return unit ? `${text} ${unit}` : text;
}

const instantFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Instante ISO 8601 (não é data de negócio) como `dd/MM/yyyy HH:mm` em America/Sao_Paulo. */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return instantFormat.format(date).replace(",", "");
}
