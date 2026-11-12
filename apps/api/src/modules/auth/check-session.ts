import {
  type Clock,
  canHoldSession,
  type PanelEntry,
  type RestrictedReason,
  sessionExpiresAt,
  shouldTouchSession,
} from "@app/core";

/** Sessão lida do cookie, já validada pelo Better Auth (assinatura e vencimento). */
export interface AuthSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly keepConnected: boolean;
  /** Último uso registrado (renovado no máximo a cada 5 min). */
  readonly updatedAt: Date;
}

/** O que a API precisa do Better Auth; o adaptador fica em `infra/auth`. */
export interface AuthGateway {
  /** Rotas `/api/auth/*` do Better Auth. */
  handle(request: Request): Promise<Response>;
  /** Lê a sessão do cookie sem renová-la; `null` se ausente, adulterada ou vencida. */
  readSession(headers: Headers): Promise<AuthSession | null>;
  /** Renova a sessão "manter conectado" e devolve os `set-cookie` com o novo prazo. */
  refreshSession(headers: Headers): Promise<string[]>;
  /**
   * Abre a sessão de um usuário recém-criado (autocadastro, RF01.Obs2), sem "manter conectado",
   * e devolve os `set-cookie`. Não confere vínculo: quem chama acabou de criá-lo.
   */
  openSession(input: { userId: string; ip?: string; userAgent?: string }): Promise<string[]>;
  /** Hash de senha pelo mesmo mecanismo do login por senha (conta `credential`). */
  hashPassword(password: string): Promise<string>;
  /** Confere a senha contra um hash guardado (mesmo mecanismo do login por senha). */
  verifyPassword(input: { hash: string; password: string }): Promise<boolean>;
  /**
   * Pede o link de recuperação de senha (RF03, DD-27). Resolve SEMPRE do mesmo jeito: o envio e
   * a conferência de vínculo e de limites (RF02.R4) rodam em segundo plano, então nada revela se
   * o e-mail existe.
   */
  requestPasswordLink(input: { email: string; ip?: string; userAgent?: string }): Promise<void>;
  /** Lê o link sem consumi-lo; `null` se não existe ou venceu. */
  peekResetToken(token: string): Promise<{ userId: string } | null>;
  /**
   * Consome o link e grava a senha (cria a conta `credential` se faltar). Lança `ResetTokenError`
   * para link inválido, vencido ou já usado.
   */
  resetPasswordWithToken(input: { token: string; password: string }): Promise<void>;
}

/** Link de recuperação inválido, vencido ou já usado (`INVALID_TOKEN`). */
export class ResetTokenError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ResetTokenError";
  }
}

export interface SessionAccess {
  hasActiveMembership(userId: string): Promise<boolean>;
  panelEntry(userId: string): Promise<PanelEntry>;
  touchSession(sessionId: string, state: { updatedAt: Date; expiresAt: Date }): Promise<void>;
}

export type SessionCheck = { ok: true; session: AuthSession; setCookies: string[] } | { ok: false };

export type CheckSession = (headers: Headers) => Promise<SessionCheck>;

export type EntryCheck =
  | { ok: true; session: AuthSession; setCookies: string[]; access: "full" }
  | {
      ok: true;
      session: AuthSession;
      setCookies: string[];
      access: "restricted";
      reason: RestrictedReason;
    }
  | { ok: false };

export type CheckEntry = (headers: Headers) => Promise<EntryCheck>;

/** Renovação do uso (RF02.R5): "manter conectado" pelo Better Auth; o resto empurra 12 h. */
async function renewSession(
  deps: { gateway: AuthGateway; access: SessionAccess; clock: Clock },
  session: AuthSession,
  headers: Headers,
): Promise<string[]> {
  const now = deps.clock.now();
  if (!shouldTouchSession({ lastTouchedAt: session.updatedAt, now })) return [];
  if (session.keepConnected) {
    // O Better Auth renova 30 dias e reenvia o cookie com o novo Max-Age.
    return deps.gateway.refreshSession(headers);
  }
  await deps.access.touchSession(session.sessionId, {
    updatedAt: now,
    expiresAt: sessionExpiresAt({ keepConnected: false, now }),
  });
  return [];
}

/**
 * Autoridade da sessão a cada requisição (RF02.CA07, CA08): cookie válido, vínculo ativo e,
 * sem "manter conectado", vencimento empurrado 12 h a cada uso (RF02.R5). Só acesso completo
 * passa: a sessão restrita (DD-33) não alcança nenhuma rota que use esta checagem.
 */
export function createCheckSession(deps: {
  gateway: AuthGateway;
  access: SessionAccess;
  clock: Clock;
}): CheckSession {
  return async (headers) => {
    const session = await deps.gateway.readSession(headers);
    if (session === null) return { ok: false };
    if (!(await deps.access.hasActiveMembership(session.userId))) return { ok: false };
    const setCookies = await renewSession(deps, session, headers);
    return { ok: true, session, setCookies };
  };
}

/**
 * Entrada do painel que também aceita o modo restrito (DD-33). Usada só por `GET /api/me` e
 * `POST /api/companies`; o resultado `restricted` nunca dá acesso a dado de empresa.
 */
export function createCheckEntry(deps: {
  gateway: AuthGateway;
  access: SessionAccess;
  clock: Clock;
}): CheckEntry {
  return async (headers) => {
    const session = await deps.gateway.readSession(headers);
    if (session === null) return { ok: false };
    const entry = await deps.access.panelEntry(session.userId);
    if (entry.kind === "refused") return { ok: false };
    const setCookies = await renewSession(deps, session, headers);
    if (entry.kind === "full") return { ok: true, session, setCookies, access: "full" };
    return { ok: true, session, setCookies, access: "restricted", reason: entry.reason };
  };
}

export type SessionBlocked = (headers: Headers) => Promise<boolean>;

/**
 * Para as rotas do Better Auth (`/api/auth/*`): há sessão válida, mas o usuário não pode mais
 * mantê-la (`refused`, RF02.CA07). A sessão restrita passa, para conseguir sair. Sem sessão
 * devolve `false`: o próprio Better Auth responde.
 */
export function createSessionBlocked(deps: {
  gateway: AuthGateway;
  access: SessionAccess;
}): SessionBlocked {
  return async (headers) => {
    const session = await deps.gateway.readSession(headers);
    return session !== null && !canHoldSession(await deps.access.panelEntry(session.userId));
  };
}
