import { describe, expect, it } from "vitest";
import { ENTRY_EXPORT_COLUMNS, type ExportEntryRow, FULL_EXPORT_EXTRA_COLUMNS } from "./columns";
import { toCsv } from "./csv";

const row: ExportEntryRow = {
  occurredOn: "2026-10-05",
  paidOn: "2026-10-07",
  type: "expense",
  description: "Arroz 5kg",
  quantity: 2,
  quantityUnit: "kg",
  orders: null,
  amountCents: 10000,
  feeCents: 250,
  netCents: 9750,
  category: "Arroz",
  categoryParentName: "Insumos",
  dreGroup: "cmv",
  nature: "variable",
  supplier: "Atacadão",
  supplierDocument: "12345678000190",
  paymentMethod: "Pix",
  salesChannel: null,
  unit: "Centro",
  createdBy: "Maria",
  originChannel: "whatsapp",
  flags: ["category_to_review", "old_date"],
  createdAt: "2026-10-01T02:30:00Z",
  deletedAt: null,
};

function cells(columns: typeof ENTRY_EXPORT_COLUMNS, r: ExportEntryRow) {
  return Object.fromEntries(columns.map((c) => [c.label, c.value(r)]));
}

describe("ENTRY_EXPORT_COLUMNS", () => {
  it("segue a ordem e os rótulos do RF29.R3", () => {
    expect(ENTRY_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Data de competência",
      "Data de pagamento",
      "Tipo",
      "Descrição",
      "Quantidade",
      "Unidade de medida",
      "Valor bruto",
      "Taxa",
      "Líquido",
      "Pedidos",
      "Categoria",
      "Subcategoria",
      "Grupo do DRE",
      "Natureza",
      "Fornecedor",
      "Documento do fornecedor",
      "Forma de pagamento",
      "Canal",
      "Unidade",
      "Lançado por",
      "Canal de origem",
      "Sinais de revisão",
      "Criado em",
    ]);
  });

  it("as chaves são únicas", () => {
    const keys = ENTRY_EXPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("categoria com pai: Categoria é o pai e Subcategoria é a própria", () => {
    const c = cells(ENTRY_EXPORT_COLUMNS, row);
    expect(c.Categoria).toBe("Insumos");
    expect(c.Subcategoria).toBe("Arroz");
  });

  it("categoria sem pai: Subcategoria vazia", () => {
    const c = cells(ENTRY_EXPORT_COLUMNS, {
      ...row,
      category: "Insumos",
      categoryParentName: null,
    });
    expect(c.Categoria).toBe("Insumos");
    expect(c.Subcategoria).toBe("");
  });

  it("sem categoria: as duas vazias", () => {
    const c = cells(ENTRY_EXPORT_COLUMNS, { ...row, category: null, categoryParentName: null });
    expect(c.Categoria).toBe("");
    expect(c.Subcategoria).toBe("");
  });

  it("rotula tipo, natureza, grupo do DRE, canal de origem e sinais", () => {
    const c = cells(ENTRY_EXPORT_COLUMNS, row);
    expect(c.Tipo).toBe("Despesa");
    expect(c.Natureza).toBe("Variável");
    expect(c["Grupo do DRE"]).toBe("CMV");
    expect(c["Canal de origem"]).toBe("WhatsApp");
    expect(c["Sinais de revisão"]).toBe("Categoria a revisar, Data antiga");
    expect(cells(ENTRY_EXPORT_COLUMNS, { ...row, nature: "fixed" }).Natureza).toBe("Fixa");
  });

  it("natureza e grupo ausentes ficam vazios", () => {
    const c = cells(ENTRY_EXPORT_COLUMNS, { ...row, nature: null, dreGroup: null });
    expect(c.Natureza).toBe("");
    expect(c["Grupo do DRE"]).toBe("");
  });

  it("dinheiro sai em centavos e com o tipo money", () => {
    const money = ENTRY_EXPORT_COLUMNS.filter((c) => c.type === "money").map((c) => c.label);
    expect(money).toEqual(["Valor bruto", "Taxa", "Líquido"]);
    expect(cells(ENTRY_EXPORT_COLUMNS, row)["Valor bruto"]).toBe(10000);
  });

  it("gera a linha do CSV", () => {
    const csv = toCsv(ENTRY_EXPORT_COLUMNS, [row]);
    expect(csv.split("\r\n")[1]).toBe(
      "05/10/2026;07/10/2026;Despesa;Arroz 5kg;2;kg;100,00;2,50;97,50;;Insumos;Arroz;CMV;Variável;Atacadão;12345678000190;Pix;;Centro;Maria;WhatsApp;Categoria a revisar, Data antiga;30/09/2026 23:30",
    );
  });
});

describe("FULL_EXPORT_EXTRA_COLUMNS", () => {
  it("traz Situação e Excluído em", () => {
    expect(FULL_EXPORT_EXTRA_COLUMNS.map((c) => c.label)).toEqual(["Situação", "Excluído em"]);
  });

  it("lançamento ativo e excluído", () => {
    expect(cells(FULL_EXPORT_EXTRA_COLUMNS, row)).toEqual({
      Situação: "Ativo",
      "Excluído em": null,
    });
    expect(cells(FULL_EXPORT_EXTRA_COLUMNS, { ...row, deletedAt: "2026-10-02T12:00:00Z" })).toEqual(
      { Situação: "Excluído", "Excluído em": "2026-10-02T12:00:00Z" },
    );
  });
});
