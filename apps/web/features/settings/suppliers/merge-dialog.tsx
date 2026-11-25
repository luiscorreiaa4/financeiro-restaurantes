"use client";

import type { SupplierSettings } from "@app/core/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { tenantKey } from "@/lib/query/keys";
import { settingsErrorText } from "../shared/settings-errors";
import type { SettingsScope } from "../shared/use-settings";

const ERRORS = {
  document_conflict:
    "Os dois fornecedores têm documentos diferentes. Corrija um deles antes de mesclar.",
  aliases_overflow: "Juntos, os apelidos passam de 10. Remova alguns apelidos antes de mesclar.",
  merge_too_large:
    "Este fornecedor tem lançamentos demais para mesclar pela tela. Fale com o suporte.",
  already_merged: "Este fornecedor já foi mesclado.",
  "target_id.same_supplier": "Escolha um fornecedor diferente.",
};

type Props = {
  scope: SettingsScope;
  source: SupplierSettings;
  candidates: readonly SupplierSettings[];
  onClose: () => void;
  onMerged: () => void;
};

/** Mesclagem (RF10, CA02): origem fixa, destino escolhido, prévia do que o ator vê, confirmação. */
export function MergeDialog({ scope, source, candidates, onClose, onMerged }: Props) {
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const preview = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "suppliers", "merge-preview", source.id, targetId),
    queryFn: () => scope.api.previewMerge(source.id, targetId),
    enabled: targetId !== "",
  });
  const merge = useMutation({
    mutationFn: () => scope.api.mergeSuppliers(source.id, targetId),
  });
  const options = candidates.filter((item) => item.id !== source.id && item.status === "active");

  async function confirm() {
    if (sending.current || targetId === "") return;
    sending.current = true;
    setError(null);
    try {
      await merge.mutateAsync();
      onMerged();
    } catch (e) {
      setError(settingsErrorText(e, ERRORS).message);
    } finally {
      sending.current = false;
    }
  }

  const count = preview.data?.visibleEntries;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mesclar {source.name}</DialogTitle>
          <DialogDescription>
            Os lançamentos, os apelidos e o nome de {source.name} passam para o fornecedor
            escolhido. Isso não pode ser desfeito pela tela.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor="merge-target">Mesclar em</Label>
          <select
            id="merge-target"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Escolha o fornecedor de destino</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {targetId !== "" && preview.isPending && <p role="status">Calculando…</p>}
        {preview.isError && <p role="alert">Não foi possível calcular a prévia.</p>}
        {count !== undefined && (
          <div className="rounded-lg border p-3 text-sm">
            <p>
              {count === 1 ? "1 lançamento" : `${count} lançamentos`} no seu recorte
              {count === 1 ? " vai" : " vão"} para o destino.
            </p>
            <p className="mt-1 text-muted-foreground">
              Atenção: lançamentos que você não vê também passam para o destino.
            </p>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={targetId === "" || count === undefined} onClick={confirm}>
            Mesclar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
