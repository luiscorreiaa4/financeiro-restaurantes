"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tenantKey } from "@/lib/query/keys";
import type { SettingsScope } from "./use-settings";

/** Mutação de cadastro: ao terminar, a lista (`settings`, `kind`) é buscada de novo. */
export function useCatalogMutation<TBody, TResult>(
  scope: SettingsScope,
  kind: string,
  run: (body: TBody) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tenantKey(scope.ctx, "settings", kind) }),
  });
}
