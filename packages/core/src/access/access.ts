import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import {
  type AdditionalPermission,
  type MembershipStatus,
  type Role,
  validatePermissions,
} from "../permissions";

export interface AccessInput {
  readonly role: Role;
  readonly allUnits: boolean;
  readonly unitIds: readonly string[];
  readonly defaultUnitId: string | null;
  /** Unidades da empresa, para conferir que nada aponta para outra empresa. */
  readonly tenantUnitIds: readonly string[];
  readonly panelAccess: boolean;
  readonly email: string | null;
  readonly permissions: readonly string[];
}

export interface ValidAccess {
  readonly allUnits: boolean;
  readonly unitIds: readonly string[];
  readonly defaultUnitId: string | null;
  readonly panelAccess: boolean;
  readonly permissions: readonly AdditionalPermission[];
}

/**
 * Confere o vínculo de um colaborador antes de gravar (RF05.R3, R5, R6, R7): unidades de acesso,
 * unidade padrão dentro da lista, e-mail para quem usa o painel e permissões do papel.
 */
export function validateAccess(input: AccessInput): Result<ValidAccess, DomainError> {
  const permissions = validatePermissions(input.role, input.permissions);
  if (!permissions.ok) return permissions;

  // O contador entra sempre pelo painel (RF05.R3) e vê todas as unidades (RF06).
  const panelAccess = input.role === "accountant" ? true : input.panelAccess;
  if (panelAccess && (input.email === null || input.email.trim() === "")) {
    return fail("EmailRequiredForPanel");
  }

  if (input.role === "owner" && !input.allUnits) return fail("OwnerNeedsAllUnits");
  if (input.role === "accountant" && !input.allUnits) return fail("AccountantNeedsAllUnits");

  const inTenant = (unitId: string) => input.tenantUnitIds.includes(unitId);

  if (input.allUnits) {
    if (input.defaultUnitId !== null && !inTenant(input.defaultUnitId)) {
      return fail("UnitOutsideTenant", { unitId: input.defaultUnitId });
    }
    return ok({
      allUnits: true,
      unitIds: [],
      defaultUnitId: input.defaultUnitId,
      panelAccess,
      permissions: permissions.value,
    });
  }

  if (input.unitIds.length === 0) return fail("NoUnitAccess");
  const outside = input.unitIds.find((unitId) => !inTenant(unitId));
  if (outside !== undefined) return fail("UnitOutsideTenant", { unitId: outside });

  const unitIds = [...new Set(input.unitIds)];
  let defaultUnitId = input.defaultUnitId;
  if (defaultUnitId === null) {
    const only = unitIds[0];
    if (unitIds.length !== 1 || only === undefined) return fail("DefaultUnitRequired");
    defaultUnitId = only;
  }
  if (!unitIds.includes(defaultUnitId)) {
    return fail("DefaultUnitOutsideAccess", { unitId: defaultUnitId });
  }
  return ok({
    allUnits: false,
    unitIds,
    defaultUnitId,
    panelAccess,
    permissions: permissions.value,
  });
}

export interface OwnerCheckMember {
  readonly id: string;
  readonly role: string;
  readonly status: MembershipStatus;
}

/**
 * Sempre sobra pelo menos um Dono ativo (RF05.Obs3): rebaixar ou desativar o último é
 * bloqueado, com orientação para promover outro antes.
 */
export function ensureActiveOwner(
  members: readonly OwnerCheckMember[],
  change: {
    readonly membershipId: string;
    readonly role?: Role;
    readonly status?: MembershipStatus;
  },
): Result<true, Extract<DomainError, { code: "LastActiveOwner" }>> {
  const target = members.find((member) => member.id === change.membershipId);
  const isActiveOwner = (role: string, status: MembershipStatus) =>
    role === "owner" && status === "active";
  if (target === undefined || !isActiveOwner(target.role, target.status)) return ok(true);

  const stillOwner = isActiveOwner(change.role ?? target.role, change.status ?? target.status);
  if (stillOwner) return ok(true);

  const others = members.filter(
    (member) => member.id !== change.membershipId && isActiveOwner(member.role, member.status),
  );
  return others.length > 0 ? ok(true) : fail("LastActiveOwner");
}
