import type { AccountantInvitePlan } from "@app/core";
import { auditLog, memberships, membershipUnits } from "../schema";
import { type Database, withTenant } from "./client";
import { uuidv7 } from "./uuid";

export interface AccessRepo {
  /**
   * Grava o vínculo do contador e o aceite do aviso de folha na auditoria, numa só transação.
   * `created: false` quando o usuário já tem vínculo nesta empresa (nada é duplicado).
   */
  inviteAccountant(tenantId: string, plan: AccountantInvitePlan): Promise<{ created: boolean }>;
}

/** Adaptador do acesso de colaboradores: papel `app`, sempre dentro de `withTenant` (regra 2). */
export function createAccessRepo(db: Database): AccessRepo {
  return {
    async inviteAccountant(tenantId, plan) {
      return withTenant(db, tenantId, async (tx) => {
        const { membership, audit } = plan;
        const inserted = await tx
          .insert(memberships)
          .values({
            id: uuidv7(),
            tenantId,
            userId: membership.userId,
            role: membership.role,
            status: membership.status,
            allUnits: membership.allUnits,
            defaultUnitId: membership.defaultUnitId,
            panelAccess: membership.panelAccess,
            permissions: membership.permissions,
            invitedBy: membership.invitedBy,
            invitedAt: membership.invitedAt,
          })
          .onConflictDoNothing()
          .returning({ id: memberships.id });
        const created = inserted[0];
        if (created === undefined) return { created: false };

        if (membership.unitIds.length > 0) {
          await tx.insert(membershipUnits).values(
            membership.unitIds.map((unitId) => ({
              id: uuidv7(),
              tenantId,
              membershipId: created.id,
              unitId,
            })),
          );
        }
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId,
          actorId: audit.actorId,
          action: audit.action,
          target: audit.target,
          metadata: audit.metadata,
        });
        return { created: true };
      });
    },
  };
}
