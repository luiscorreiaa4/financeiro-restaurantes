import type {
  AdditionalPermission,
  MembershipStatus,
  Role,
  SenderDirectory,
  SenderMembership,
} from "@app/core";
import { eq, inArray } from "drizzle-orm";
import { memberships, membershipUnits, tenants, units, users } from "../schema";
import type { Database } from "./client";

/**
 * Adaptador de `SenderDirectory`. Roda com o papel `app_ingest`, o único que enxerga
 * `users`, `memberships`, `tenants` e `units` de todos os restaurantes (a mensagem ainda não
 * tem tenant). Devolve também os vínculos desativados; quem decide é o `resolveSender`.
 */
export function createSenderDirectory(db: Database): SenderDirectory {
  return {
    async findMemberships(phoneCandidates): Promise<readonly SenderMembership[]> {
      if (phoneCandidates.length === 0) return [];
      const rows = await db
        .select({
          membershipId: memberships.id,
          tenantId: memberships.tenantId,
          tenantName: tenants.name,
          userId: memberships.userId,
          userName: users.name,
          role: memberships.role,
          status: memberships.status,
          allUnits: memberships.allUnits,
          defaultUnitId: memberships.defaultUnitId,
          permissions: memberships.permissions,
          panelAccess: memberships.panelAccess,
          createdAt: memberships.createdAt,
          deactivatedAt: memberships.deactivatedAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(inArray(users.phoneE164, [...phoneCandidates]));
      if (rows.length === 0) return [];

      const tenantIds = [...new Set(rows.map((row) => row.tenantId))];
      const unitRows = await db
        .select({ tenantId: units.tenantId, id: units.id })
        .from(units)
        .where(inArray(units.tenantId, tenantIds));

      const accessRows = await db
        .select({ membershipId: membershipUnits.membershipId, unitId: membershipUnits.unitId })
        .from(membershipUnits)
        .where(
          inArray(
            membershipUnits.membershipId,
            rows.map((row) => row.membershipId),
          ),
        );

      return rows.map((row) => ({
        ...row,
        role: row.role as Role,
        // A data de desativação também vale: o vínculo desativado nunca conta como ativo.
        status: (row.deactivatedAt === null ? row.status : "deactivated") as MembershipStatus,
        permissions: row.permissions as AdditionalPermission[],
        unitIds: accessRows.filter((a) => a.membershipId === row.membershipId).map((a) => a.unitId),
        tenantUnitIds: unitRows.filter((unit) => unit.tenantId === row.tenantId).map((u) => u.id),
      }));
    },
  };
}
