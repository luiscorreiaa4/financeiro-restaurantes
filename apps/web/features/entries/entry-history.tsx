import type { EntryChange, EntryVersion } from "@app/core/contracts";
import { formatBusinessDate, formatCents } from "@/lib/format";
import {
  ACTION_LABELS,
  CHANNEL_LABELS,
  FIELD_LABELS,
  FLAG_LABELS,
  formatInstant,
  TYPE_LABELS,
} from "./field-labels";

const MONEY_FIELDS = new Set<EntryChange["field"]>([
  "amountCents",
  "feeCents",
  "netCents",
  "feeFixedCents",
]);
const DATE_FIELDS = new Set<EntryChange["field"]>(["occurredOn", "paidOn"]);

/** Pontos-base como percentual ("250" vira "2,50%"), só com inteiros. */
function formatBasisPoints(bp: number): string {
  return `${Math.trunc(bp / 100)},${String(bp % 100).padStart(2, "0")}%`;
}

/** Valor de um campo no histórico. Texto do usuário sai como veio, para ser renderizado como texto. */
function formatValue(field: EntryChange["field"], value: EntryChange["before"]): string {
  if (value === null || value === "") return "—";
  if (typeof value === "number") {
    if (MONEY_FIELDS.has(field)) return formatCents(value);
    if (field === "feePercentBp") return formatBasisPoints(value);
    return String(value);
  }
  if (DATE_FIELDS.has(field)) return formatBusinessDate(value);
  if (field === "type") return TYPE_LABELS[value as keyof typeof TYPE_LABELS] ?? value;
  if (field === "flags") {
    return value
      .split(",")
      .map((flag) => FLAG_LABELS[flag.trim() as keyof typeof FLAG_LABELS] ?? flag.trim())
      .join(", ");
  }
  return value;
}

/**
 * Aba Histórico (RF25.R4): quem, quando, por qual canal, qual ação e o antes e depois de cada
 * campo. Versão `restricted` vem sem campos e é mostrada sem conteúdo. Versão sem autor
 * (`changedBy` nulo: feita pela gestão e vista pelo lançador, DD-40) aparece como "Gestão".
 */
export function EntryHistory({ versions }: { versions: EntryVersion[] }) {
  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem histórico registrado.</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {versions.map((version) => (
        <li key={version.version} className="rounded-md border p-2">
          <p className="text-sm font-medium">
            {ACTION_LABELS[version.action]} · {CHANNEL_LABELS[version.channel]}
          </p>
          <p className="text-xs text-muted-foreground">
            {version.changedBy?.name ?? "Gestão"} · {formatInstant(version.changedAt)}
          </p>
          {version.restricted ? (
            <p className="mt-2 text-sm">Alteração com informação restrita</p>
          ) : (
            version.changes.length > 0 && (
              <dl className="mt-2 flex flex-col gap-1">
                {version.changes.map((change) => (
                  <div key={change.field} className="flex min-w-0 flex-col text-sm">
                    <dt className="text-xs text-muted-foreground">{FIELD_LABELS[change.field]}</dt>
                    <dd className="min-w-0 break-words">
                      {version.action === "create" ? (
                        formatValue(change.field, change.after)
                      ) : (
                        <>
                          <span>{formatValue(change.field, change.before)}</span>
                          <span aria-hidden="true"> → </span>
                          <span className="sr-only"> passou a </span>
                          <span>{formatValue(change.field, change.after)}</span>
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )
          )}
        </li>
      ))}
    </ol>
  );
}
