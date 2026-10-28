import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

export const ROLES = ["owner", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "entry:create"
  | "entry:view"
  | "entry:edit"
  | "entry:delete"
  | "report:view"
  | "export:data"
  | "user:manage";

export interface PermissionContext {
  /** O lançamento em questão foi criado pelo próprio usuário. */
  readonly isOwnEntry?: boolean;
  /** A categoria do lançamento é sensível (folha de pagamento). */
  readonly categoryIsSensitive?: boolean;
}

const ENTRY_ACTIONS: readonly Action[] = [
  "entry:create",
  "entry:view",
  "entry:edit",
  "entry:delete",
];

/**
 * - owner: tudo, inclusive categorias sensíveis, usuários e exportação.
 * - manager: lança, vê, edita e apaga qualquer lançamento e vê relatórios; não vê
 *   categorias sensíveis, não gerencia usuários, não exporta.
 * - staff: lança e vê/edita/desfaz só os próprios lançamentos; sem relatórios.
 * Categoria sensível: só o owner age sobre lançamentos dela (inclusive criar).
 */
const GRANTS: Record<Role, readonly Action[]> = {
  owner: [...ENTRY_ACTIONS, "report:view", "export:data", "user:manage"],
  manager: [...ENTRY_ACTIONS, "report:view"],
  staff: ENTRY_ACTIONS,
};

const OWN_ONLY: Record<Role, readonly Action[]> = {
  owner: [],
  manager: [],
  staff: ["entry:view", "entry:edit", "entry:delete"],
};

export function can(role: Role, action: Action, context: PermissionContext = {}): boolean {
  if (!GRANTS[role].includes(action)) return false;
  if (context.categoryIsSensitive && role !== "owner" && ENTRY_ACTIONS.includes(action)) {
    return false;
  }
  if (OWN_ONLY[role].includes(action) && context.isOwnEntry !== true) return false;
  return true;
}

export function authorize(
  role: Role,
  action: Action,
  context: PermissionContext = {},
): Result<true, Extract<DomainError, { code: "PermissionDenied" }>> {
  return can(role, action, context) ? ok(true) : fail("PermissionDenied", { role, action });
}
