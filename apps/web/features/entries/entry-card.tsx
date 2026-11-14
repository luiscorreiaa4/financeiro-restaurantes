import type { EntryItem } from "@app/core/contracts";
import { formatBusinessDate, formatCents } from "@/lib/format";
import { CHANNEL_LABELS, formatQuantity, TYPE_LABELS } from "./field-labels";
import { FlagBadges } from "./flag-badges";

/** Cartão do lançamento no celular (RF22.Obs4): o cartão inteiro abre o lançamento. */
export function EntryCard({ item, onOpen }: { item: EntryItem; onOpen(id: string): void }) {
  const quantity = formatQuantity(item.quantity, item.quantityUnit);
  const details = [
    item.category?.name,
    item.supplier?.name,
    item.paymentMethod?.name,
    item.type === "revenue" ? item.salesChannel?.name : undefined,
    quantity || undefined,
  ].filter((text): text is string => Boolean(text));

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        className="flex w-full min-w-0 flex-col gap-1 p-3 text-left"
        onClick={() => onOpen(item.id)}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-medium">{item.description}</span>
          <span className="shrink-0 font-semibold tabular-nums">
            {formatCents(item.amountCents)}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
          <span>
            {TYPE_LABELS[item.type]} · {formatBusinessDate(item.occurredOn)}
            {item.paidOn !== item.occurredOn && ` · Pago em ${formatBusinessDate(item.paidOn)}`}
          </span>
          {item.type === "revenue" && <span>Líquido {formatCents(item.netCents)}</span>}
        </span>
        {details.length > 0 && (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {details.join(" · ")}
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {item.unit.name} · {item.createdBy.name} · {CHANNEL_LABELS[item.originChannel]}
        </span>
        <FlagBadges flags={item.flags} />
      </button>
    </li>
  );
}
