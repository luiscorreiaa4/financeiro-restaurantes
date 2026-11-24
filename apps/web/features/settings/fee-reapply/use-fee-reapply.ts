"use client";

import type { FeeReapplication } from "@app/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantKey } from "@/lib/query/keys";
import type { SettingsScope } from "../shared/use-settings";

export type ReapplyTarget = { kind: "payment_method" | "sales_channel"; id: string; name: string };

/** Intervalo da consulta enquanto a reaplicação está na fila ou rodando. */
export const REAPPLY_POLL_MS = 3000;

export function isReapplyPending(item: FeeReapplication | null | undefined): boolean {
  return item?.status === "queued" || item?.status === "running";
}

/** Última reaplicação do alvo; refaz a consulta a cada 3 s só enquanto não terminou. */
export function useLatestReapplication(
  scope: SettingsScope,
  target: ReapplyTarget,
  intervalMs = REAPPLY_POLL_MS,
) {
  return useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "fee-reapplications", target.kind, target.id),
    queryFn: () => scope.api.latestReapplication(target.kind, target.id),
    staleTime: 0,
    refetchInterval: (query) => (isReapplyPending(query.state.data) ? intervalMs : false),
  });
}

export function usePreviewReapplication(scope: SettingsScope) {
  return useMutation({ mutationFn: scope.api.previewReapplication });
}

export function useReapply(scope: SettingsScope, target: ReapplyTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scope.api.reapply,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: tenantKey(scope.ctx, "settings", "fee-reapplications", target.kind, target.id),
      }),
  });
}
