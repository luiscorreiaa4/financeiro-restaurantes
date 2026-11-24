import {
  type AdditionalPermission,
  type AuditDraft,
  type DomainError,
  ensureActiveOwner,
  type MemberRole,
  type MemberState,
  type MembershipDraft,
  type MembershipStatus,
  maskPhone,
  ok,
  type Result,
} from "@app/core";
import type { MemberSettings } from "@app/core/contracts";
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { auditLog, memberships, membershipUnits, users, whatsappOptIns } from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { uuidv7 } from "./uuid";

/** Quem lê e o que pode ver: gerente só as unidades dele e sem contato (RF05, RF06). */
export interface MemberScope {
  readonly unitIds: readonly string[] | "all";
  /** `true`: e-mail na lista e celular inteiro no `get`. `false`: só os 4 últimos dígitos. */
  readonly includeContact: boolean;
}

export interface MemberFilters {
  /** Parte do nome ou final do celular. */
  readonly search?: string;
  readonly role?: MemberRole;
  readonly unitId?: string;
  readonly status?: MembershipStatus;
}

/** Linha mapeável para `memberSettingsSchema` (sem `userId`, que a rota descarta). */
export type MemberRecord = MemberSettings & { readonly userId: string };

export interface MemberStatusChange {
  readonly id: string;
  readonly status: MembershipStatus;
  readonly deactivatedAt: Date | null;
}

export interface MembersRepo {
  list(tenantId: string, scope: MemberScope, filters: MemberFilters): Promise<MemberRecord[]>;
  /** `null`: inexistente, de outra empresa ou fora do alcance do `scope`. */
  get(tenantId: string, id: string, scope: MemberScope): Promise<MemberRecord | null>;
  /** Vínculo (empresa, usuário) já existente: `created: false`, nada é sobrescrito. */
  insert(
    tenantId: string,
    userId: string,
    plan: { membership: MembershipDraft; audit: AuditDraft },
  ): Promise<{ created: boolean; id: string }>;
  /**
   * Trava os donos e o alvo, lê o estado, chama `step` e, se `ok`, grava o `after` e a auditoria.
   * `null`: alvo inexistente na empresa. `actorId` entra na auditoria.
   */
  update<T extends { after: MemberState; audit: AuditDraft }>(
    tenantId: string,
    id: string,
    step: (before: MemberState, activeOwnerIds: string[]) => Result<T, DomainError>,
    actorId: string,
  ): Promise<Result<T, DomainError> | null>;
  setStatus(
    tenantId: string,
    id: string,
    action: "deactivated" | "reactivate",
    actorId: string,
  ): Promise<Result<MemberStatusChange, DomainError> | null>;
}

