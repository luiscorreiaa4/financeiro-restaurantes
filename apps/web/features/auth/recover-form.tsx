"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthClient, authErrorMessage, createAuthClient } from "./auth-client";
import { RESEND_SECONDS } from "./login-form";

const ERROR_ID = "recover-error";
const SENT =
  "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Ele vale por 30 minutos.";

type Props = { client?: AuthClient };

/** Pede o link de recuperação (RF03, DD-27). Quem conclui é a tela /redefinir-senha, aberta pelo link. */
export function RecoverForm({ client }: Props) {
  const [auth] = useState<AuthClient>(() => client ?? createAuthClient());
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  function changeEmail(value: string) {
    setEmail(value);
    // Outro e-mail pede outro link: volta ao passo de envio.
    if (sent) {
      setSent(false);
      setSecondsLeft(0);
    }
  }

  async function sendLink() {
    setPending(true);
    setError(null);
    try {
      await auth.requestPasswordReset(email);
      setSent(true);
      setSecondsLeft(RESEND_SECONDS);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || sent) return;
    await sendLink();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recover-email">E-mail</Label>
        <Input
          id="recover-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ERROR_ID : undefined}
          value={email}
          onChange={(e) => changeEmail(e.target.value)}
        />
      </div>

      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {sent ? SENT : null}
      </p>

      {error ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sent ? (
        <Button type="button" variant="outline" disabled={pending || counting} onClick={sendLink}>
          {counting ? `Reenviar link em ${secondsLeft} s` : "Reenviar link"}
        </Button>
      ) : (
        <Button type="submit" disabled={pending}>
          Enviar link
        </Button>
      )}

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Voltar ao login
        </Link>
      </p>
    </form>
  );
}
