import type { ExportColumn } from "./columns";
import { businessDateToBR, centsToDecimalText, neutralizeFormula, timestampToBR } from "./format";

// CSV da exportação (RF29.R1): `;`, UTF-8 com BOM e `\r\n`.

const BOM = "﻿";
const SEPARATOR = ";";
const EOL = "\r\n";

function cellText<R>(column: ExportColumn<R>, row: R): string {
  const value = column.value(row);
  if (value === null) return "";
  switch (column.type) {
    case "money":
      return centsToDecimalText(Number(value));
    case "date":
      return businessDateToBR(String(value));
    case "datetime":
      return timestampToBR(String(value));
    case "int":
      return String(value);
    case "decimal":
      return String(value).replace(".", ",");
    case "text":
      // Só texto digitado por gente pode virar fórmula; número negativo não ganha apóstrofo.
      return neutralizeFormula(String(value));
  }
}

function escapeField(text: string): string {
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<R>(columns: readonly ExportColumn<R>[], rows: readonly R[]): string {
  const lines = [columns.map((c) => escapeField(c.label)).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(cellText(c, row))).join(SEPARATOR));
  }
  return BOM + lines.join(EOL) + EOL;
}
