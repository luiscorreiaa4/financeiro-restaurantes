import {
  type EntryListQuery,
  type EntryListQueryInput,
  entryListQuerySchema,
  resolvePeriod,
} from "@app/core/contracts";

/** Filtros de valor único, na ordem em que aparecem na URL. */
const SCALAR_KEYS = [
  "type",
  "supplierId",
  "paymentMethodId",
  "salesChannelId",
  "createdBy",
  "originChannel",
] as const;
/** Filtros de lista: o parâmetro se repete (`unitIds=a&unitIds=b`). */
const LIST_KEYS = ["unitIds", "categoryIds", "flags"] as const;

type Raw = Record<string, string | string[]>;

/**
 * Lê os filtros da lista de lançamentos da URL (RF22.Obs1). O que não é filtro conhecido é
 * ignorado; valor malformado é descartado sozinho, sem derrubar os demais; período ausente,
 * inválido, invertido ou maior que o limite volta ao mês corrente. `cursor` e `limit` não moram
 * na URL da tela. As datas são texto `AAAA-MM-DD` do começo ao fim (RNF13.R4).
 */
export function parseFilters(params: URLSearchParams, today: string): EntryListQuery {
  const month = resolvePeriod("current_month", today);
  const raw: Raw = {};

  const from = params.get("from");
  const to = params.get("to");
  if (from !== null && to !== null) {
    raw.from = from;
    raw.to = to;
  } else {
    raw.from = month.from;
    raw.to = month.to;
  }
  for (const key of SCALAR_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  for (const key of LIST_KEYS) {
    const values = params.getAll(key);
    if (values.length > 0) raw[key] = values;
  }
  const q = params.get("q");
  if (q !== null && q.trim() !== "") raw.q = q;
  for (const key of ["sort", "dir"] as const) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }

  const first = entryListQuerySchema.safeParse(raw);
  if (first.success) return first.data;

  // Tira só o que o contrato recusou e tenta de novo.
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (key === "from" || key === "to") {
      raw.from = month.from;
      raw.to = month.to;
    } else if (typeof key === "string") {
      delete raw[key];
    }
  }
  const second = entryListQuerySchema.safeParse(raw);
  if (second.success) return second.data;
  return entryListQuerySchema.parse({ from: month.from, to: month.to });
}

function appendFilters(params: URLSearchParams, query: EntryListQueryInput): void {
  params.set("from", query.from);
  params.set("to", query.to);
  for (const key of SCALAR_KEYS) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  for (const key of LIST_KEYS) {
    for (const value of query[key] ?? []) params.append(key, value);
  }
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  if (query.sort !== undefined && query.sort !== "created_at") params.set("sort", query.sort);
  if (query.dir !== undefined && query.dir !== "desc") params.set("dir", query.dir);
}

/** Texto da query string da tela: omite a ordenação padrão e nunca leva `cursor` nem `limit`. */
export function serializeFilters(query: EntryListQueryInput): string {
  const params = new URLSearchParams();
  appendFilters(params, query);
  return params.toString();
}

/** Parâmetros da chamada à API: os filtros mais `cursor` e `limit`, quando informados. */
export function toSearchParams(query: EntryListQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  appendFilters(params, query);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return params;
}
