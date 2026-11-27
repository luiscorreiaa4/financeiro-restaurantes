"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type InstallMode, promptInstall } from "@/lib/install-prompt";

const TEXT = {
  prompt: "Instale o painel neste aparelho para abri-lo em tela cheia, como um aplicativo.",
  ios: "Toque em Compartilhar (o quadrado com a seta) e depois em Adicionar à Tela de Início.",
  manual: "No menu do navegador, escolha Instalar app ou Adicionar à tela inicial.",
} as const;

/** Ajuda para instalar o painel (F7, DD-44): o modo decide se há botão ou só a orientação. */
export function InstallDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: Exclude<InstallMode, "installed">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  async function install() {
    if ((await promptInstall()) === "accepted") onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instalar o app</DialogTitle>
          <DialogDescription>{TEXT[mode]}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {mode === "prompt" && <Button onClick={() => void install()}>Instalar</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
