import {
  type BatchPreview,
  batchPreviewSchema,
  type EntryDetail,
  type EntryListQueryInput,
  type EntryListResponse,
  type EntryOptions,
  type EntrySource,
  type EntryStale,
  type EntryTotals,
  type EntryUpdateBodyInput,
  entryDetailSchema,
  entryListResponseSchema,
  entryOptionsSchema,
  entrySourceSchema,
  entryStaleSchema,
  entryTotalsSchema,
  type TrashResponse,
  trashResponseSchema,
} from "@app/core/contracts";
import { type ApiClient, ApiError } from "@/lib/api/client";
import { serializeFilters, toSearchParams } from "./url-filters";

export type EntriesApi = {
  list(query: EntryListQueryInput): Promise<EntryListResponse>;
  /** Totais da consulta inteira, calculados pelo servidor (RF22.Obs2): a tela não soma. */
  totals(query: EntryListQueryInput): Promise<EntryTotals>;
  options(): Promise<EntryOptions>;
  detail(id: string): Promise<EntryDetail>;
  source(id: string): Promise<EntrySource>;
  /** Edição com versão esperada (RF23): 409 `entry_stale` traz o detalhe atual (`isEntryStale`). */
  update(id: string, body: EntryUpdateBodyInput): Promise<EntryDetail>;
  remove(id: string, reason?: string): Promise<EntryDetail>;
  restore(id: string): Promise<EntryDetail>;
  /** Quantidade e soma calculadas no servidor (RF24.Obs3): a tela não soma. */
  batchPreview(ids: readonly string[]): Promise<BatchPreview>;
  batchDelete(ids: readonly string[], reason?: string): Promise<BatchPreview>;
  trash(query: TrashQueryInput): Promise<TrashResponse>;
};

export type TrashQueryInput = {
  deletedFrom: string;
  deletedTo: string;
  unitIds?: readonly string[];
  deletedBy?: string;
  cursor?: string;
  limit?: number;
};

function trashParams(query: TrashQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set("deletedFrom", query.deletedFrom);
  params.set("deletedTo", query.deletedTo);
  for (const id of query.unitIds ?? []) params.append("unitIds", id);
  if (query.deletedBy !== undefined) params.set("deletedBy", query.deletedBy);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return params;
}

/** O detalhe atual do lançamento quando a API recusou a edição por versão antiga (409). */
export function isEntryStale(e: unknown): EntryDetail | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const parsed = entryStaleSchema.safeParse(e.body);
  return parsed.success ? (parsed.data satisfies EntryStale).current : null;
}

/** Leitura de lançamentos (`/api/entries*`). Toda resposta é validada contra o contrato. */
export function entriesApi(client: ApiClient): EntriesApi {
  return {
    list: (query) => client.get(`/api/entries?${toSearchParams(query)}`, entryListResponseSchema),
    totals: (query) =>
      client.get(`/api/entries/totals?${serializeFilters(query)}`, entryTotalsSchema),
    options: () => client.get("/api/entries/options", entryOptionsSchema),
    detail: (id) => client.get(`/api/entries/${encodeURIComponent(id)}`, entryDetailSchema),
    source: (id) => client.get(`/api/entries/${encodeURIComponent(id)}/source`, entrySourceSchema),
    update: (id, body) =>
      client.patch(`/api/entries/${encodeURIComponent(id)}`, body, entryDetailSchema),
    remove: (id, reason) =>
      client.delete(`/api/entries/${encodeURIComponent(id)}`, { reason }, entryDetailSchema),
    restore: (id) =>
      client.post(`/api/entries/${encodeURIComponent(id)}/restore`, {}, entryDetailSchema),
    batchPreview: (ids) => client.post("/api/entries/batch/preview", { ids }, batchPreviewSchema),
    batchDelete: (ids, reason) =>
      client.post("/api/entries/batch/delete", { ids, reason }, batchPreviewSchema),
    trash: (query) => client.get(`/api/trash?${trashParams(query)}`, trashResponseSchema),
  };
}