type MemberRow = {
  id: string;
  userId: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  role: string;
  allUnits: boolean;
  defaultUnitId: string | null;
  panelAccess: boolean;
  permissions: unknown;
  status: string;
  invitedAt: Date | null;
  deactivatedAt: Date | null;
};

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createMembersRepo(db: Database): MembersRepo {
  const columns = {
    id: memberships.id,
    userId: memberships.userId,
    displayName: sql<string>`coalesce(${memberships.displayName}, ${users.name})`,
    phone: users.phoneE164,
    email: users.email,
    role: memberships.role,
    allUnits: memberships.allUnits,
    defaultUnitId: memberships.defaultUnitId,
    panelAccess: memberships.panelAccess,
    permissions: memberships.permissions,
    status: memberships.status,
    invitedAt: memberships.invitedAt,
    deactivatedAt: memberships.deactivatedAt,
  };

  const hasUnitAccess = (unitIds: readonly string[]): SQL =>
    or(
      eq(memberships.allUnits, true),
      sql`exists (select 1 from ${membershipUnits} mu where mu.membership_id = ${memberships.id} and mu.tenant_id = ${memberships.tenantId} and mu.unit_id in (${sql.join(
        unitIds.map((u) => sql`${u}`),
        sql`, `,
      )}))`,
    ) as SQL;

  async function unitIdsOf(
    tx: Transaction,
    tenantId: string,
    membershipIds: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (membershipIds.length === 0) return map;
    const rows = await tx
      .select({ membershipId: membershipUnits.membershipId, unitId: membershipUnits.unitId })
      .from(membershipUnits)
      .where(
        and(
          eq(membershipUnits.tenantId, tenantId),
          inArray(membershipUnits.membershipId, membershipIds),
        ),
      )
      .orderBy(asc(membershipUnits.unitId));
    for (const row of rows)
      map.set(row.membershipId, [...(map.get(row.membershipId) ?? []), row.unitId]);
    return map;
  }

  function toRecord(
    row: MemberRow,
    unitIds: string[],
    scope: MemberScope,
    withFullPhone: boolean,
  ): MemberRecord {
    const record: MemberRecord = {
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      phoneMasked: row.phone === null ? "" : maskPhone(row.phone),
      role: row.role as MemberRole,
      allUnits: row.allUnits,
      unitIds: row.allUnits ? [] : unitIds,
      defaultUnitId: row.defaultUnitId,
      panelAccess: row.panelAccess,
      permissions: row.permissions as AdditionalPermission[],
      status: row.status as MembershipStatus,
      invitedAt: row.invitedAt === null ? null : row.invitedAt.toISOString(),
      deactivatedAt: row.deactivatedAt === null ? null : row.deactivatedAt.toISOString(),
    };
    if (scope.includeContact) {
      record.email = row.email;
      if (withFullPhone && row.phone !== null) record.phone = row.phone;
    }
    return record;
  }

  async function read(
    tx: Transaction,
    tenantId: string,
    scope: MemberScope,
    where: SQL | undefined,
    withFullPhone: boolean,
  ): Promise<MemberRecord[]> {
    const conditions: (SQL | undefined)[] = [eq(memberships.tenantId, tenantId), where];
    if (scope.unitIds !== "all") {
      if (scope.unitIds.length === 0) return [];
      conditions.push(hasUnitAccess(scope.unitIds));
    }
    const rows = await tx
      .select(columns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(...conditions))
      .orderBy(
        asc(sql`lower(coalesce(${memberships.displayName}, ${users.name}))`),
        asc(memberships.id),
      );
    const units = await unitIdsOf(
      tx,
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toRecord(r, units.get(r.id) ?? [], scope, withFullPhone));
  }

  /** Trava os donos e o alvo em ordem de id e devolve o estado do alvo (ou `null`). */
  async function lockAndLoad(
    tx: Transaction,
    tenantId: string,
    id: string,
  ): Promise<{ state: MemberState; activeOwnerIds: string[]; deactivatedAt: Date | null } | null> {
    const locked = await tx
      .select({ id: memberships.id, role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          or(eq(memberships.role, "owner"), eq(memberships.id, id)),
        ),
      )
      .orderBy(asc(memberships.id))
      .for("update");
    if (!locked.some((r) => r.id === id)) return null;
    const activeOwnerIds = locked
      .filter((r) => r.role === "owner" && r.status === "active")
      .map((r) => r.id);
    const [row] = await tx
      .select(columns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)));
    if (!row) return null;
    const units = await unitIdsOf(tx, tenantId, [id]);
    return {
      activeOwnerIds,
      deactivatedAt: row.deactivatedAt,
      state: {
        id: row.id,
        userId: row.userId,
        displayName: row.displayName,
        phone: row.phone,
        email: row.email,
        role: row.role as MemberRole,
        allUnits: row.allUnits,
        unitIds: row.allUnits ? [] : (units.get(id) ?? []),
        defaultUnitId: row.defaultUnitId,
        panelAccess: row.panelAccess,
        permissions: row.permissions as AdditionalPermission[],
        status: row.status as MembershipStatus,
      },
    };
  }

  async function audit(
    tx: Transaction,
    tenantId: string,
    actorId: string,
    draft: AuditDraft,
    target: string,
  ) {
    await tx.insert(auditLog).values({
      id: uuidv7(),
      tenantId,
      actorId,
      action: draft.action,
      target,
      metadata: draft.metadata as Record<string, unknown>,
    });
  }

  return {
    list(tenantId, scope, filters) {
      return withTenant(db, tenantId, (tx) => {
        const where: SQL[] = [];
        if (filters.role) where.push(eq(memberships.role, filters.role));
        if (filters.status) where.push(eq(memberships.status, filters.status));
        if (filters.unitId) where.push(hasUnitAccess([filters.unitId]));
        const search = filters.search?.trim();
        if (search) {
          const digits = search.replace(/\D/g, "");
          const byName = sql`lower(coalesce(${memberships.displayName}, ${users.name})) like ${`%${escapeLike(search.toLowerCase())}%`}`;
          // Quem não vê o contato só pesquisa pelos 4 últimos dígitos, que já enxerga.
          const phoneOk = digits.length > 0 && (scope.includeContact || digits.length <= 4);
          where.push(
            phoneOk ? (or(byName, sql`${users.phoneE164} like ${`%${digits}`}`) as SQL) : byName,
          );
        }
        return read(tx, tenantId, scope, and(...where), false);
      });
    },

    get(tenantId, id, scope) {
      return withTenant(db, tenantId, async (tx) => {
        const [row] = await read(tx, tenantId, scope, eq(memberships.id, id), true);
        return row ?? null;
      });
    },

    insert(tenantId, userId, plan) {
      return withTenant(db, tenantId, async (tx) => {
        const m = plan.membership;
        const id = uuidv7();
        const [created] = await tx
          .insert(memberships)
          .values({
            id,
            tenantId,
            userId,
            role: m.role,
            allUnits: m.allUnits,
            defaultUnitId: m.defaultUnitId,
            status: m.status,
            permissions: [...m.permissions],
            panelAccess: m.panelAccess,
            displayName: m.displayName,
            invitedBy: m.invitedBy,
            invitedAt: m.invitedAt,
          })
          .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
          .returning({ id: memberships.id });
        if (!created) {
          const [existing] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
          if (!existing) throw new Error("vínculo em conflito não encontrado");
          return { created: false, id: existing.id };
        }
        if (!m.allUnits && m.unitIds.length > 0) {
          await tx
            .insert(membershipUnits)
            .values(
              m.unitIds.map((unitId) => ({ id: uuidv7(), tenantId, membershipId: id, unitId })),
            );
        }
        await audit(tx, tenantId, m.invitedBy, plan.audit, id);
        return { created: true, id };
      });
    },

    update(tenantId, id, step, actorId) {
      return withTenant(db, tenantId, async (tx) => {
        const loaded = await lockAndLoad(tx, tenantId, id);
        if (!loaded) return null;
        const result = step(loaded.state, loaded.activeOwnerIds);
        if (!result.ok) return result;
        const { after, audit: draft } = result.value;
        await tx
          .update(memberships)
          .set({
            displayName: after.displayName,
            role: after.role,
            allUnits: after.allUnits,
            defaultUnitId: after.defaultUnitId,
            panelAccess: after.panelAccess,
            permissions: [...after.permissions],
          })
          .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)));
        await tx
          .delete(membershipUnits)
          .where(and(eq(membershipUnits.tenantId, tenantId), eq(membershipUnits.membershipId, id)));
        if (!after.allUnits && after.unitIds.length > 0) {
          await tx
            .insert(membershipUnits)
            .values(
              after.unitIds.map((unitId) => ({ id: uuidv7(), tenantId, membershipId: id, unitId })),
            );
        }
        await audit(tx, tenantId, actorId, draft, id);
        return result;
      });
    },

    setStatus(tenantId, id, action, actorId) {
      return withTenant(db, tenantId, async (tx) => {
        const loaded = await lockAndLoad(tx, tenantId, id);
        if (!loaded) return null;
        const { state } = loaded;
        let next: MembershipStatus = state.status;
        if (action === "deactivated") {
          const owners = loaded.activeOwnerIds.map((ownerId) => ({
            id: ownerId,
            role: "owner",
            status: "active" as const,
          }));
          const guard = ensureActiveOwner(owners, { membershipId: id, status: "deactivated" });
          if (!guard.ok) return guard;
          next = "deactivated";
        } else if (state.status === "deactivated") {
          const [optIn] = await tx
            .select({ id: whatsappOptIns.id })
            .from(whatsappOptIns)
            .where(
              and(eq(whatsappOptIns.tenantId, tenantId), eq(whatsappOptIns.userId, state.userId)),
            )
            .limit(1);
          next = optIn ? "active" : "invited";
        }
        if (next === state.status) {
          return ok({ id, status: state.status, deactivatedAt: loaded.deactivatedAt });
        }
        const deactivatedAt = next === "deactivated" ? new Date() : null;
        await tx
          .update(memberships)
          .set({ status: next, deactivatedAt })
          .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)));
        await audit(
          tx,
          tenantId,
          actorId,
          {
            action: next === "deactivated" ? "member.deactivate" : "member.reactivate",
            target: id,
            metadata: { before: { status: state.status }, after: { status: next } },
          },
          id,
        );
        return ok({ id, status: next, deactivatedAt });
      });
    },
  };
}
