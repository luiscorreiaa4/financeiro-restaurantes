import {
  type Clock,
  type EmailSender,
  normalizeEmail,
  type PasswordError,
  validatePassword,
} from "@app/core";
import type { AuthStore } from "@app/db";
import type { BackgroundTasks } from "../../infra/auth/background-tasks";
import { type AuthGateway, ResetTokenError } from "../auth/check-session";
import { type AuditFailureReporter, recordAuditSafely } from "../auth/record-audit-safely";
import { hashSignupEmail } from "../signup/signup-hashing";

export type RecoveryErrorCode =
  | "INVALID_TOKEN"
  | "SAME_PASSWORD"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_NEEDS_LETTER_AND_DIGIT"
  | "PASSWORD_SAME_AS_EMAIL";

/** Falha prevista da recuperação de senha; a rota responde 400 com o código. */
export class RecoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RecoveryError";
  }
}

export type RecoverPassword = (input: {
  token: string;
  password: string;
  ip?: string;
  userAgent?: string;
}) => Promise<void>;

export type RequestRecoveryLink = (input: {
  email: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}) => Promise<void>;

/** Pedido do link: normaliza o e-mail e entrega ao gateway, que decide em segundo plano. */
export function createRequestRecoveryLink(deps: {
  gateway: Pick<AuthGateway, "requestPasswordLink">;
}): RequestRecoveryLink {
  return async (input) => {
    await deps.gateway.requestPasswordLink({
      email: normalizeEmail(input.email),
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });
  };
}

export interface RecoverPasswordDeps {
  readonly store: Pick<
    AuthStore,
    | "findUserById"
    | "hasActiveMembership"
    | "getPasswordHash"
    | "deleteSessionsExcept"
    | "updatePasswordState"
    | "recordAudit"
  >;
  readonly gateway: Pick<
    AuthGateway,
    "peekResetToken" | "verifyPassword" | "resetPasswordWithToken"
  >;
  readonly email: Pick<EmailSender, "sendSecurityNotice">;
  readonly background: Pick<BackgroundTasks, "run">;
  readonly clock: Clock;
  /** Falha do registro de auditoria depois da troca já feita: só vai para o log (DD-30). */
  readonly onAuditFailure?: AuditFailureReporter;
}

const PASSWORD_CODES: Record<PasswordError, RecoveryErrorCode> = {
  too_short: "PASSWORD_TOO_SHORT",
  too_long: "PASSWORD_TOO_LONG",
  needs_letter_and_digit: "PASSWORD_NEEDS_LETTER_AND_DIGIT",
  same_as_email: "PASSWORD_SAME_AS_EMAIL",
};

/**
 * Recuperação de senha pelo link do e-mail (RF03, DD-27). O link é só espiado até o fim das
 * conferências: erro de senha ou "igual à atual" não o gasta. Só `ResetTokenError` é traduzido;
 * qualquer outro erro (infraestrutura) segue como está.
 */
export function createRecoverPassword(deps: RecoverPasswordDeps): RecoverPassword {
  const { store, gateway } = deps;
  return async (input) => {
    if (input.token === "") throw new RecoveryError("INVALID_TOKEN");
    const peeked = await gateway.peekResetToken(input.token);
    if (peeked === null) throw new RecoveryError("INVALID_TOKEN");

    const user = await store.findUserById(peeked.userId);
    if (user === null || user.email === null || !(await store.hasActiveMembership(user.id))) {
      throw new RecoveryError("INVALID_TOKEN");
    }
    const email = normalizeEmail(user.email);

    const policy = validatePassword({ password: input.password, email });
    if (!policy.ok) throw new RecoveryError(PASSWORD_CODES[policy.error]);

    const currentHash = await store.getPasswordHash(user.id);
    if (currentHash !== null) {
      const same = await gateway.verifyPassword({ hash: currentHash, password: input.password });
      if (same) throw new RecoveryError("SAME_PASSWORD");
    }

    // Link e senha já foram conferidos. Revoga as sessões e zera o bloqueio ANTES de gravar a
    // senha: se isto falhar, nada mudou e o link segue válido para nova tentativa; se a gravação
    // falhar depois, o usuário só perdeu sessões (seguro). Na ordem inversa, uma falha aqui deixava
    // a senha trocada, o link gasto e as sessões antigas vivas (RF03.CA02).
    await store.deleteSessionsExcept(user.id, null);
    await store.updatePasswordState(user.id, { failedAttempts: 0, lockedUntil: null });

    try {
      await gateway.resetPasswordWithToken({ token: input.token, password: input.password });
    } catch (error) {
      if (error instanceof ResetTokenError) throw new RecoveryError("INVALID_TOKEN");
      throw error;
    }

    // De novo, para fechar a janela de uma sessão aberta entre a primeira revogação e a troca.
    await store.deleteSessionsExcept(user.id, null);
    // A senha já foi trocada e o link gasto: se a auditoria falhar, o usuário não vê erro (DD-30).
    await recordAuditSafely(
      "password_reset",
      () =>
        store.recordAudit({
          event: "password_reset",
          userId: user.id,
          emailHash: hashSignupEmail(email),
          ...(input.ip !== undefined ? { ip: input.ip } : {}),
          ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        }),
      deps.onAuditFailure,
    );

    const at = deps.clock.now();
    deps.background.run(() =>
      deps.email.sendSecurityNotice({ to: email, kind: "password-changed", at }),
    );
  };
}
