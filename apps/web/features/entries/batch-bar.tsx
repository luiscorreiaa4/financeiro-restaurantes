"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { formatCents } from "@/lib/format";
import { DeleteDialog } from "./delete-dialog";
import { useBatchDelete, useBatchPreview } from "./use-entries";

const FAILED = "Não foi possível excluir. Tente de novo.";
const CHANGED =
  "Algum lançamento selecionado mudou ou não pode ser excluído. Atualize a lista e tente de novo.";

/**
 * Barra "N selecionados" (RF24.Obs3). A confirmação mostra a quantidade e a soma que o servidor
 * calculou na pré-visualização: a tela não soma. Tudo ou nada: se algum id mudou, nada é excluído.
 */
export function BatchBar({
  ids,
  onDone,
  onClear,
}: {
  ids: readonly string[];
  onDone(): void;
  onClear?: () => void;
}) {
  const preview = useBatchPreview();
  const remove = useBatchDelete();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setError(null);
    try {
      await preview.mutateAsync(ids);
      setOpen(true);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? CHANGED : FAILED);
    }
  }

  async function confirm(reason: string | undefined) {
    setError(null);
    try {
      await remove.mutateAsync({ ids, reason });
      setOpen(false);
      onDone();
    } catch (e) {
      const stale = e instanceof ApiError && (e.status === 404 || e.status === 409);
      setError(stale ? CHANGED : FAILED);
    }
  }

  const count = ids.length;
  const summary = preview.data
    ? `Excluir ${preview.data.count} ${preview.data.count === 1 ? "lançamento" : "lançamentos"}, somando ${formatCents(preview.data.totalCents)}? Eles ficam 30 dias na lixeira.`
    : "";

  return (
    <section
      aria-label="Seleção de lançamentos"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm"
    >
      <span>{count === 1 ? "1 selecionado" : `${count} selecionados`}</span>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={preview.isPending}
        onClick={() => void ask()}
      >
        Excluir selecionados
      </Button>
      {onClear && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Limpar seleção
        </Button>
      )}
      {!open && error && (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      )}
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Excluir lançamentos?"
        summary={summary}
        pending={remove.isPending}
        error={open ? error : null}
        onConfirm={(reason) => void confirm(reason)}
      />
    </section>
  );
}
