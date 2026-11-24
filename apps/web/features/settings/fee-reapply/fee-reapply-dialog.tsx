"use client";

import { type FeeReapplication, feeReapplicationSchema } from "@app/core/contracts";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { formatCents, todayBusinessDate } from "@/lib/format";
import type { SettingsScope } from "../shared/use-settings";
import {
  isReapplyPending,
  type ReapplyTarget,
  useLatestReapplication,
  usePreviewReapplication,
  useReapply,
} from "./use-fee-reapply";

const STATUS_TEXT: Record<FeeReapplication["status"], string> = {
  queued: "Na fila",
  running: "Em andamento",
  done: "Concluída",
  failed: "Não concluída",
};

const ERROR_TEXT: Record<string, string> = {
  rate_changed: "A taxa mudou depois do pedido. Nenhum lançamento foi alterado; peça de novo.",
  stale: "O pedido ficou parado e foi cancelado. Peça de novo.",
  queue_unavailable: "A fila não estava disponível. Nenhum lançamento foi alterado; peça de novo.",
  job_failed: "O processamento falhou. Peça de novo.",
};

function summarize(item: FeeReapplication): string {
  const base = `${STATUS_TEXT[item.status]}: ${item.updated} atualizados, ${item.skipped} ${item.skipped === 1 ? "pulado" : "pulados"} de ${item.matched}.`;
  if (item.status === "failed")
    return `${ERROR_TEXT[item.errorCode ?? ""] ?? "A reaplicação não foi concluída."} ${base}`;
  return base;
}

function monthStart(): string {
  return `${todayBusinessDate().slice(0, 8)}01`;
}

/** "Aplicar a taxa atual a lançamentos passados" (RF08 e RF09, Alteração). Só o dono. */
export function FeeReapplyDialog({
  scope,
  target,
  onClose,
}: {
  scope: SettingsScope;
  target: ReapplyTarget;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => todayBusinessDate());
  const [message, setMessage] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const attempt = useRef<{ key: string; signature: string } | null>(null);
  const sending = useRef(false);
  const latest = useLatestReapplication(scope, target);
  const preview = usePreviewReapplication(scope);
  const reapply = useReapply(scope, target);
  const signature = `${from}|${to}`;
  const range = { targetKind: target.kind, targetId: target.id, from, to };
  const pending = isReapplyPending(latest.data);

  async function runPreview() {
    setMessage(null);
    try {
      await preview.mutateAsync(range);
      setPreviewKey(signature);
    } catch (e) {
      setPreviewKey(null);
      setMessage(
        e instanceof ApiError && e.status === 422
          ? "O período precisa ter até 366 dias e terminar até hoje."
          : "Não foi possível calcular a prévia. Tente de novo.",
      );
    }
  }

  async function confirm() {
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    // Chave da tentativa (`escrita-idempotente.md`): só troca depois de um envio que deu certo.
    if (attempt.current === null || attempt.current.signature !== signature) {
      attempt.current = { key: crypto.randomUUID(), signature };
    }
    try {
      await reapply.mutateAsync({ ...range, clientRequestId: attempt.current.key });
      attempt.current = null;
    } catch (e) {
      const body =
        e instanceof ApiError
          ? (e.body as { code?: string; item?: unknown } | undefined)
          : undefined;
      if (body?.code === "reapply_in_progress") {
        const parsed = feeReapplicationSchema.safeParse(body.item);
        setMessage(
          `Este cadastro já tem uma reaplicação em andamento${parsed.success ? ` (${STATUS_TEXT[parsed.data.status].toLowerCase()})` : ""}. Espere terminar.`,
        );
        attempt.current = null;
      } else {
        setMessage("Não foi possível pedir a reaplicação. Tente de novo.");
      }
    } finally {
      sending.current = false;
    }
  }

  const previewed = previewKey === signature && preview.data !== undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar a taxa atual a lançamentos passados</DialogTitle>
          <DialogDescription>
            Recalcula a taxa e o líquido das receitas de “{target.name}” no período. Cada lançamento
            ganha uma nova versão no histórico; despesas não mudam.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reapply-from">De</Label>
            <Input
              id="reapply-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reapply-to">Até</Label>
            <Input
              id="reapply-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {previewed && preview.data && (
          <p role="status" className="rounded-lg border p-3 text-sm">
            {preview.data.matched} {preview.data.matched === 1 ? "lançamento" : "lançamentos"}; o
            líquido muda em {formatCents(preview.data.deltaNetCents)}
          </p>
        )}
        {message !== null && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        {latest.data && (
          <p role="status" className="text-sm text-muted-foreground">
            Última reaplicação ({latest.data.from} a {latest.data.to}): {summarize(latest.data)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="outline" onClick={runPreview} disabled={preview.isPending || pending}>
            Ver prévia
          </Button>
          <Button
            onClick={confirm}
            disabled={!previewed || preview.data?.matched === 0 || reapply.isPending || pending}
          >
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
