import type { EntryChangeField } from "../contracts/entries";
import { CHANNEL_LABELS, FIELD_LABELS, FLAG_LABELS, TYPE_LABELS } from "../entry/labels";
import {
  diffVersion,
  parseVersionSnapshot,
  type VersionChangeValue,
  type VersionNames,
} from "../entry/version-diff";
import type { ExportColumn } from "./columns";
import { businessDateToBR, centsToDecimalText } from "./format";

/**
 * Uma versão de `entry_versions` como o leitor do banco entrega (forma de `EntryVersionRow`
 * do `@app/db`, mais o `entryId`, que o histórico do COMPLETO precisa).
 */
export interface EntryVersionInput {
  readonly entryId: string;
  readonly version: number;
  readonly action: string;
  readonly channel: string;
  readonly changedBy: { readonly id: string; readonly name: string };
  readonly changedAt: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** Uma linha por campo alterado. `changedAt` é ISO; `channel` já é o rótulo. */
export interface ExportHistoryRow {
  entryId: string;
  version: number;
  changedAt: string;
  author: string;
  channel: string;
  field: string;
  before: string;
  after: string;
}

export const HISTORY_EXPORT_COLUMNS: readonly ExportColumn<ExportHistoryRow>[] = [
  { key: "entryId", label: "Lançamento", type: "text", value: (r) => r.entryId },
  { key: "version", label: "Versão", type: "int", value: (r) => r.version },
  { key: "changedAt", label: "Data e hora", type: "datetime", value: (r) => r.changedAt },
  { key: "author", label: "Autor", type: "text", value: (r) => r.author },
  { key: "channel", label: "Canal", type: "text", value: (r) => r.channel },
  { key: "field", label: "Campo", type: "text", value: (r) => r.field },
  { key: "before", label: "Antes", type: "text", value: (r) => r.before },
  { key: "after", label: "Depois", type: "text", value: (r) => r.after },
];

/** Texto no lugar de uma versão cujo retrato não dá para ler. Nunca leva conteúdo. */
export const UNREADABLE = "(ilegível)";

/** Texto no lugar de uma versão em categoria sensível que o chamador não liberou. */
export const RESTRICTED = "(restrito)";

const MONEY_FIELDS: ReadonlySet<EntryChangeField> = new Set([
  "amountCents",
  "feeFixedCents",
  "feeCents",
  "netCents",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Retrato legível: objeto com ao menos uma chave. Nulo só vale para o antes (criação). */
function readable(value: unknown, allowNull: boolean): boolean {
  if (value === null || value === undefined) return allowNull;
  return isPlainObject(value) && Object.keys(value).length > 0;
}

/** Percentual em pontos-base como texto: 250 vira "2,50". */
function basisPointsToPercentText(bp: number): string {
  const abs = Math.abs(bp);
  return `${bp < 0 ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

function valueText(field: EntryChangeField, value: VersionChangeValue): string {
  if (value === null) return "";
  if (typeof value === "number") {
    if (MONEY_FIELDS.has(field)) return centsToDecimalText(value);
    if (field === "feePercentBp") return basisPointsToPercentText(value);
    return String(value).replace(".", ",");
  }
  switch (field) {
    case "type":
      return Object.hasOwn(TYPE_LABELS, value)
        ? TYPE_LABELS[value as keyof typeof TYPE_LABELS]
        : value;
    case "occurredOn":
    case "paidOn":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? businessDateToBR(value) : value;
    case "flags":
      return value
        .split(", ")
        .map((flag) =>
          Object.hasOwn(FLAG_LABELS, flag) ? FLAG_LABELS[flag as keyof typeof FLAG_LABELS] : flag,
        )
        .join(", ");
    default:
      return value;
  }
}

/**
 * Histórico do COMPLETO (RF29.Obs1): uma linha por campo alterado em cada versão, com nomes
 * do cadastro no lugar dos ids (`diffVersion`). Versão cujo antes ou depois não dá para ler
 * vira uma linha "(ilegível)" sem valores.
 *
 * Falha fechado (RF06.R3): versão que `diffVersion` marca como sensível (categoria sensível,
 * fora do cadastro ou retrato sem categoria) vira UMA linha "(restrito)", sem campo real nem
 * valores, a menos que `includeSensitive` seja `true`. Só o worker do COMPLETO (dono,
 * `export:full`) passa `true`.
 */
export function historyRows(
  versions: readonly EntryVersionInput[],
  names: VersionNames,
  opts?: { readonly includeSensitive?: boolean },
): ExportHistoryRow[] {
  const includeSensitive = opts?.includeSensitive === true;
  const rows: ExportHistoryRow[] = [];
  for (const v of versions) {
    const head = {
      entryId: v.entryId,
      version: v.version,
      changedAt: v.changedAt,
      author: v.changedBy.name,
      channel: Object.hasOwn(CHANNEL_LABELS, v.channel)
        ? CHANNEL_LABELS[v.channel as keyof typeof CHANNEL_LABELS]
        : v.channel,
    };
    if (!readable(v.before, true) || !readable(v.after, false)) {
      rows.push({ ...head, field: UNREADABLE, before: "", after: "" });
      continue;
    }
    const after = parseVersionSnapshot(v.after);
    if (after === null) {
      rows.push({ ...head, field: UNREADABLE, before: "", after: "" });
      continue;
    }
    const { changes, sensitive } = diffVersion(parseVersionSnapshot(v.before), after, names);
    if (sensitive && !includeSensitive) {
      rows.push({ ...head, field: RESTRICTED, before: "", after: "" });
      continue;
    }
    for (const change of changes) {
      rows.push({
        ...head,
        field: FIELD_LABELS[change.field],
        before: valueText(change.field, change.before),
        after: valueText(change.field, change.after),
      });
    }
  }
  return rows;
}
