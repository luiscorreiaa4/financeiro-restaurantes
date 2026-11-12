"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authErrorMessage } from "@/features/auth/auth-client";
import { RESEND_SECONDS } from "@/features/auth/login-form";
import {
  createProfileClient,
  PROFILE_KEY,
  type Profile,
  type ProfileClient,
} from "./profile-client";

const LAST_USED_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `dd/MM/yyyy às HH:mm` em America/Sao_Paulo. */
function formatLastUsed(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = LAST_USED_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} às ${part("hour")}:${part("minute")}`;
}

type Props = { client?: ProfileClient };

export function ProfileView({ client }: Props) {
  const [api] = useState<ProfileClient>(() => client ?? createProfileClient());
  const query = useQuery({ queryKey: PROFILE_KEY, queryFn: () => api.get() });

  if (query.isPending) {
    return (
      <p aria-busy="true" className="text-sm text-muted-foreground">
        Carregando…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {authErrorMessage(query.error)}
      </p>
    );
  }
  return <ProfileContent profile={query.data} api={api} />;
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {done}
      </p>
    </>
  );
}

function ProfileContent({ profile, api }: { profile: Profile; api: ProfileClient }) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <NameSection profile={profile} api={api} />
      <PasswordSection hasPassword={profile.hasPassword} api={api} />
      <SessionsSection profile={profile} api={api} />
    </div>
  );
}

function NameSection({ profile, api }: { profile: Profile; api: ProfileClient }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [done, setDone] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (value: string) => api.updateName(value),
    onSuccess: async () => {
      setDone("Nome salvo.");
      // O nome do menu vem do layout do servidor: refresh o relê sem recarregar a página.
      router.refresh();
      await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setDone(null);
    mutation.mutate(name);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Nome</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Nome</Label>
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">{profile.email}</p>
        </div>
        <Feedback error={mutation.error ? authErrorMessage(mutation.error) : null} done={done} />
        <Button type="submit" className="self-start" disabled={mutation.isPending}>
          Salvar
        </Button>
      </form>
    </section>
  );
}

type PasswordVia = "current" | "link";

function PasswordSection({ hasPassword, api }: { hasPassword: boolean; api: ProfileClient }) {
  const queryClient = useQueryClient();
  const [via, setVia] = useState<PasswordVia>("current");
  const [linkSent, setLinkSent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Sem senha definida só existe o caminho do link por e-mail.
  const mode: PasswordVia = hasPassword ? via : "link";

  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const request = useMutation({
    mutationFn: () => api.requestPasswordLink(),
    onSuccess: () => {
      setLinkSent(true);
      setSecondsLeft(RESEND_SECONDS);
    },
  });

  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      setDone("Senha alterada.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });

  function switchVia(target: PasswordVia) {
    setVia(target);
    setLocalError(null);
    setDone(null);
    setLinkSent(false);
    setSecondsLeft(0);
    request.reset();
    change.reset();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    setDone(null);
    if (newPassword !== confirm) {
      setLocalError("As senhas não conferem.");
      return;
    }
    setLocalError(null);
    change.mutate();
  }

  function sendLink() {
    setDone(null);
    request.mutate();
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Senha</h2>
      {!hasPassword ? (
        <p className="text-sm text-muted-foreground">
          Você ainda não tem senha. Defina uma pelo link enviado ao seu e-mail.
        </p>
      ) : null}

      {mode === "current" ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-current-password">Senha atual</Label>
            <Input
              id="profile-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-new-password">Nova senha</Label>
            <Input
              id="profile-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-confirm-password">Confirmar nova senha</Label>
            <Input
              id="profile-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <Feedback
            error={localError ?? (change.error ? authErrorMessage(change.error) : null)}
            done={done}
          />

          <Button type="submit" className="self-start" disabled={change.isPending}>
            Trocar senha
          </Button>
          <Button
            type="button"
            variant="link"
            className="self-start px-0"
            onClick={() => switchVia("link")}
          >
            Não lembro a senha atual: receber link
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Enviaremos um link para o seu e-mail. Ao usá-lo para escolher a nova senha, você sai de
            todos os aparelhos e entra de novo.
          </p>
          {linkSent ? (
            <p role="status" className="text-sm">
              Enviamos um link para o seu e-mail. Ele vale por 30 minutos e só pode ser usado uma
              vez.
            </p>
          ) : null}
          <Feedback error={request.error ? authErrorMessage(request.error) : null} done={null} />
          <Button
            type="button"
            variant={linkSent ? "outline" : "default"}
            className="self-start"
            disabled={request.isPending || counting}
            onClick={sendLink}
          >
            {linkSent
              ? counting
                ? `Reenviar link em ${secondsLeft} s`
                : "Reenviar link"
              : "Receber link por e-mail"}
          </Button>
          {hasPassword ? (
            <Button
              type="button"
              variant="link"
              className="self-start px-0"
              onClick={() => switchVia("current")}
            >
              Usar a senha atual
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SessionsSection({ profile, api }: { profile: Profile; api: ProfileClient }) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: async () => {
      setDone("As outras sessões foram encerradas.");
      await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });
  const onlyCurrent = profile.sessions.every((s) => s.current);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Sessões ativas</h2>
      <ul aria-label="Sessões ativas" className="flex flex-col gap-2">
        {profile.sessions.map((session, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a API não devolve id de sessão (só há "encerrar as outras").
            key={index}
            className="flex flex-col gap-0.5 rounded-md border p-3 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2 font-medium">
              {session.device}
              {session.current ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                  Esta sessão
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground">
              Último uso: {formatLastUsed(session.lastUsedAt)}
            </span>
          </li>
        ))}
      </ul>
      <Feedback error={mutation.error ? authErrorMessage(mutation.error) : null} done={done} />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={onlyCurrent || mutation.isPending}
        onClick={() => {
          setDone(null);
          mutation.mutate();
        }}
      >
        Encerrar as outras sessões
      </Button>
    </section>
  );
}
