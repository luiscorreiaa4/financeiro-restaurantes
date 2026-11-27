"use client";

import { useState } from "react";
import { InstallDialog } from "@/components/install-dialog";
import { useInstallMode } from "@/lib/use-install-mode";

/** Item "Instalar o app" (F7, DD-44): some quando o app já está instalado (tela cheia). */
export function InstallMenuItem({ className }: { className?: string }) {
  const mode = useInstallMode();
  const [open, setOpen] = useState(false);
  if (mode === "installed") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "text-left text-sm text-primary underline-offset-4 hover:underline pointer-coarse:min-h-11"
        }
      >
        Instalar o app
      </button>
      <InstallDialog mode={mode} open={open} onOpenChange={setOpen} />
    </>
  );
}
