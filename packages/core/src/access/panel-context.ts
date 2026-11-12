import {
  ACTIONS,
  type Action,
  type Actor,
  type AdditionalPermission,
  can,
  type Role,
} from "../permissions/permissions";
import { ACCOUNT_STATUSES, type AccountStatus } from "../signup/signup-defaults";

/** Vínculo do usuário com uma empresa, já com as unidades acessíveis e ativas (Tarefa 3). */
export interface PanelMembership {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  accountStatus: AccountStatus;
  role: Role;
  permissions: readonly AdditionalPermission[];
  panelAccess: boolean;
  allUnits: boolean;
  unitIds: readonly string[];
  defaultUnitId: string | null;
  preferredAt: Date | null;
  createdAt: Date;
}

export type UnitChoice = string | "all";

export interface PanelContext {
  membershipId: string;
  tenantId: string;
  unitId: UnitChoice;
  actor: Actor;
  accountStatus: AccountStatus;
}

export type ContextSource = "cookie" | "fallback" | "invalid_cookie";

export type PanelContextResolution =
  | {
      ok: true;
      context: PanelContext;
      source: ContextSource;
      companies: readonly PanelMembership[];
    }
  | { ok: false; reason: "no_access" };

/**
 * Situação da conta (RF37): active lê e escreve; read_only lê; canceled só o dono lê;
 * closed ninguém.
 */
