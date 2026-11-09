import type { SignupInput } from "./signup-rules";

/** Por que a gravação da conta foi recusada (unicidade pelo nome da restrição, comprovante). */
export type CreateAccountError = "receipt_invalid" | "cnpj_taken" | "phone_taken" | "email_taken";

/** Tudo que a gravação atômica do autocadastro precisa (porta entre o caso de uso e o banco). */
export interface NewAccount {
  /** Formulário já validado em modo `new_user` (nome e celular presentes). */
  readonly input: SignupInput;
  /** E-mail normalizado, o mesmo do comprovante. */
  readonly email: string;
  /** Hash do comprovante; consumido na mesma transação (uso único). */
  readonly receiptHash: string;
  /** Hash da senha (mecanismo do Better Auth) ou `null` sem senha. */
  readonly passwordHash: string | null;
  /** UUID v7 gerados fora (os das linhas de catálogo são gerados no banco da app, também v7). */
  readonly ids: {
    readonly tenantId: string;
    readonly userId: string;
    readonly unitId: string;
    readonly membershipId: string;
  };
  readonly now: Date;
  readonly trialEndsAt: Date;
  /** Data do cadastro em America/Sao_Paulo ("YYYY-MM-DD"): início de `tax_settings`. */
  readonly signupDate: string;
  readonly legal: { readonly terms: string; readonly privacy: string; readonly dpa: string };
  /** Auditoria guarda o e-mail só em hash (regra 9). */
  readonly emailHash: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

/** Por que a gravação de outra empresa foi recusada (unicidade pelo nome da restrição). */
export type CreateCompanyError = "cnpj_taken" | "phone_taken";

/**
 * Outra empresa para quem já está logado ("Criar outra empresa", F1b): sem usuário, sem conta
 * e sem comprovante. O usuário atual vira o Dono, com `preferred_at = now`.
 */
export interface NewCompany {
  /** Formulário já validado em modo `existing_user`. */
  readonly input: SignupInput;
  /** Usuário da sessão. */
  readonly userId: string;
  /**
   * Celular a gravar em `users.phone_e164` (o usuário não tinha; o Dono precisa de um) ou
   * `null` para não mexer no usuário.
   */
  readonly phoneE164ToSet: string | null;
  readonly ids: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly membershipId: string;
  };
  readonly now: Date;
  readonly trialEndsAt: Date;
  /** Data em America/Sao_Paulo ("YYYY-MM-DD"): início de `tax_settings`. */
  readonly signupDate: string;
  readonly legal: { readonly terms: string; readonly privacy: string; readonly dpa: string };
  /** Auditoria guarda o e-mail só em hash (regra 9). */
  readonly emailHash: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}
