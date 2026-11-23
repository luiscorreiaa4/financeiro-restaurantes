"use client";

import type { ExportCreateBody, ExportItem } from "@app/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { tenantKey } from "@/lib/query/keys";
import { type ExportsApi, exportsApi } from "./exports-api";

type TenantCtx = { tenantId: string; unitId: string };

/** Empresa e unidade ativas (para a chave de query) e o cliente da API de exportações. */
export type ExportsScope = { ctx: TenantCtx; api: ExportsApi };

/** Intervalo da consulta enquanto algum pedido está na fila ou sendo gerado. */
export const EXPORTS_POLL_MS = 3000;

export function isExportPending(item: ExportItem): boolean {
  return item.status === "queued" || item.status === "generating";
}

/** Monta o escopo a partir da sessão: a casca e as telas de exportação usam o mesmo. */
export function useExportsScope(me: FullMe): ExportsScope {
  const api = useMemo(() => exportsApi(browserApi(() => contextHeaderOf(me))), [me]);
  const { tenantId, unitId } = me.context;
  return useMemo(() => ({ ctx: { tenantId, unitId }, api }), [tenantId, unitId, api]);
}

/**
 * Pedidos dos últimos 7 dias do próprio usuário. Com `poll`, refaz a consulta a cada 3 s, mas só
 * enquanto houver pedido `queued` ou `generating`: sem pendente, não há consulta repetida.
 */
export function useExports(
  scope: ExportsScope,
  options: { poll: boolean /** Só os testes trocam o intervalo de 3 s. */; intervalMs?: number },
) {
  return useQuery({
    queryKey: tenantKey(scope.ctx, "exports"),
    queryFn: () => scope.api.list(),
    // O dado muda por fora (o worker), então não vale o staleTime de 60 s padrão.
    staleTime: 0,
    refetchInterval: options.poll
      ? (query) =>
          query.state.data?.items.some(isExportPending)
            ? (options.intervalMs ?? EXPORTS_POLL_MS)
            : false
      : false,
  });
}

/** Cria o pedido; ao terminar, invalida a lista, o que acorda o aviso da casca. */
export function useCreateExport(scope: ExportsScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ExportCreateBody) => scope.api.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(scope.ctx, "exports") }),
  });
}

function assignLocation(url: string): void {
  window.location.assign(url);
}

/**
 * Pede o link de 1 hora (RF29.R5) e leva o navegador até ele: o arquivo vem da API, que confere
 * sessão e autor; a tela nunca guarda a URL (cada clique pede um link novo).
 */
export function useDownloadExport(
  scope: ExportsScope,
  navigate: (url: string) => void = assignLocation,
) {
  return useMutation({
    mutationFn: async (id: string) => {
      const link = await scope.api.link(id);
      navigate(link.url);
      return link;
    },
  });
}
