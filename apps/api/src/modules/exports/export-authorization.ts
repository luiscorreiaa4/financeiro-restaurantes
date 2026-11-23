import { type Actor, can, type EntryScope, entryScopeFor, resolvePanelContext } from "@app/core";
import { type EntryFilters, entryFiltersSchema } from "@app/core/contracts";
import type { ExportRecord, PanelAccessStore } from "@app/db";

export type ExportAuthorization =
  | { ok: true; actor: Actor; scope: EntryScope; filters: EntryFilters }
  | { ok: false; code: "forbidden" | "invalid_filters" };

/**
 * Autorização do pedido, recalculada a partir do vínculo ATUAL de quem pediu (A.8-2): nada do
 * pedido além de tenant, unidade escolhida, conteúdo e filtros vale como autorização. Uma só
 * função para o worker (geração) e para as rotas de link e download (RF06.R3, RF29.R2): o que
 * "pode exportar" na geração tem de continuar valendo enquanto o arquivo existir. Falha fechado:
 * qualquer dúvida é `forbidden`, e quem chama não diz o motivo ao cliente.
 */
export async function authorizeExport(
  access: PanelAccessStore,
  record: ExportRecord,
): Promise<ExportAuthorization> {
  const forbidden = { ok: false, code: "forbidden" } as const;
  const resolution = resolvePanelContext(await access.listPanelMemberships(record.requestedBy), {
    tenantId: record.tenantId,
    unitId: record.unitChoice,
  });
  if (!resolution.ok || resolution.source !== "cookie") return forbidden;
  const { context } = resolution;
  if (context.tenantId !== record.tenantId) return forbidden;
  const { actor } = context;
  if (!can(actor, "export:data")) return forbidden;
  if (record.content === "full" && !can(actor, "export:full")) return forbidden;
  const parsedFilters = entryFiltersSchema.safeParse(record.filters);
  if (!parsedFilters.success) return { ok: false, code: "invalid_filters" };
  const filters = parsedFilters.data;
  try {
    const result = entryScopeFor({
      actor,
      userId: record.requestedBy,
      activeUnitId: record.unitChoice,
      requestedUnitIds: filters.unitIds,
    });
    if (!result.ok) return forbidden;
    return { ok: true, actor, scope: result.value, filters };
  } catch {
    return forbidden;
  }
}

/**
 * Pode entregar o arquivo já pronto? Além da autorização atual, um arquivo gerado COM folha só
 * sai para quem ainda vê folha (RF06.R3): perder VER_FOLHA depois do `ready` fecha o download.
 */
export async function canDeliverExport(
  access: PanelAccessStore,
  record: ExportRecord,
): Promise<boolean> {
  const authorization = await authorizeExport(access, record);
  if (!authorization.ok) return false;
  return !(record.includedSensitive && !authorization.scope.includeSensitive);
}
