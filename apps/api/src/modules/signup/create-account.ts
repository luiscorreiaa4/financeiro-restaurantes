import {
  type Clock,
  type CreateAccountError,
  err,
  LEGAL_VERSIONS,
  type NewAccount,
  normalizeEmail,
  ok,
  type Result,
  type SignupFieldErrors,
  TRIAL_DAYS,
  validateSignupInput,
} from "@app/core";
import { hashSecret, hashSignupEmail } from "./signup-hashing";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `valid_from` do imposto é a data do cadastro neste fuso (F1b, spec). */
const SIGNUP_TIME_ZONE = "America/Sao_Paulo";

export interface CreateAccountDeps {
  readonly repo: {
    createAccount(
      account: NewAccount,
    ): Promise<Result<{ tenantId: string; userId: string }, CreateAccountError>>;
  };
  /** Conferência barata do comprovante, antes do scrypt (rota pública). */
  readonly receipts: {
    isReceiptLive(input: { email: string; receiptHash: string; now: Date }): Promise<boolean>;
  };
  readonly gateway: {
    hashPassword(password: string): Promise<string>;
    openSession(input: { userId: string; ip?: string; userAgent?: string }): Promise<string[]>;
  };
  readonly clock: Clock;
  readonly newId: () => string;
  /** Falha ao abrir a sessão depois do commit: a conta existe, o painel manda ao login. */
  readonly onSessionError?: (error: unknown) => void;
}

export interface CreateAccountInput {
  readonly receipt: string;
  /** E-mail do comprovante; o corpo não pode trocar (Foco 4). */
  readonly email: string;
  /** Resto do corpo: `owner`, `company`, `unit`, `terms`. */
  readonly form: Record<string, unknown>;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export type CreateAccountFailure =
  | { readonly kind: "invalid_fields"; readonly fields: SignupFieldErrors }
  | { readonly kind: CreateAccountError };

export type CreateAccount = (
  input: CreateAccountInput,
) => Promise<Result<{ tenantId: string; setCookies: string[] }, CreateAccountFailure>>;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * `POST /api/signup` (RF01, F1b). Valida antes de tocar no comprovante (erro de formulário não o
 * gasta), confere o comprovante só lendo (antes do scrypt da senha); depois grava tudo numa transação que consome o comprovante, e só então abre a sessão
 * sem "manter conectado" (RF01.Obs2).
 */
export function createCreateAccount(deps: CreateAccountDeps): CreateAccount {
  return async (input) => {
    const email = normalizeEmail(input.email);
    const owner = asRecord(input.form.owner);
    // O e-mail do comprovante entra no formulário só para a regra "senha diferente do e-mail".
    const validated = validateSignupInput(
      { ...input.form, owner: { ...owner, email } },
      "new_user",
    );
    if (!validated.ok) return err({ kind: "invalid_fields", fields: validated.error });
    const form = validated.value;

    const now = deps.clock.now();
    const receiptHash = hashSecret(input.receipt);
    // Antes do hash de senha (scrypt, caro): comprovante falso não pode gastar CPU. O uso único
    // de verdade é o `consumeReceipt` dentro da transação.
    if (!(await deps.receipts.isReceiptLive({ email, receiptHash, now }))) {
      return err({ kind: "receipt_invalid" });
    }
    const passwordHash =
      form.owner.password === null ? null : await deps.gateway.hashPassword(form.owner.password);
    const created = await deps.repo.createAccount({
      input: form,
      email,
      receiptHash,
      passwordHash,
      ids: {
        tenantId: deps.newId(),
        userId: deps.newId(),
        unitId: deps.newId(),
        membershipId: deps.newId(),
      },
      now,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
      signupDate: deps.clock.today(SIGNUP_TIME_ZONE),
      legal: LEGAL_VERSIONS,
      emailHash: hashSignupEmail(email),
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!created.ok) return err({ kind: created.error });

    let setCookies: string[] = [];
    try {
      setCookies = await deps.gateway.openSession({
        userId: created.value.userId,
        ...(input.ip === undefined ? {} : { ip: input.ip }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      });
    } catch (error) {
      deps.onSessionError?.(error);
    }
    return ok({ tenantId: created.value.tenantId, setCookies });
  };
}
