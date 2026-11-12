"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { OtpCodeField } from "@/components/otp-code-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthClient, authErrorCode, authErrorMessage, createAuthClient } from "./auth-client";

/** Espera entre dois pedidos de código (RF02): a API também limita, aqui só evitamos o clique repetido. */
export const RESEND_SECONDS = 60;

const ERROR_ID = "login-error";
/** Orientação de `NO_ACTIVE_UNIT` (RF02.CA10): texto fixo do painel, não o da API. */
const NO_ACTIVE_UNIT_MESSAGE =
  "Sua empresa está sem unidade ativa. Peça ao dono da empresa para reativar uma unidade.";
const GENERIC_SENT = "Se o e-mail estiver cadastrado, você receberá o código.";

type Mode = "code" | "password";

/** Chave que a recuperação deixa para o login: aviso e, se houver, o e-mail (nunca senha nem token). */
export const PREFILL_KEY = "login:prefill";

type Prefill = { email: string | null; notice: string | null };

function takePrefill(): Prefill | null {
  try {
    const raw = window.sessionStorage.getItem(PREFILL_KEY);
    if (raw === null) return null;
    window.sessionStorage.removeItem(PREFILL_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const email = "email" in parsed && typeof parsed.email === "string" ? parsed.email : null;
    const notice = "notice" in parsed && typeof parsed.notice === "string" ? parsed.notice : null;
    return email !== null || notice !== null ? { email, notice } : null;
  } catch {
    // sessionStorage bloqueado ou JSON torto: segue sem preencher.
  }
  return null;
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  // Trava síncrona: o sexto dígito e o botão podem disparar no mesmo instante, e são só 3 tentativas.
  const busyRef = useRef(false);

  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  // O campo fica travado durante o envio; ao liberar (código recusado), o foco volta para ele.
  useEffect(() => {
    if (codeSent && !pending) otpRef.current?.focus();
  }, [codeSent, pending]);

  // Vindo da recuperação (RF03): abre no modo senha com o e-mail preenchido. O e-mail viaja por
  // sessionStorage (não pela URL) e a chave é removida na primeira leitura.
  useEffect(() => {
    const prefilled = takePrefill();
    if (prefilled) {
      if (prefilled.email) setEmail(prefilled.email);
      setNotice(prefilled.notice);
      setMode("password");
    }
  }, []);

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
    if (busyRef.current) return false;
    busyRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      const code = authErrorCode(cause);
      setError(code === "NO_ACTIVE_UNIT" ? NO_ACTIVE_UNIT_MESSAGE : authErrorMessage(cause));
      if (code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") {
        // Este código não serve mais: pede um novo.
        setCodeSent(false);
        setOtp("");
        setSecondsLeft(0);
      }
      return false;
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  /** Recebe o código por argumento: ao completar o sexto dígito o estado ainda não atualizou. */
  async function signInWithCode(code: string) {
    if (await run(() => auth.signInWithCode({ email, otp: code, rememberMe }))) signedIn();
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
    } else {
      await signInWithCode(otp);
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
        {showOtp ? GENERIC_SENT : notice}
      </p>

      {showOtp ? (
        <OtpCodeField
          id="login-otp"
          ref={otpRef}
          value={otp}
          onChange={setOtp}
          onComplete={signInWithCode}
          disabled={pending}
          invalid={invalid}
          describedBy={describedBy}
        />
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

      {mode === "password" ? (
        <div className="flex flex-col items-center gap-1 text-center text-sm text-muted-foreground">
          <Link
            href="/recuperar-senha"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Esqueci a senha
          </Link>
          <p>Ainda não tem senha? Entre com o código ou toque em Esqueci a senha.</p>
        </div>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        Ainda não tem conta?{" "}
        <Link
          href="/cadastro"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Criar conta
        </Link>
      </p>
    </form>
  );
}
