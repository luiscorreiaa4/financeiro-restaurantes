import { describe, expect, it } from "vitest";
import { money } from "../money";
import type { CatalogSnapshot } from "./catalog";
import type { ExtractedEntry } from "./extraction";
import { groupReceiptEntries } from "./group-receipt";
import type { ReadyEntry } from "./interpret";

const m = (cents: number) => {
  const result = money(cents);
  if (!result.ok) throw new Error("centavos inválidos");
  return result.value;
};

const CATALOG: CatalogSnapshot = {
  categories: [
    { id: "c1", name: "Carnes e peixes", kind: "expense" },
    { id: "c2", name: "Bebidas", kind: "expense" },
    { id: "c3", name: "Equipamentos", kind: "investment" },
  ],
  suppliers: [],
  paymentMethods: [],
  salesChannels: [],
  units: [],
};

const item = (
  description: string,
  cents: number,
  category: string | null,
  overrides: Partial<ExtractedEntry> = {},
): ReadyEntry => ({
  extracted: {
    type: "expense",
    description,
    occurred_on: null,
    quantity: 2,
    quantity_unit: "kg",
    unit_price_cents: null,
    total_cents: cents,
    category_hint: category,
    supplier_hint: "Atacadão",
    payment_method_hint: null,
    sales_channel_hint: null,
    missing_fields: [],
    ...overrides,
  },
  amountCents: m(cents),
  occurredOn: "2026-10-30",
  description,
  flags: [],
});

describe("itens da nota agrupados por categoria (RF14.R4)", () => {
  it("cupom de 30 itens em 3 categorias vira 3 lançamentos (CA03)", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item(`Carne ${i}`, 1000, "Carnes e peixes")),
      ...Array.from({ length: 12 }, (_, i) => item(`Bebida ${i}`, 500, "Bebidas")),
      ...Array.from({ length: 8 }, (_, i) => item(`Sem categoria ${i}`, 250, null)),
    ];
    const grouped = groupReceiptEntries(items, CATALOG);
    expect(grouped).toHaveLength(3);
    expect(grouped.map((entry) => entry.amountCents)).toEqual([10000, 6000, 2000]);
    expect(grouped[0]?.description).toBe("Atacadão – 10 itens");
  });

  it("a soma é do sistema e o total agrupado vale a soma dos itens", () => {
    const grouped = groupReceiptEntries(
      [item("A", 333, "Bebidas"), item("B", 667, "Bebidas")],
      CATALOG,
    );
    expect(grouped[0]?.amountCents).toBe(1000);
    expect(grouped[0]?.extracted.total_cents).toBe(1000);
    expect(grouped[0]?.extracted.quantity).toBeNull();
  });

  it("mantém um item sozinho como veio, com a descrição dele", () => {
    const grouped = groupReceiptEntries([item("Picanha", 8000, "Carnes e peixes")], CATALOG);
    expect(grouped[0]?.description).toBe("Picanha");
    expect(grouped[0]?.extracted.quantity).toBe(2);
  });

  it("item de investimento tem lançamento próprio, mesmo havendo mais de um", () => {
    const grouped = groupReceiptEntries(
      [
        item("Batedeira", 90000, "Equipamentos"),
        item("Liquidificador", 30000, "Equipamentos"),
        item("Carne", 1000, "Carnes e peixes"),
      ],
      CATALOG,
    );
    expect(grouped.map((entry) => entry.description)).toEqual([
      "Batedeira",
      "Liquidificador",
      "Carne",
    ]);
  });

  it("não mistura fornecedores, tipos nem datas diferentes", () => {
    const other = item("Carne", 1000, "Carnes e peixes", { supplier_hint: "Ceasa" });
    const grouped = groupReceiptEntries(
      [
        item("Carne", 1000, "Carnes e peixes"),
        other,
        { ...item("Carne", 1000, "Carnes e peixes"), occurredOn: "2026-10-29" },
      ],
      CATALOG,
    );
    expect(grouped).toHaveLength(3);
  });

  it("agrupa sem diferenciar caixa nem acento da categoria", () => {
    const grouped = groupReceiptEntries(
      [item("A", 100, "bebidas"), item("B", 100, "BEBIDAS")],
      CATALOG,
    );
    expect(grouped).toHaveLength(1);
  });

  it("preserva os sinais dos itens agrupados e a ordem do cupom", () => {
    const old = { ...item("A", 100, "Bebidas"), flags: ["old_date" as const] };
    const grouped = groupReceiptEntries(
      [item("Carne", 100, "Carnes e peixes"), old, item("B", 100, "Bebidas")],
      CATALOG,
    );
    expect(grouped.map((entry) => entry.extracted.category_hint)).toEqual([
      "Carnes e peixes",
      "Bebidas",
    ]);
    expect(grouped[1]?.flags).toEqual(["old_date"]);
  });
});
