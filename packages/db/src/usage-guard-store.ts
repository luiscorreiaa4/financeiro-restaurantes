import type { UsageGuardStore } from "@app/core";
import { and, eq, gt, sql } from "drizzle-orm";
import { inboundMessages, outboundMessages } from "../schema";
import { type Database, withTenant } from "./client";

/** Papel `app`, dentro de `withTenant` (regra 2). */
export function createUsageGuardStore(db: Database): UsageGuardStore {
  return {
    async countMessages({ tenantId, userId, userSince, tenantSince }) {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx
          .select({
            userCount: sql<number>`count(*) filter (where ${inboundMessages.userId} = ${userId} and ${inboundMessages.receivedAt} > ${userSince})::int`,
            tenantCount: sql<number>`count(*)::int`,
          })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              gt(inboundMessages.receivedAt, tenantSince),
            ),
          ),
      );
      return { userLastHour: row?.userCount ?? 0, tenantLastDay: row?.tenantCount ?? 0 };
    },

    async hasRecentNotice({ tenantId, toWaId, text, since }) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ id: outboundMessages.id })
          .from(outboundMessages)
          .where(
            and(
              eq(outboundMessages.tenantId, tenantId),
              eq(outboundMessages.toWaId, toWaId),
              eq(outboundMessages.text, text),
              gt(outboundMessages.createdAt, since),
            ),
          )
          .limit(1),
      );
      return rows.length > 0;
    },
  };
}
