"use client";

import type { EntryItem, EntryListQuery, EntrySort } from "@app/core/contracts";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { createContext, useContext } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBusinessDate, formatCents } from "@/lib/format";
import { CHANNEL_LABELS, formatQuantity } from "./field-labels";
import { FlagBadges } from "./flag-badges";

type SortState = Pick<EntryListQuery, "sort" | "dir">;

/** Colunas que o servidor sabe ordenar (DD-35). A ordem padrão é a de criação. */
type SortableColumn = Exclude<EntrySort, "created_at">;

/** Um clique ordena (decrescente), o segundo inverte e o terceiro volta à ordem padrão. */
export function nextSort(current: SortState, column: SortableColumn): SortState {
  if (current.sort !== column) return { sort: column, dir: "desc" };
  if (current.dir === "desc") return { sort: column, dir: "asc" };
  return { sort: "created_at", dir: "desc" };
}

function ariaSort(current: SortState, column: SortableColumn) {
  if (current.sort !== column) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}

/** Colunas ordenáveis pelo servidor, pelo id da coluna da tabela. */
const SORTABLE: Record<string, SortableColumn> = {
  date: "occurred_on",
  paidOn: "paid_on",
  amount: "amount",
};
const RIGHT_ALIGNED = new Set(["amount"]);

/** Seleção de linhas (só dono e gerente): `null` = tabela sem caixas. */
export type Selection = {
  selected: ReadonlySet<string>;
  total: number;
  onToggle(id: string): void;
  onToggleAll(): void;
};
const SelectionContext = createContext<Selection | null>(null);

function SelectCell({ item }: { item: EntryItem }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <Checkbox
      aria-label={`Selecionar ${item.description}`}
      checked={selection.selected.has(item.id)}
      onCheckedChange={() => selection.onToggle(item.id)}
    />
  );
}

function SelectAllHeader() {
  const selection = useContext(SelectionContext);
  if (!selection || selection.total === 0) return null;
  const all = selection.selected.size === selection.total;
  return (
    <Checkbox
      aria-label="Selecionar todos os carregados"
      checked={all}
      indeterminate={!all && selection.selected.size > 0}
      onCheckedChange={selection.onToggleAll}
    />
  );
}

/** Abre o lançamento; vem por contexto para as colunas ficarem estáveis, fora do componente. */
const OpenEntryContext = createContext<(id: string) => void>(() => {});

function DescriptionCell({ item }: { item: EntryItem }) {
  const onOpen = useContext(OpenEntryContext);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        className="max-w-xs truncate text-left font-medium underline-offset-2 hover:underline"
        onClick={() => onOpen(item.id)}
      >
        {item.description}
      </button>
      <FlagBadges flags={item.flags} />
    </div>
  );
}

// TanStack Table v9: recursos, colunas e dado de reserva ficam estáveis, fora do componente.
const features = tableFeatures({});
const column = createColumnHelper<typeof features, EntryItem>();
const columns = column.columns([
  column.display({
    id: "date",
    header: "Data",
    cell: ({ row }) => formatBusinessDate(row.original.occurredOn),
  }),
  column.display({
    id: "paidOn",
    header: "Pagamento",
    // Só quando difere da data de competência (RF22, colunas).
    cell: ({ row }) =>
      row.original.paidOn === row.original.occurredOn
        ? ""
        : formatBusinessDate(row.original.paidOn),
  }),
  column.display({
    id: "description",
    header: "Descrição",
    cell: ({ row }) => <DescriptionCell item={row.original} />,
  }),
  column.display({
    id: "quantity",
    header: "Qtde.",
    cell: ({ row }) => formatQuantity(row.original.quantity, row.original.quantityUnit),
  }),
  column.display({
    id: "amount",
    header: "Valor",
    cell: ({ row }) => (
      <div className="flex flex-col items-end tabular-nums">
        <span>{formatCents(row.original.amountCents)}</span>
        {row.original.type === "revenue" && (
          <span className="text-xs text-muted-foreground">
            Líquido {formatCents(row.original.netCents)}
          </span>
        )}
      </div>
    ),
  }),
  column.display({
    id: "category",
    header: "Categoria",
    cell: ({ row }) => row.original.category?.name ?? "",
  }),
  column.display({
    id: "supplier",
    header: "Fornecedor",
    cell: ({ row }) => row.original.supplier?.name ?? "",
  }),
  column.display({
    id: "payment",
    header: "Forma e canal",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{row.original.paymentMethod?.name ?? ""}</span>
        {row.original.type === "revenue" && row.original.salesChannel && (
          <span className="text-xs text-muted-foreground">{row.original.salesChannel.name}</span>
        )}
      </div>
    ),
  }),
  column.display({
    id: "unit",
    header: "Unidade",
    cell: ({ row }) => row.original.unit.name,
  }),
  column.display({
    id: "createdBy",
    header: "Lançado por",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{row.original.createdBy.name}</span>
        <span className="text-xs text-muted-foreground">
          {CHANNEL_LABELS[row.original.originChannel]}
        </span>
      </div>
    ),
  }),
]);

const selectColumn = column.display({
  id: "select",
  header: () => <SelectAllHeader />,
  cell: ({ row }) => <SelectCell item={row.original} />,
});
const selectableColumns = column.columns([selectColumn, ...columns]);

/**
 * Tabela do computador. A ordenação é do servidor (DD-35): o cabeçalho só pede outra ordem,
 * nunca reordena o que já está na tela.
 */
export function EntriesTable({
  items,
  sort,
  onSort,
  onOpen,
  selection,
}: {
  items: EntryItem[];
  sort: SortState;
  onSort(next: SortState): void;
  onOpen(id: string): void;
  /** Só para dono e gerente (RF24.Obs3); sem isso a tabela não tem caixas. */
  selection?: Selection;
}) {
  const table = useTable({
    features,
    columns: selection ? selectableColumns : columns,
    data: items,
    getRowId: (item) => item.id,
  });

  return (
    <OpenEntryContext.Provider value={onOpen}>
      <SelectionContext.Provider value={selection ?? null}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const align = RIGHT_ALIGNED.has(header.column.id) ? "text-right" : "";
                  const sortable = SORTABLE[header.column.id];
                  if (!sortable) {
                    return (
                      <TableHead key={header.id} className={align}>
                        <table.FlexRender header={header} />
                      </TableHead>
                    );
                  }
                  const state = ariaSort(sort, sortable);
                  const Icon =
                    state === "ascending"
                      ? ArrowUpIcon
                      : state === "descending"
                        ? ArrowDownIcon
                        : ChevronsUpDownIcon;
                  return (
                    <TableHead key={header.id} aria-sort={state} className={align}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                        onClick={() => onSort(nextSort(sort, sortable))}
                      >
                        <table.FlexRender header={header} />
                        <Icon aria-hidden="true" className="size-3.5" />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SelectionContext.Provider>
    </OpenEntryContext.Provider>
  );
}
