const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Rótulo de eixo, só para leitura rápida ("10 mil"). O valor exato fica no tooltip e na tabela. */
export function compactAxis(cents: number): string {
  return compact.format(cents / 100);
}
