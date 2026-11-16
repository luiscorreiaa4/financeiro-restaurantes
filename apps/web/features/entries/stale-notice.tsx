"use client";

import type { EntryDetail } from "@app/core/contracts";
import { Button } from "@/components/ui/button";
import { formatTime } from "./field-labels";

/** Autor e hora da última versão do lançamento atual, para a frase do RF23.Obs2. */
function lastChange(current: EntryDetail): { name: string; time: string } | null {
  let latest: EntryDetail["versions"][number] | undefined;
  for (const version of current.versions) {
    if (latest === undefined || version.version > latest.version) latest = version;
  }
  return latest ? { name: latest.changedBy.name, time: formatTime(latest.changedAt) } : null;
}

/** Aviso de conflito de edição (RF23.Obs2): outra pessoa alterou o lançamento antes de salvar. */
export function StaleNotice({
  current,
  onReload,
}: {
  current: EntryDetail;
  onReload: (current: EntryDetail) => void;
}) {
  const change = lastChange(current);
  const text = change
    ? `Este lançamento foi alterado por ${change.name} às ${change.time}. Recarregar?`
    : "Este lançamento foi alterado por outra pessoa. Recarregar?";
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-md border p-3 text-sm">
      <p className="break-words">{text}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => onReload(current)}>
        Recarregar
      </Button>
    </div>
  );
}
