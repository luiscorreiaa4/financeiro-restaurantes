import { type ExportColumn, neutralizeFormula, toCsv } from "@app/core";
import type { EntryFilters, ExportContent, ExportFormat } from "@app/core/contracts";
import { strToU8, zipSync } from "fflate";
import writeXlsxFile from "write-excel-file/node";

export interface ExportSheet<R> {
  name: string;
  columns: readonly ExportColumn<R>[];
  rows: readonly R[];
}

/**
 * Folha com o tipo da linha apagado, para `writeXlsx` receber folhas de linhas diferentes sem
 * `any`. `ExportSheet<R>` é atribuível a ela (a coluna recebe `never`, a linha é `unknown`).
 */
export interface AnyExportSheet {
  name: string;
  columns: readonly ExportColumn<never>[];
  rows: readonly unknown[];
}

const MONEY_FORMAT = '"R$" #,##0.00';
const DATE_FORMAT = "dd/mm/yyyy";
const DATETIME_FORMAT = "dd/mm/yyyy hh:mm";
const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Cell = Parameters<typeof writeXlsxFile>[0] extends infer S
  ? S extends ReadonlyArray<ReadonlyArray<infer C>>
    ? C
    : never
  : never;

function businessDateCell(text: string): Date {
  const m = BUSINESS_DATE.exec(text);
  if (!m) throw new RangeError("data de negócio deve ser AAAA-MM-DD");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * O Excel guarda data e hora sem fuso. O instante ISO vira a hora de parede de São Paulo (igual
 * ao CSV, `timestampToBR`) e é gravado como data "flutuante" em UTC: a célula mostra 22:30 se
 * em São Paulo eram 22:30, qualquer que seja o fuso de quem abre o arquivo.
 */
function floatingSaoPaulo(iso: string): Date {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError("instante inválido");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(
    Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")),
  );
}

function toCell(column: ExportColumn<never>, row: unknown): Cell {
  const value = column.value(row as never);
  if (value === null || value === "") return null as Cell;
  switch (column.type) {
    case "money":
      // Única conta com dinheiro fora do core: centavos inteiros ÷ 100 na célula numérica.
      return { value: Number(value) / 100, type: Number, format: MONEY_FORMAT } as Cell;
    case "date":
      return { value: businessDateCell(String(value)), type: Date, format: DATE_FORMAT } as Cell;
    case "datetime":
      return {
        value: floatingSaoPaulo(String(value)),
        type: Date,
        format: DATETIME_FORMAT,
      } as Cell;
    case "int":
      return { value: Number(value), type: Number, format: "0" } as Cell;
    case "decimal":
      return { value: Number(value), type: Number } as Cell;
    case "text":
      return { value: neutralizeFormula(String(value)), type: String } as Cell;
  }
}

export async function writeXlsx(sheets: readonly AnyExportSheet[]): Promise<Uint8Array> {
  const data = sheets.map((sheet) => {
    const header = sheet.columns.map((c) => ({ value: c.label, fontWeight: "bold" }) as Cell);
    const body = sheet.rows.map((row) => sheet.columns.map((c) => toCell(c, row)));
    return { data: [header, ...body], sheet: sheet.name };
  });
  const buffer = await writeXlsxFile(data as never).toBuffer();
  return new Uint8Array(buffer);
}

export function writeCsv<R>(sheet: ExportSheet<R>): Uint8Array {
  return strToU8(toCsv(sheet.columns, sheet.rows));
}

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

export function exportFileName(
  content: ExportContent,
  format: ExportFormat,
  filters: EntryFilters,
): string {
  const ext = content === "full" && format === "csv" ? "zip" : format;
  const base = content === "full" ? "lancamentos-completo" : "lancamentos";
  return `${base}_${filters.from}_${filters.to}.${ext}`;
}

export function exportContentType(ext: "xlsx" | "csv" | "zip"): string {
  switch (ext) {
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv":
      return "text/csv; charset=utf-8";
    case "zip":
      return "application/zip";
  }
}
