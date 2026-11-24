"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildWhatsappLink } from "@/features/signup/welcome";

/** Link `wa.me` do produto com o texto pronto (RF05.Obs2). Sem número configurado, sem link. */
export function inviteLink(whatsappNumber: string | undefined, text: string): string | null {
  if (!whatsappNumber) return null;
  return `${buildWhatsappLink(whatsappNumber)}?text=${encodeURIComponent(text)}`;
}

/** Diálogo pós-cadastro: texto pronto, link do WhatsApp e "Copiar". */
export function InviteDialog({
  open,
  name,
  text,
  whatsappNumber,
  onClose,
}: {
  open: boolean;
  name: string;
  text: string;
  whatsappNumber: string | undefined;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(whatsappNumber, text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colaborador cadastrado</DialogTitle>
          <DialogDescription>
            Envie esta mensagem a {name}. Ela começa a lançar assim que responder.
          </DialogDescription>
        </DialogHeader>
        <p className="whitespace-pre-wrap rounded-lg border bg-muted p-3 text-sm">{text}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={copy}>
            {copied ? "Copiado" : "Copiar"}
          </Button>
          {link !== null && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              Abrir no WhatsApp
            </a>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
