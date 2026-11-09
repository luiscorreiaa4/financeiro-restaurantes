import {
  type Clock,
  type CreateCompanyError,
  err,
  LEGAL_VERSIONS,
  type NewCompany,
  ok,
  type Result,
  type SignupFieldErrors,
  TRIAL_DAYS,
  validateSignupInput,
} from "@app/core";
import { hashSignupEmail } from "./signup-hashing";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `valid_from` do imposto é a data de criação neste fuso (F1b, spec). */
const SIGNUP_TIME_ZONE = "America/Sao_Paulo";

export interface CreateCompanyDeps {
  readonly repo: {
    createCompany(company: NewCompany): Promise<Result<{ tenantId: string }, CreateCompanyError>>;
  };
  /** Leitura do celular do usuário da sessão (`users`, já lida pelo `app_auth` desde a 0011). */
  readonly users: { findUserPhone(userId: string): Promise<string | null> };
  readonly clock: Clock;
  readonly newId: () => string;
}

export interface CreateCompanyInput {
  /** Usuário e e-mail da sessão já validada. */
  readonly userId: string;
  readonly email: string;
  /** Corpo: `owner` (só `phone`, opcional), `company`, `unit`, `terms`. */
  readonly form: Record<string, unknown>;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export type CreateCompanyFailure =
  | { readonly kind: "invalid_fields"; readonly fields: SignupFieldErrors }
  | { readonly kind: CreateCompanyError };

export type CreateCompany = (
  input: CreateCompanyInput,
) => Promise<Result<{ tenantId: string }, CreateCompanyFailure>>;

/**
 * `POST /api/companies` ("Criar outra empresa", F1b, RF01): o usuário logado vira Dono de uma
 * empresa nova. O Dono precisa de celular: quem não tem (contador, DD-20) informa no formulário
 * e ele é gravado; quem já tem mantém o seu.
 */
export function createCreateCompany(deps: CreateCompanyDeps): CreateCompany {
  return async (input) => {
    const validated = validateSignupInput(input.form, "existing_user");
    if (!validated.ok) return err({ kind: "invalid_fields", fields: validated.error });
    const form = validated.value;

    const currentPhone = await deps.users.findUserPhone(input.userId);
    if (currentPhone === null && form.owner.phoneE164 === null) {
      return err({ kind: "invalid_fields", fields: { "owner.phone": "phone_required" } });
    }

    const now = deps.clock.now();
    const created = await deps.repo.createCompany({
      input: form,
      userId: input.userId,
      phoneE164ToSet: currentPhone === null ? form.owner.phoneE164 : null,
      ids: { tenantId: deps.newId(), unitId: deps.newId(), membershipId: deps.newId() },
      now,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
      signupDate: deps.clock.today(SIGNUP_TIME_ZONE),
      legal: LEGAL_VERSIONS,
      emailHash: hashSignupEmail(input.email),
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!created.ok) return err({ kind: created.error });
    return ok({ tenantId: created.value.tenantId });
  };
}
