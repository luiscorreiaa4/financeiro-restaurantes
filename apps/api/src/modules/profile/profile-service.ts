import {
  type Clock,
  describeDevice,
  type EmailSender,
  normalizeEmail,
  type PasswordError,
  validatePassword,
} from "@app/core";
import type { AuthStore } from "@app/db";
import type { BackgroundTasks } from "../../infra/auth/background-tasks";
import type { AuthGateway, AuthSession } from "../auth/check-session";

export type ProfileErrorCode =
  | "NO_PASSWORD"
  | "INVALID_PASSWORD"
  | "SAME_PASSWORD"
  | "INVALID_NAME"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_NEEDS_LETTER_AND_DIGIT"
  | "PASSWORD_SAME_AS_EMAIL";

/** Falha prevista do perfil; a rota responde 400 com o código. */
export class ProfileError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProfileError";
  }
}

export interface ProfileView {
  readonly name: string;
  readonly email: string;
  readonly hasPassword: boolean;
  /** Nunca leva token nem id: só o que a tela mostra (RF02.R8). */
  readonly sessions: readonly { device: string; lastUsedAt: string; current: boolean }[];
}

/** IP e navegador da conexão, para a auditoria. */
export interface AuditContext {
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface ProfileService {
  get(session: AuthSession): Promise<ProfileView>;
  updateName(session: AuthSession, name: string): Promise<void>;
  changePassword(
    session: AuthSession,
    input: AuditContext & { currentPassword: string; newPassword: string },
  ): Promise<void>;
  /** Pede o link de recuperação ao e-mail da sessão; quem conclui é a tela de nova senha (DD-27). */
  requestPasswordLink(session: AuthSession, audit: AuditContext): Promise<void>;
  revokeOtherSessions(session: AuthSession, audit: AuditContext): Promise<void>;
}

export interface ProfileServiceDeps {
  readonly store: Pick<
    AuthStore,
    | "getPasswordHash"
    | "setPasswordHash"
    | "listSessions"
    | "deleteSessionsExcept"
    | "updateUserName"
    | "recordAudit"
  >;
  readonly gateway: Pick<AuthGateway, "hashPassword" | "verifyPassword" | "requestPasswordLink">;
  readonly email: Pick<EmailSender, "sendSecurityNotice">;
  readonly background: Pick<BackgroundTasks, "run">;
  readonly clock: Clock;
}

const NAME_MAX = 120;

const PASSWORD_CODES: Record<PasswordError, ProfileErrorCode> = {
  too_short: "PASSWORD_TOO_SHORT",
  too_long: "PASSWORD_TOO_LONG",
  needs_letter_and_digit: "PASSWORD_NEEDS_LETTER_AND_DIGIT",
  same_as_email: "PASSWORD_SAME_AS_EMAIL",
};

const auditFields = (audit: AuditContext) => ({
  ...(audit.ip !== undefined ? { ip: audit.ip } : {}),
  ...(audit.userAgent !== undefined ? { userAgent: audit.userAgent } : {}),
});

/**
 * Perfil do usuário logado (F1c, RF02): nome, senha e sessões. O e-mail e o usuário vêm sempre da
 * sessão, nunca do corpo da requisição.
 */
export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { store, gateway } = deps;

  function validateNewPassword(password: string, email: string): void {
    const policy = validatePassword({ password, email });
    if (!policy.ok) throw new ProfileError(PASSWORD_CODES[policy.error]);
  }

  /**
   * Encerra as outras sessões ANTES de gravar a senha: se isto falhar, nada mudou; se a gravação falhar depois, só se perderam sessões (seguro). Na ordem
   * inversa, uma falha deixava a senha trocada com as sessões antigas vivas (RF02.CA09).
   */
  async function revokeOthersBeforeWrite(session: AuthSession): Promise<void> {
    await store.deleteSessionsExcept(session.userId, session.sessionId);
  }

  /** Depois de gravar a senha: revoga de novo (janela de sessão aberta no meio), audita e avisa. */
  async function finishPasswordChange(
    session: AuthSession,
    event: "password_changed" | "password_set",
    audit: AuditContext,
  ): Promise<void> {
    await store.deleteSessionsExcept(session.userId, session.sessionId);
    await store.recordAudit({ event, userId: session.userId, ...auditFields(audit) });
    const to = normalizeEmail(session.email);
    const at = deps.clock.now();
    deps.background.run(() => deps.email.sendSecurityNotice({ to, kind: "password-changed", at }));
  }

  return {
    async get(session) {
      const [hash, sessions] = await Promise.all([
        store.getPasswordHash(session.userId),
        store.listSessions(session.userId, deps.clock.now()),
      ]);
      return {
        name: session.name,
        email: session.email,
        hasPassword: hash !== null,
        sessions: sessions.map((item) => ({
          device: describeDevice(item.userAgent),
          lastUsedAt: item.updatedAt.toISOString(),
          current: item.id === session.sessionId,
        })),
      };
    },

    async updateName(session, name) {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > NAME_MAX) throw new ProfileError("INVALID_NAME");
      await store.updateUserName(session.userId, trimmed);
      await store.recordAudit({ event: "name_changed", userId: session.userId });
    },

    async changePassword(session, input) {
      const hash = await store.getPasswordHash(session.userId);
      if (hash === null) throw new ProfileError("NO_PASSWORD");
      if (!(await gateway.verifyPassword({ hash, password: input.currentPassword }))) {
        throw new ProfileError("INVALID_PASSWORD");
      }
      validateNewPassword(input.newPassword, normalizeEmail(session.email));
      if (await gateway.verifyPassword({ hash, password: input.newPassword })) {
        throw new ProfileError("SAME_PASSWORD");
      }
      const newHash = await gateway.hashPassword(input.newPassword);
      await revokeOthersBeforeWrite(session);
      await store.setPasswordHash(session.userId, newHash);
      await finishPasswordChange(session, "password_changed", input);
    },

    async requestPasswordLink(session, audit) {
      await gateway.requestPasswordLink({
        email: normalizeEmail(session.email),
        ...auditFields(audit),
      });
    },

    async revokeOtherSessions(session, audit) {
      await store.deleteSessionsExcept(session.userId, session.sessionId);
      await store.recordAudit({
        event: "other_sessions_revoked",
        userId: session.userId,
        ...auditFields(audit),
      });
    },
  };
}