export function accountAllows(
  status: AccountStatus,
  role: Role,
): { read: boolean; write: boolean } {
  switch (status) {
    case "active":
      return { read: true, write: true };
    case "read_only":
      return { read: true, write: false };
    case "canceled":
      return { read: role === "owner", write: false };
    case "closed":
      return { read: false, write: false };
  }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CONTEXT_PATTERN = new RegExp(`^(${UUID})\\.(${UUID}|all)$`);

/** Lê `<tenantId>.<unitId|all>` (cookie ou X-Context). Valor fora do formato vale como ausente. */
export function parseContextValue(
  raw: string | undefined | null,
): { tenantId: string; unitId: UnitChoice } | null {
  if (typeof raw !== "string") return null;
  const match = CONTEXT_PATTERN.exec(raw);
  if (!match) return null;
  return { tenantId: match[1] as string, unitId: match[2] as string };
}

export function formatContextValue(c: { tenantId: string; unitId: UnitChoice }): string {
  return `${c.tenantId}.${c.unitId}`;
}

export function panelActor(m: PanelMembership): Actor {
  return {
    role: m.role,
    permissions: m.permissions,
    units: m.allUnits ? "all" : m.unitIds,
    panelAccess: m.panelAccess,
  };
}

/** O vínculo serve ao painel: conta legível, painel liberado e ao menos uma unidade. */
function servesPanel(m: PanelMembership): boolean {
  if (m.unitIds.length === 0) return false;
  if (!accountAllows(m.accountStatus, m.role).read) return false;
  return can(panelActor(m), "panel:access");
}

/** Ordem do fallback (DE-25): preferred_at desc, nulos por último; createdAt asc; id asc. */
function compareFallback(a: PanelMembership, b: PanelMembership): number {
  if (a.preferredAt && b.preferredAt) {
    const d = b.preferredAt.getTime() - a.preferredAt.getTime();
    if (d !== 0) return d;
  } else if (a.preferredAt) {
    return -1;
  } else if (b.preferredAt) {
    return 1;
  }
  const c = a.createdAt.getTime() - b.createdAt.getTime();
  if (c !== 0) return c;
  return a.membershipId < b.membershipId ? -1 : a.membershipId > b.membershipId ? 1 : 0;
}

function unitIsValid(m: PanelMembership, unitId: UnitChoice): boolean {
  if (unitId === "all") return m.allUnits;
  return m.unitIds.includes(unitId);
}

/** Unidade em que o painel abre ao trocar para esta empresa (a mesma do fallback). */
export function startUnitOf(m: PanelMembership): UnitChoice {
  if (m.allUnits) return "all";
  if (m.defaultUnitId !== null && m.unitIds.includes(m.defaultUnitId)) return m.defaultUnitId;
  return [...m.unitIds].sort()[0] as string;
}

function toContext(m: PanelMembership, unitId: UnitChoice): PanelContext {
  return {
    membershipId: m.membershipId,
    tenantId: m.tenantId,
    unitId,
    actor: panelActor(m),
    accountStatus: m.accountStatus,
  };
}

export function resolvePanelContext(
  memberships: readonly PanelMembership[],
  requested: { tenantId: string; unitId: UnitChoice } | null,
): PanelContextResolution {
  const companies = memberships.filter(servesPanel).sort(compareFallback);
  const first = companies[0];
  if (!first) return { ok: false, reason: "no_access" };

  if (requested) {
    const m = companies.find((c) => c.tenantId === requested.tenantId);
    if (m) {
      if (unitIsValid(m, requested.unitId)) {
        return { ok: true, context: toContext(m, requested.unitId), source: "cookie", companies };
      }
      return {
        ok: true,
        context: toContext(m, startUnitOf(m)),
        source: "invalid_cookie",
        companies,
      };
    }
    return {
      ok: true,
      context: toContext(first, startUnitOf(first)),
      source: "invalid_cookie",
      companies,
    };
  }

  return {
    ok: true,
    context: toContext(first, startUnitOf(first)),
    source: "fallback",
    companies,
  };
}

export type RestrictedReason = "owner_no_unit" | "no_membership";
export type PanelEntry =
  | { kind: "full" }
  | { kind: "restricted"; reason: RestrictedReason }
  | { kind: "refused"; reason: "ask_owner" | "no_access" };

function hasKnownStatus(m: PanelMembership): boolean {
  return (ACCOUNT_STATUSES as readonly string[]).includes(m.accountStatus);
}

/**
 * Entrada no painel (DD-32, DD-33, A4). Única fonte da regra. `memberships`: os de
 * `listPanelMemberships`. `hasAnyActiveMembership`: qualquer papel. Situação desconhecida
 * conta como não ativa.
 */
export function classifyPanelEntry(
  memberships: readonly PanelMembership[],
  hasAnyActiveMembership: boolean,
): PanelEntry {
  const known = memberships.filter(hasKnownStatus);
  if (resolvePanelContext(known, null).ok) return { kind: "full" };
  if (
    known.some((m) => m.role === "owner" && m.accountStatus !== "closed" && m.unitIds.length === 0)
  ) {
    return { kind: "restricted", reason: "owner_no_unit" };
  }
  if (!hasAnyActiveMembership) return { kind: "restricted", reason: "no_membership" };
  if (
    known.some(
      (m) => accountAllows(m.accountStatus, m.role).read && can(panelActor(m), "panel:access"),
    )
  ) {
    return { kind: "refused", reason: "ask_owner" };
  }
  return { kind: "refused", reason: "no_access" };
}

export function canHoldSession(e: PanelEntry): boolean {
  return e.kind === "full" || e.kind === "restricted";
}

export function receivesLoginCode(e: PanelEntry): boolean {
  return canHoldSession(e) || (e.kind === "refused" && e.reason === "ask_owner");
}

/** Valida uma escolha explícita (troca de empresa/unidade). `null` se inválida. */
export function validateContextChoice(
  memberships: readonly PanelMembership[],
  choice: { tenantId: string; unitId: UnitChoice },
): PanelContext | null {
  const m = memberships.filter(servesPanel).find((c) => c.tenantId === choice.tenantId);
  if (!m || !unitIsValid(m, choice.unitId)) return null;
  return toContext(m, choice.unitId);
}

/** Ações liberadas ao ator, sem considerar unidade, na ordem de `ACTIONS`. */
export function allowedActions(actor: Actor): readonly Action[] {
  return ACTIONS.filter((action) => can(actor, action));
}
