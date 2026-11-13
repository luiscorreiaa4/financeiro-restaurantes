"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthClient, authErrorCode, authErrorMessage, createAuthClient } from "./auth-client";
import { PREFILL_KEY } from "./login-form";

const ERROR_ID = "reset-error";
const INVALID_LINK = "Link inválido ou expirado. Peça um novo.";
const DONE_NOTICE = "Senha alterada. Entre com a nova senha.";
/** Tempo que a tela espera o encerramento da sessão do aparelho antes de desistir dele. */
const SIGN_OUT_TIMEOUT_MS = 8_000;

type Props = {
  client?: AuthClient;
  /** Chamado ao concluir. O padrão é ir para o login (página inteira). */
  onDone?: () => void;
  signOutTimeoutMs?: number;
};

/** Encerra a sessão do aparelho; `false` se falhou ou não respondeu a tempo. */
async function signOutWithin(auth: AuthClient, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([auth.signOut().then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Lê `#token=...` da URL. O fragmento nunca é enviado ao servidor nem vai no `Referer`. */
function readToken(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = params.get("token");
  return token && token.length > 0 ? token : null;
}

/** Nova senha pelo link do e-mail (RF03, DD-27). Abrir a página não gasta o link: só concluir. */
export function ResetPasswordForm({
  client,
  onDone,
  signOutTimeoutMs = SIGN_OUT_TIMEOUT_MS,
}: Props) {
  const [auth] = useState<AuthClient>(() => client ?? createAuthClient());
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [doneHere, setDoneHere] = useState(false);

  useEffect(() => {
    // No StrictMode (next dev) o efeito roda duas vezes e a segunda já não acha o fragmento, que
    // acabamos de apagar da barra de endereço: só troca o token se a leitura trouxe um.
    const found = readToken();
    setToken((previous) => found ?? previous);
    // Tira o token da barra de endereço e do histórico.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setReady(true);
  }, []);

  async function finish() {
    // RF02.R9: com sessão aberta no aparelho, a redefinição a encerra. Se o sign-out falhar ou não
    // responder, a sessão pode seguir aberta e o /login devolveria a pessoa ao painel sem mostrar o
    // aviso: nesse caso a confirmação aparece aqui mesmo.
    if (!(await signOutWithin(auth, signOutTimeoutMs))) {
      setDoneHere(true);
      return;
    }
    try {
      window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ notice: DONE_NOTICE }));
    } catch {
      // sem sessionStorage o login só não mostra o aviso.
    }
    if (onDone) onDone();
    else window.location.assign("/login");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || token === null) return;
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await auth.resetPassword({ token, password });
    } catch (cause) {
      setError(authErrorMessage(cause));
      if (authErrorCode(cause) === "INVALID_TOKEN") setLinkInvalid(true);
      setPending(false);
      return;
    }
    // O botão segue desativado até sair desta tela: a senha já foi trocada e o link, gasto.
    await finish();
  }

  if (!ready) {
    return (
      <p aria-busy="true" className="text-sm text-muted-foreground">
        Carregando…
      </p>
    );
  }

  if (doneHere) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <p role="status" className="text-sm">
          {DONE_NOTICE}
        </p>
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  if (token === null || linkInvalid) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <p role="alert" className="text-sm text-destructive">
          {error ?? INVALID_LINK}
        </p>
        <Link
          href="/recuperar-senha"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Pedir um novo link
        </Link>
      </div>
    );
  }

  const invalid = error ? true : undefined;
  const describedBy = error ? ERROR_ID : undefined;

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">Nova senha</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-confirm">Confirmar nova senha</Label>
        <Input
          id="reset-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        Alterar senha
      </Button>
    </form>
  );
}
