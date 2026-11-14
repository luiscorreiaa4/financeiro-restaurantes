import type { EntryItem } from "@app/core/contracts";
import { Badge } from "@/components/ui/badge";
import { FLAG_LABELS } from "./field-labels";

/** Indicadores de revisão do lançamento (RF22.R4). Sem sinais, não renderiza nada. */
export function FlagBadges({ flags }: { flags: EntryItem["flags"] }) {
  if (flags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant="outline">
          {FLAG_LABELS[flag]}
        </Badge>
      ))}
    </span>
  );
}
