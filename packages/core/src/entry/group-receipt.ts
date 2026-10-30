import { add } from "../money";
import { type CatalogSnapshot, normalizeName } from "./catalog";
import type { ReadyEntry } from "./interpret";

/**
 * Itens da nota agrupados por categoria (RF14.R4): um lançamento por categoria ("Atacadão – 8
 * itens"). Quem soma é o sistema, nunca a IA (regra 3). Itens de investimento têm lançamento
 * próprio; item sem categoria conhecida agrupa em "sem categoria" (vira "Outras despesas" na
 * gravação, com o sinal de revisão).
 */
export function groupReceiptEntries(
  ready: readonly ReadyEntry[],
  catalog: CatalogSnapshot,
): ReadyEntry[] {
  const isInvestment = (hint: string | null) =>
    hint !== null &&
    catalog.categories.some(
      (category) =>
        category.kind === "investment" && normalizeName(category.name) === normalizeName(hint),
    );

  const groups = new Map<string, ReadyEntry[]>();
  const order: (string | ReadyEntry)[] = [];
  for (const entry of ready) {
    const { extracted } = entry;
    if (isInvestment(extracted.category_hint)) {
      order.push(entry);
      continue;
    }
    const key = [
      extracted.type,
      entry.occurredOn,
      normalizeName(extracted.category_hint ?? ""),
      normalizeName(extracted.supplier_hint ?? ""),
    ].join("|");
    const group = groups.get(key);
    if (group) group.push(entry);
    else {
      groups.set(key, [entry]);
      order.push(key);
    }
  }

  return order.map((item) => {
    if (typeof item !== "string") return item;
    const group = groups.get(item) ?? [];
    const first = group[0] as ReadyEntry;
    if (group.length === 1) return first;
    let total = first.amountCents;
    for (const entry of group.slice(1)) {
      const sum = add(total, entry.amountCents);
      if (!sum.ok) return first; // estouro de valor: não agrupa em vez de gravar errado
      total = sum.value;
    }
    const label = first.extracted.supplier_hint?.trim() || first.description;
    return {
      ...first,
      amountCents: total,
      description: `${label} – ${group.length} itens`,
      extracted: {
        ...first.extracted,
        total_cents: total,
        quantity: null,
        quantity_unit: null,
        unit_price_cents: null,
      },
      flags: [...new Set(group.flatMap((entry) => entry.flags))],
    };
  });
}
