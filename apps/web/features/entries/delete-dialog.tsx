"use client";

import { ENTRY_DELETE_REASON_MAX } from "@app/core/contracts";
import { type ReactNode, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Confirmação de exclusão (RF24), de um lançamento ou de um lote: motivo opcional de até 200
 * caracteres. Quem chama diz o que será excluído (`summary`), com os números que vieram do servidor.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  summary,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  summary: ReactNode;
  pending: boolean;
  error: string | null;
  onConfirm(reason: string | undefined): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <DialogBody
          title={title}
          summary={summary}
          pending={pending}
          error={error}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Corpo à parte: o motivo digitado nasce e morre junto com o diálogo aberto.
function DialogBody({
  title,
  summary,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  summary: ReactNode;
  pending: boolean;
  error: string | null;
  onConfirm(reason: string | undefined): void;
  onCancel(): void;
}) {
  const [reason, setReason] = useState("");
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{summary}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex flex-col gap-1">
        <Label htmlFor="delete-reason">Motivo (opcional)</Label>
        <Textarea
          id="delete-reason"
          value={reason}
          maxLength={ENTRY_DELETE_REASON_MAX}
          onChange={(event) => setReason(event.target.value)}
        />
        <span className="self-end text-xs text-muted-foreground">
          {reason.length}/{ENTRY_DELETE_REASON_MAX}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => onConfirm(reason.trim() === "" ? undefined : reason.trim())}
        >
          Excluir
        </Button>
      </AlertDialogFooter>
    </>
  );
}
