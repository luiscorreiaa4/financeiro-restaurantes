import type { Channel, EntryType } from "../entry/entry";
import type { EntryFlag } from "../entry/interpret";
import { CHANNEL_LABELS, FLAG_LABELS, TYPE_LABELS } from "../entry/labels";
import { dreGroupLabel } from "../reports/indicators";

// Colunas das exportações (RF29.R3). Cada coluna sabe o seu tipo: o CSV formata o texto e o
// XLSX escolhe o formato da célula. O valor devolvido é o bruto (centavos, `AAAA-MM-DD`, ISO).

export type ExportCellType = "text" | "date" | "datetime" | "money" | "int" | "decimal";

export interface ExportColumn<R> {
  readonly key: string;
  readonly label: string;
  readonly type: ExportCellType;
  readonly value: (row: R) => string | number | null;
}

/**
 * Uma linha da exportação de lançamentos, já com os nomes dos cadastros no lugar dos ids
 * (montada pelo leitor do banco). `category` é a categoria do lançamento; se ela tem pai,
 * `categoryParentName` traz o nome do pai (a coluna "Categoria" sai com o pai e "Subcategoria"
 * com `category`). `dreGroup` é a chave do grupo (`cmv`, `pessoal`...) e `nature` a natureza
 * da categoria. `deletedAt` só vem preenchido no COMPLETO (RF29.Obs1).
 */
export interface ExportEntryRow {
  readonly occurredOn: string;
  readonly paidOn: string;
  readonly type: EntryType;
  readonly description: string;
  readonly quantity: number | null;
  readonly quantityUnit: string | null;
  readonly orders: number | null;
  readonly amountCents: number;
  readonly feeCents: number;
  readonly netCents: number;
  readonly category: string | null;
  readonly categoryParentName: string | null;
  readonly dreGroup: string | null;
  readonly nature: "fixed" | "variable" | null;
  readonly supplier: string | null;
  readonly supplierDocument: string | null;
  readonly paymentMethod: string | null;
  readonly salesChannel: string | null;
  readonly unit: string;
  readonly createdBy: string;
  readonly originChannel: Channel;
  readonly flags: readonly EntryFlag[];
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

type Column = ExportColumn<ExportEntryRow>;

const NATURE_LABELS = { fixed: "Fixa", variable: "Variável" } as const;

export const ENTRY_EXPORT_COLUMNS: readonly Column[] = [
  { key: "occurredOn", label: "Data de competência", type: "date", value: (r) => r.occurredOn },
  { key: "paidOn", label: "Data de pagamento", type: "date", value: (r) => r.paidOn },
  { key: "type", label: "Tipo", type: "text", value: (r) => TYPE_LABELS[r.type] },
  { key: "description", label: "Descrição", type: "text", value: (r) => r.description },
  { key: "quantity", label: "Quantidade", type: "decimal", value: (r) => r.quantity },
  { key: "quantityUnit", label: "Unidade de medida", type: "text", value: (r) => r.quantityUnit },
  { key: "amountCents", label: "Valor bruto", type: "money", value: (r) => r.amountCents },
  { key: "feeCents", label: "Taxa", type: "money", value: (r) => r.feeCents },
  { key: "netCents", label: "Líquido", type: "money", value: (r) => r.netCents },
  { key: "orders", label: "Pedidos", type: "int", value: (r) => r.orders },
  {
    key: "category",
    label: "Categoria",
    type: "text",
    value: (r) => r.categoryParentName ?? r.category ?? "",
  },
  {
    key: "subcategory",
    label: "Subcategoria",
    type: "text",
    value: (r) => (r.categoryParentName === null ? "" : (r.category ?? "")),
  },
  {
    key: "dreGroup",
    label: "Grupo do DRE",
    type: "text",
    value: (r) => (r.dreGroup === null ? "" : dreGroupLabel(r.dreGroup)),
  },
  {
    key: "nature",
    label: "Natureza",
    type: "text",
    value: (r) => (r.nature === null ? "" : NATURE_LABELS[r.nature]),
  },
  { key: "supplier", label: "Fornecedor", type: "text", value: (r) => r.supplier },
  {
    key: "supplierDocument",
    label: "Documento do fornecedor",
    type: "text",
    value: (r) => r.supplierDocument,
  },
  {
    key: "paymentMethod",
    label: "Forma de pagamento",
    type: "text",
    value: (r) => r.paymentMethod,
  },
  { key: "salesChannel", label: "Canal", type: "text", value: (r) => r.salesChannel },
  { key: "unit", label: "Unidade", type: "text", value: (r) => r.unit },
  { key: "createdBy", label: "Lançado por", type: "text", value: (r) => r.createdBy },
  {
    key: "originChannel",
    label: "Canal de origem",
    type: "text",
    value: (r) => CHANNEL_LABELS[r.originChannel],
  },
  {
    key: "flags",
    label: "Sinais de revisão",
    type: "text",
    value: (r) => r.flags.map((flag) => FLAG_LABELS[flag]).join(", "),
  },
  { key: "createdAt", label: "Criado em", type: "datetime", value: (r) => r.createdAt },
];

/** Colunas a mais do COMPLETO, só do dono (RF29.Obs1). */
export const FULL_EXPORT_EXTRA_COLUMNS: readonly Column[] = [
  {
    key: "status",
    label: "Situação",
    type: "text",
    value: (r) => (r.deletedAt === null ? "Ativo" : "Excluído"),
  },
  { key: "deletedAt", label: "Excluído em", type: "datetime", value: (r) => r.deletedAt },
];
