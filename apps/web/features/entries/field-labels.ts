import type { EntryVersion } from "@app/core/contracts";

// Sinais, tipo e canal de origem moram no core (compartilhados com a exportação, RF29.R3).
export { CHANNEL_LABELS, FIELD_LABELS, FLAG_LABELS, TYPE_LABELS } from "@app/core";

/** Ação de cada versão do histórico (RF25.R4). */
export const ACTION_LABELS: Record<EntryVersion["action"], string> = {
  create: "Criação",
  update: "Alteração",
  delete: "Exclusão",
  restore: "Restauração",
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

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Hora (`HH:mm`) de um instante ISO 8601 em America/Sao_Paulo; instante inválido vira "—". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : timeFormat.format(date);
}
