import type { DomainError } from "@app/core";
import type { Database, MemberDirectory, MemberRecord, MembersRepo } from "@app/db";

/** O que os casos de uso de colaboradores precisam da composição. */
export interface MembersDeps {
  readonly appDb: Database;
  readonly members: MembersRepo;
  readonly directory: MemberDirectory;
  /** Número do produto em E.164; `null` quando não configurado (checagem pulada). */
  readonly productPhoneE164: string | null;
  readonly now: () => Date;
}

/** Quem pede: sempre do contexto revalidado, nunca do corpo. */
export interface MembersCaller {
  readonly tenantId: string;
  readonly actorId: string;
}

/** Contato não revela de quem é: o campo é sempre `email` e o motivo é neutro. */
export type ContactIssue =
  | { readonly code: "contact_conflict"; readonly field: "email"; readonly reason: "conflict" }
  | { readonly code: "phone_shared"; readonly field: "phone"; readonly reason: "shared" }
  | { readonly code: "email_shared"; readonly field: "email"; readonly reason: "shared" }
  | { readonly code: "phone_in_use"; readonly field: "phone"; readonly reason: "in_use" };

export const CONTACT_CONFLICT: ContactIssue = {
  code: "contact_conflict",
  field: "email",
  reason: "conflict",
};
export const PHONE_SHARED: ContactIssue = {
  code: "phone_shared",
  field: "phone",
  reason: "shared",
};
export const EMAIL_SHARED: ContactIssue = {
  code: "email_shared",
  field: "email",
  reason: "shared",
};
export const PHONE_IN_USE: ContactIssue = {
  code: "phone_in_use",
  field: "phone",
  reason: "in_use",
};

export type MemberOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "domain"; readonly error: DomainError }
  | { readonly kind: "contact"; readonly issue: ContactIssue }
  | { readonly kind: "already_member" }
  | { readonly kind: "not_found" };

/** Visão do dono, com contato (só o dono escreve). */
export const OWNER_SCOPE = { unitIds: "all", includeContact: true } as const;

/** Violação de unicidade (23505) em qualquer nível da cadeia de causas do driver. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type { MemberRecord };
