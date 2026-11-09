import { randomInt } from "node:crypto";
import { type Clock, decideOtpSend, type EmailSender, normalizeEmail } from "@app/core";
import { hashSecret, hashSignupEmail, SIGNUP_CODE_TTL_MS } from "./signup-hashing";

export interface RequestSignupCodeDeps {
  readonly store: {
    reserveSend(input: {
      email: string;
      ip: string | undefined;
      kind: "code" | "notice";
      codeHash: string | null;
      expiresAt: Date;
      decide(byEmail: { sentAt: Date }[], byIp: { sentAt: Date }[]): boolean;
    }): Promise<boolean>;
  };
  readonly users: { findUserByEmail(email: string): Promise<{ id: string } | null> };
  readonly audit: {
    recordAudit(event: {
      event: "signup_code_sent";
      userId?: string;
      emailHash?: string;
      ip?: string;
      userAgent?: string;
    }): Promise<void>;
  };
  readonly email: EmailSender;
  readonly clock: Clock;
  /** Onde o trabalho roda, depois da resposta (ver `BackgroundTasks` em infra/auth). */
  readonly background: { run(task: () => Promise<void>): void };
  /** Link do aviso de conta existente: vem da URL pública configurada, nunca da requisição. */
  readonly loginUrl: string;
  /** Gerador do código; o padrão é `crypto.randomInt` com 6 dígitos. */
  readonly newCode?: () => string;
}

export interface RequestSignupCodeInput {
  /** Já validado como e-mail; é normalizado aqui de novo por segurança. */
  readonly email: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export type RequestSignupCode = (input: RequestSignupCodeInput) => void;

const sixDigits = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

/**
 * `POST /api/signup/code` (RF01.R10, RF02.R1). Não espera nada: a resposta sai igual e no mesmo
 * tempo para e-mail novo, já cadastrado ou bloqueado por limite. Em segundo plano, e-mail novo
 * recebe o código (`email-verification`) e e-mail com usuário (qualquer vínculo) recebe o aviso
 * de conta existente (`account-exists`), que grava uma linha `notice` para a verificação
 * responder igual a um código errado. Limites de `decideOtpSend` valem para os dois.
 */
export function createRequestSignupCode(deps: RequestSignupCodeDeps): RequestSignupCode {
  const newCode = deps.newCode ?? sixDigits;

  async function send(input: RequestSignupCodeInput): Promise<void> {
    const email = normalizeEmail(input.email);
    const user = await deps.users.findUserByEmail(email);
    const now = deps.clock.now();
    const code = user === null ? newCode() : null;
    const reserved = await deps.store.reserveSend({
      email,
      ip: input.ip,
      kind: code === null ? "notice" : "code",
      codeHash: code === null ? null : hashSecret(code),
      expiresAt: new Date(now.getTime() + SIGNUP_CODE_TTL_MS),
      decide: (byEmail, byIp) => decideOtpSend(byEmail, byIp, now).allowed,
    });
    if (!reserved) return;
    await deps.audit.recordAudit({
      event: "signup_code_sent",
      ...(user === null ? {} : { userId: user.id }),
      emailHash: hashSignupEmail(email),
      ...(input.ip === undefined ? {} : { ip: input.ip }),
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
    });
    if (code === null) {
      await deps.email.sendAccessCode({
        to: email,
        purpose: "account-exists",
        loginUrl: deps.loginUrl,
      });
    } else {
      await deps.email.sendAccessCode({ to: email, code, purpose: "email-verification" });
    }
  }

  return (input) => deps.background.run(() => send(input));
}
