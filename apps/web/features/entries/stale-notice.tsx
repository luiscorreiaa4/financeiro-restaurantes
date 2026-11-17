"use client";

import type { EntryDetail } from "@app/core/contracts";
import { Button } from "@/components/ui/button";
import { formatTime } from "./field-labels";

/**
 * Autor e hora da última versão do lançamento atual, para a frase do RF23.Obs2. Sem autor
 * (`changedBy` nulo: o lançador não vê o nome de quem é da gestão, DD-40), diz "pela gestão".
 */
function lastChange(current: EntryDetail): { by: string; time: string } | null {
  let latest: EntryDetail["versions"][number] | undefined;
  for (const version of current.versions) {
    if (latest === undefined || version.version > latest.version) latest = version;
  }
  if (!latest) return null;
  const by = latest.changedBy ? `por ${latest.changedBy.name}` : "pela gestão";
  return { by, time: formatTime(latest.changedAt) };
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
    ? `Este lançamento foi alterado ${change.by} às ${change.time}. Recarregar?`
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
