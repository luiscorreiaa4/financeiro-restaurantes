/** Unidades de medida aceitas pelo painel (RF12.R4); as mesmas que o canal grava em `quantity_unit`. */
export const QUANTITY_UNITS = [
  "KG",
  "G",
  "L",
  "ML",
  "UN",
  "DZ",
  "CX",
  "PCT",
  "FD",
  "SC",
  "OUTRA",
] as const;

export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

/** Ponte para valores antigos: ignora caixa e espaços; o que não é da lista vira nulo. */
export function toQuantityUnit(raw: string): QuantityUnit | null {
  const upper = raw.trim().toUpperCase();
  return QUANTITY_UNITS.find((unit) => unit === upper) ?? null;
}
