import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

/** Papéis fixos (RF06). DONO, GERENTE, LANCADOR e CONTADOR (DD-03). */
export const ROLES = ["owner", "manager", "staff", "accountant"] as const;
export type Role = (typeof ROLES)[number];

/** Permissões adicionais que o Dono concede (RF05.R7). */
export const ADDITIONAL_PERMISSIONS = [
  "VER_FOLHA",
  "EXPORTAR_DADOS",
  "RECEBER_RESUMO_SEMANAL",
  "CONSULTAR_RELATORIOS_WHATSAPP",
] as const;
export type AdditionalPermission = (typeof ADDITIONAL_PERMISSIONS)[number];

/** Situação do vínculo (RF05.R8): convidado, ativo ou desativado. */
export const MEMBERSHIP_STATUSES = ["invited", "active", "deactivated"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Em quais papéis cada permissão adicional faz sentido (RF05.R7, RF06). */
const PERMISSIONS_BY_ROLE: Record<Role, readonly AdditionalPermission[]> = {
  owner: [],
  manager: ["VER_FOLHA", "EXPORTAR_DADOS", "RECEBER_RESUMO_SEMANAL"],
  staff: ["CONSULTAR_RELATORIOS_WHATSAPP"],
  accountant: [],
};

export type Action =
  | "entry:create"
  | "entry:view"
  | "entry:edit"
  | "entry:delete"
  | "entry:restore"
  | "report:view"
  | "report:whatsapp"
  | "summary:weekly"
  | "panel:access"
  | "export:data"
  | "import:data"
  | "recurring:manage"
  | "user:manage"
  | "user:view"
  | "catalog:manage"
  | "catalog:view"
  | "fiscal:configure"
  | "subscription:manage";

/** Quem age: papel, permissões adicionais, unidades de acesso e liberação do painel. */
export interface Actor {
  readonly role: Role;
  readonly permissions: readonly AdditionalPermission[];
  /** `"all"` = todas as unidades (inclui as futuras); senão, a lista de unidades de acesso. */
  readonly units: "all" | readonly string[];
  /** O Dono liberou o painel (RF05.R3). Só importa ao lançador. */
  readonly panelAccess: boolean;
}

export interface PermissionContext {
  /** Unidade do lançamento ou do pedido. Ausente = ação sem unidade (ex.: lista geral). */
  readonly unitId?: string;
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
  "entry:restore",
];
const ENTRY_WRITES: readonly Action[] = [
  "entry:create",
  "entry:edit",
  "entry:delete",
  "entry:restore",
];

/** Ações por papel, antes das permissões adicionais (seção 2.3 de requisitos.md). */
const GRANTS: Record<Role, readonly Action[]> = {
  owner: [
    ...ENTRY_ACTIONS,
    "report:view",
    "report:whatsapp",
    "summary:weekly",
    "panel:access",
    "export:data",
    "import:data",
    "recurring:manage",
    "user:manage",
    "user:view",
    "catalog:manage",
    "catalog:view",
    "fiscal:configure",
    "subscription:manage",
  ],
  manager: [
    ...ENTRY_ACTIONS,
    "report:view",
    "report:whatsapp",
    "panel:access",
    "import:data",
    "recurring:manage",
    "user:view",
    "catalog:view",
  ],
  // "panel:access" só vale se o Dono liberou (`Actor.panelAccess`).
  staff: [...ENTRY_ACTIONS, "panel:access"],
  accountant: ["entry:view", "report:view", "panel:access", "export:data", "catalog:view"],
};

/** Ações que a permissão adicional libera além do papel. */
const EXTRA_GRANTS: Record<AdditionalPermission, readonly Action[]> = {
  VER_FOLHA: [],
  EXPORTAR_DADOS: ["export:data"],
  RECEBER_RESUMO_SEMANAL: ["summary:weekly"],
  CONSULTAR_RELATORIOS_WHATSAPP: ["report:whatsapp"],
};

/** O lançador só mexe nos próprios lançamentos (RF06). */
const OWN_ONLY_FOR_STAFF: readonly Action[] = [
  "entry:view",
  "entry:edit",
  "entry:delete",
  "entry:restore",
];

/** Ações sobre lançamentos e relatórios limitadas às unidades de acesso (RF06.R5). */
const UNIT_SCOPED: readonly Action[] = [...ENTRY_ACTIONS, "report:view", "report:whatsapp"];

function allowedPermissions(actor: Actor): readonly AdditionalPermission[] {
  const valid = PERMISSIONS_BY_ROLE[actor.role];
  return actor.permissions.filter((permission) => valid.includes(permission));
}

function sensitiveAllowed(actor: Actor, action: Action): boolean {
  if (actor.role === "owner") return true;
  // O contador vê folha sempre (DD-04), mas nunca altera.
  if (actor.role === "accountant") return action === "entry:view";
  return allowedPermissions(actor).includes("VER_FOLHA") && actor.role === "manager";
}

export function can(actor: Actor, action: Action, context: PermissionContext = {}): boolean {
  const permissions = allowedPermissions(actor);
  const granted =
    GRANTS[actor.role].includes(action) ||
    permissions.some((permission) => EXTRA_GRANTS[permission].includes(action));
  if (!granted) return false;

  // O painel do lançador depende de o Dono ter liberado.
  if (action === "panel:access" && actor.role === "staff") return actor.panelAccess;

  if (
    context.unitId !== undefined &&
    UNIT_SCOPED.includes(action) &&
    actor.units !== "all" &&
    !actor.units.includes(context.unitId)
  ) {
    return false;
  }

  if (ENTRY_ACTIONS.includes(action) && context.categoryIsSensitive) {
    if (!sensitiveAllowed(actor, action)) return false;
  }

  if (actor.role === "staff" && OWN_ONLY_FOR_STAFF.includes(action) && context.isOwnEntry !== true)
    return false;

  // Quem só lê nunca escreve, mesmo que uma regra acima tenha liberado.
  if (actor.role === "accountant" && ENTRY_WRITES.includes(action)) return false;

  return true;
}

export type InvalidPermission = Extract<DomainError, { code: "InvalidPermission" }>;

/** Valida as permissões adicionais de um vínculo: só as quatro conhecidas e só nos papéis certos. */
export function validatePermissions(
  role: Role,
  permissions: readonly string[],
): Result<readonly AdditionalPermission[], InvalidPermission> {
  const valid = PERMISSIONS_BY_ROLE[role];
  for (const permission of permissions) {
    if (!valid.includes(permission as AdditionalPermission)) {
      return fail("InvalidPermission", { role, permission });
    }
  }
  return ok(permissions as readonly AdditionalPermission[]);
}

export function authorize(
  actor: Actor,
  action: Action,
  context: PermissionContext = {},
): Result<true, Extract<DomainError, { code: "PermissionDenied" }>> {
  return can(actor, action, context)
    ? ok(true)
    : fail("PermissionDenied", { role: actor.role, action });
}
