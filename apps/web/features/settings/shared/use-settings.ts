"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { tenantKey } from "@/lib/query/keys";
import { type SettingsApi, settingsApi } from "./settings-api";

type TenantCtx = { tenantId: string; unitId: string };

/** Empresa e unidade ativas (para a chave de query), o cliente da API e o que a pessoa pode fazer. */
export type SettingsScope = {
  ctx: TenantCtx;
  api: SettingsApi;
  canManage: boolean;
  /** Editar e mesclar fornecedores (`supplier:manage`: dono e gerente). A API confere de novo. */
  canManageSuppliers: boolean;
};

/** Monta o escopo a partir da sessão. `canManage` é conforto: a API confere `catalog:manage`. */
export function useSettingsScope(me: FullMe): SettingsScope {
  const api = useMemo(() => settingsApi(browserApi(() => contextHeaderOf(me))), [me]);
  const { tenantId, unitId, allowedActions } = me.context;
  const canManage =
    allowedActions.includes("catalog:manage") && me.context.accountStatus === "active";
  const canManageSuppliers =
    allowedActions.includes("supplier:manage") && me.context.accountStatus === "active";
  return useMemo(
    () => ({ ctx: { tenantId, unitId }, api, canManage, canManageSuppliers }),
    [tenantId, unitId, api, canManage, canManageSuppliers],
  );
}

/** Valor que só muda depois de `ms` sem novas mudanças (prévia de taxa a cada 300 ms de pausa). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Líquido de R$ 100,00 calculado pelo servidor. Sem taxa válida, não consulta. */
export function useFeePreview(
  scope: SettingsScope,
  feePercentBp: number | null,
  feeFixedCents: number,
) {
  const bp = useDebounced(feePercentBp);
  const fixed = useDebounced(feeFixedCents);
  return useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "fee-preview", bp, fixed),
    queryFn: () => scope.api.feePreview(bp as number, fixed),
    enabled: bp !== null,
    staleTime: 60_000,
  });
}
