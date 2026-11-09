import { type Clock, sessionExpiresAt, shouldTouchSession } from "@app/core";

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
}

export interface SessionAccess {
  hasActiveMembership(userId: string): Promise<boolean>;
  touchSession(sessionId: string, state: { updatedAt: Date; expiresAt: Date }): Promise<void>;
}

export type SessionCheck = { ok: true; session: AuthSession; setCookies: string[] } | { ok: false };

export type CheckSession = (headers: Headers) => Promise<SessionCheck>;

/**
 * Autoridade da sessão a cada requisição (RF02.CA07, CA08): cookie válido, vínculo ativo e,
 * sem "manter conectado", vencimento empurrado 12 h a cada uso (RF02.R5).
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

    const now = deps.clock.now();
    let setCookies: string[] = [];
    if (shouldTouchSession({ lastTouchedAt: session.updatedAt, now })) {
      if (session.keepConnected) {
        // O Better Auth renova 30 dias e reenvia o cookie com o novo Max-Age.
        setCookies = await deps.gateway.refreshSession(headers);
      } else {
        await deps.access.touchSession(session.sessionId, {
          updatedAt: now,
          expiresAt: sessionExpiresAt({ keepConnected: false, now }),
        });
      }
    }
    return { ok: true, session, setCookies };
  };
}

export type SessionBlocked = (headers: Headers) => Promise<boolean>;

/**
 * Para as rotas do Better Auth (`/api/auth/*`): há sessão válida, mas o usuário perdeu o vínculo
 * ativo (RF02.CA07). Sem sessão devolve `false`: o próprio Better Auth responde.
 */
export function createSessionBlocked(deps: {
  gateway: AuthGateway;
  access: SessionAccess;
}): SessionBlocked {
  return async (headers) => {
    const session = await deps.gateway.readSession(headers);
    return session !== null && !(await deps.access.hasActiveMembership(session.userId));
  };
}
