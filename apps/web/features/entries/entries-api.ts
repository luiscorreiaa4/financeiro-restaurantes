import {
  type EntryDetail,
  type EntryListQueryInput,
  type EntryListResponse,
  type EntryOptions,
  type EntrySource,
  type EntryTotals,
  entryDetailSchema,
  entryListResponseSchema,
  entryOptionsSchema,
  entrySourceSchema,
  entryTotalsSchema,
} from "@app/core/contracts";
import type { ApiClient } from "@/lib/api/client";
import { serializeFilters, toSearchParams } from "./url-filters";

export type EntriesApi = {
  list(query: EntryListQueryInput): Promise<EntryListResponse>;
  /** Totais da consulta inteira, calculados pelo servidor (RF22.Obs2): a tela não soma. */
  totals(query: EntryListQueryInput): Promise<EntryTotals>;
  options(): Promise<EntryOptions>;
  detail(id: string): Promise<EntryDetail>;
  source(id: string): Promise<EntrySource>;
};

/** Leitura de lançamentos (`/api/entries*`). Toda resposta é validada contra o contrato. */
export function entriesApi(client: ApiClient): EntriesApi {
  return {
    list: (query) => client.get(`/api/entries?${toSearchParams(query)}`, entryListResponseSchema),
    totals: (query) =>
      client.get(`/api/entries/totals?${serializeFilters(query)}`, entryTotalsSchema),
    options: () => client.get("/api/entries/options", entryOptionsSchema),
    detail: (id) => client.get(`/api/entries/${encodeURIComponent(id)}`, entryDetailSchema),
    source: (id) => client.get(`/api/entries/${encodeURIComponent(id)}/source`, entrySourceSchema),
  };
}
