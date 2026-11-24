"use client";

import type { UnitSettings } from "@app/core/contracts";
import { useMemo } from "react";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { settingsApi } from "../shared/settings-api";
import { type MembersApi, membersApi } from "./members-api";

export type MembersScope = {
  ctx: { tenantId: string; unitId: string };
  api: MembersApi;
  listUnits: () => Promise<UnitSettings[]>;
  /** Conforto: a API confere `user:manage` (só o dono) e a situação da conta. */
  canManage: boolean;
};

export function useMembersScope(me: FullMe): MembersScope {
  const clients = useMemo(() => {
    const client = browserApi(() => contextHeaderOf(me));
    return { members: membersApi(client), settings: settingsApi(client) };
  }, [me]);
  const { tenantId, unitId, allowedActions, accountStatus } = me.context;
  const canManage = allowedActions.includes("user:manage") && accountStatus === "active";
  return useMemo(
    () => ({
      ctx: { tenantId, unitId },
      api: clients.members,
      listUnits: () => clients.settings.listUnits(),
      canManage,
    }),
    [tenantId, unitId, clients, canManage],
  );
}
