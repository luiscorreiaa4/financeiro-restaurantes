"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthClient, authErrorCode, authErrorMessage, createAuthClient } from "./auth-client";

/** Espera entre dois pedidos de código (RF02): a API também limita, aqui só evitamos o clique repetido. */
export const RESEND_SECONDS = 60;

const ERROR_ID = "login-error";
const GENERIC_SENT = "Se o e-mail estiver cadastrado, você receberá o código.";

type Mode = "code" | "password";

type Props = {
  client?: AuthClient;
  /** Chamado depois de entrar. O padrão é navegar (página inteira, para o servidor ler o cookie novo). */
  onSignedIn?: () => void;
  /** Rota para onde ir depois de entrar (só caminho interno). */
  next?: string;
};

export function LoginForm({ client, onSignedIn, next = "/" }: Props) {
  const [auth] = useState<AuthClient>(() => client ?? createAuthClient());
  const [mode, setMode] = useState<Mode>("code");
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  useEffect(() => {
    if (codeSent) otpRef.current?.focus();
  }, [codeSent]);

  function switchMode(target: Mode) {
    setMode(target);
    setError(null);
  }

  function signedIn() {
    if (onSignedIn) onSignedIn();
    else window.location.assign(next);
  }

  function changeEmail(value: string) {
    setEmail(value);
    // Outro e-mail pede outro código: volta ao passo de envio.
    if (codeSent) {
      setCodeSent(false);
      setOtp("");
      setSecondsLeft(0);
    }
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(authErrorMessage(cause));
      const code = authErrorCode(cause);
      if (code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") {
        // Este código não serve mais: pede um novo.
        setCodeSent(false);
        setOtp("");
        setSecondsLeft(0);
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  async function sendCode() {
    const ok = await run(() => auth.sendCode(email));
    if (ok) {
      setCodeSent(true);
      setOtp("");
      setSecondsLeft(RESEND_SECONDS);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (mode === "password") {
      if (await run(() => auth.signInWithPassword({ email, password, rememberMe }))) signedIn();
    } else if (!codeSent) {
      await sendCode();
    } else if (await run(() => auth.signInWithCode({ email, otp, rememberMe }))) {
      signedIn();
    }
  }

  const showOtp = mode === "code" && codeSent;
  const invalid = error ? true : undefined;
  const describedBy = error ? ERROR_ID : undefined;

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">E-mail</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={mode === "code" && !codeSent ? invalid : undefined}
          aria-describedby={mode === "code" && !codeSent ? describedBy : undefined}
          value={email}
          onChange={(e) => changeEmail(e.target.value)}
        />
      </div>

      {mode === "password" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">Senha</Label>
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      ) : null}

      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {showOtp ? GENERIC_SENT : null}
      </p>

      {showOtp ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-otp">Código de 6 dígitos</Label>
          <Input
            id="login-otp"
            ref={otpRef}
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          id="login-remember"
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="size-4 accent-primary"
        />
        <Label htmlFor="login-remember">Manter conectado</Label>
      </div>

      {error ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {mode === "code" && !codeSent ? "Enviar código" : "Entrar"}
      </Button>

      {showOtp ? (
        <Button type="button" variant="outline" disabled={pending || counting} onClick={sendCode}>
          {counting ? `Reenviar código em ${secondsLeft} s` : "Reenviar código"}
        </Button>
      ) : null}

      <Button
        type="button"
        variant="link"
        onClick={() => switchMode(mode === "code" ? "password" : "code")}
      >
        {mode === "code" ? "Entrar com senha" : "Entrar com código"}
      </Button>
    </form>
  );
}
