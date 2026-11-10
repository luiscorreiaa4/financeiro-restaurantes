import type { AccountStatus, AdditionalPermission, PanelMembership, Role } from "@app/core";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { memberships, membershipUnits, tenants, units } from "../schema";
import type { Database, Transaction } from "./client";

/** Papéis que entram no painel mesmo sem `panel_access` (o Dono libera o painel só ao lançador). */
const PANEL_ROLES = ["owner", "manager", "accountant"];

export interface PanelAccessStore {
  /**
   * Vínculos do usuário que podem servir ao painel (ativos, não desativados, com painel), de todas
   * as empresas, já com as unidades ativas acessíveis. A situação da empresa vem junto: quem decide
   * se ela serve é `resolvePanelContext` (DD-31).
   */
  listPanelMemberships(userId: string): Promise<PanelMembership[]>;
}

/**
 * Lê com o papel `app_auth` (sem `app.tenant_id`): só `memberships`, `membership_units` e as colunas
 * liberadas de `tenants` (id, name, status) e `units` (id, tenant_id, status) na migration 0017.
 */
export async function loadPanelMemberships(
  db: Database,
  userId: string,
): Promise<PanelMembership[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      tenantId: memberships.tenantId,
      tenantName: tenants.name,
      accountStatus: tenants.status,
      role: memberships.role,
      permissions: memberships.permissions,
      panelAccess: memberships.panelAccess,
      allUnits: memberships.allUnits,
      defaultUnitId: memberships.defaultUnitId,
      preferredAt: memberships.preferredAt,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        isNull(memberships.deactivatedAt),
        or(eq(memberships.panelAccess, true), inArray(memberships.role, PANEL_ROLES)),
      ),
    );
  if (rows.length === 0) return [];

  const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
  const activeUnits = await db
    .select({ id: units.id, tenantId: units.tenantId })
    .from(units)
    .where(and(inArray(units.tenantId, tenantIds), eq(units.status, "active")));
  const links = await db
    .select({ membershipId: membershipUnits.membershipId, unitId: membershipUnits.unitId })
    .from(membershipUnits)
    .where(
      inArray(
        membershipUnits.membershipId,
        rows.map((r) => r.membershipId),
      ),
    );

  const activeByTenant = new Map<string, string[]>();
  for (const u of activeUnits) {
    const list = activeByTenant.get(u.tenantId) ?? [];
    list.push(u.id);
    activeByTenant.set(u.tenantId, list);
  }
  const linkedByMembership = new Map<string, Set<string>>();
  for (const l of links) {
    const set = linkedByMembership.get(l.membershipId) ?? new Set<string>();
    set.add(l.unitId);
    linkedByMembership.set(l.membershipId, set);
  }

  return rows.map((r) => {
    const active = activeByTenant.get(r.tenantId) ?? [];
    const linked = linkedByMembership.get(r.membershipId);
    const unitIds = r.allUnits ? active : active.filter((id) => linked?.has(id) === true);
    return {
      membershipId: r.membershipId,
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      accountStatus: r.accountStatus as AccountStatus,
      role: r.role as Role,
      permissions: r.permissions as AdditionalPermission[],
      panelAccess: r.panelAccess,
      allUnits: r.allUnits,
      unitIds,
      defaultUnitId: r.defaultUnitId,
      preferredAt: r.preferredAt,
      createdAt: r.createdAt,
    };
  });
}

export function createPanelAccessStore(db: Database): PanelAccessStore {
  return {
    listPanelMemberships: (userId) => loadPanelMemberships(db, userId),
  };
}

export interface TenantUnitsReader {
  /** Unidades ativas da empresa da transação, por nome. Só leitura; roda dentro de `withTenant`. */
  listActiveUnits(tx: Transaction): Promise<{ id: string; name: string }[]>;
}

export function createTenantUnitsReader(): TenantUnitsReader {
  return {
    async listActiveUnits(tx) {
      return tx
        .select({ id: units.id, name: units.name })
        .from(units)
        .where(eq(units.status, "active"))
        .orderBy(asc(units.name));
    },
  };
}
