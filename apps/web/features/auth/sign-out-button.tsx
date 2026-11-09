"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type AuthClient, createAuthClient } from "./auth-client";

type Props = {
  client?: AuthClient;
  /** Depois de sair. O padrão é abrir a tela de acesso (página inteira). */
  onSignedOut?: () => void;
};

export function SignOutButton({ client, onSignedOut }: Props) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      await (client ?? createAuthClient()).signOut();
    } catch {
      // Não fingimos que saiu: a sessão pode continuar aberta no servidor.
      setFailed(true);
      setPending(false);
      return;
    }
    if (onSignedOut) onSignedOut();
    else window.location.assign("/login");
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={signOut}>
        Sair
      </Button>
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível sair. Tente de novo.
        </p>
      ) : null}
    </div>
  );
}
