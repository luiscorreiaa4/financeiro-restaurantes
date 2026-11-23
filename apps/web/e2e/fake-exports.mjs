// Exportações da API falsa (F5, RF29, DD-42): espelha /api/exports* à mão, sem a regra de verdade
// (fila, geração e arquivo de verdade ficam na API real). O estado (itens criados) fica em memória e
// volta ao inicial com resetExports(). Sem Math.random e sem Date.now: ids, datas e tamanhos vêm de
// constantes fixas ou do contador do estado. O contrato é packages/core/src/contracts/exports.ts,
// espelhado à mão (este arquivo não importa o TypeScript).
//
// Cada GET /api/exports responde com o estado atual e só depois avança um passo cada item pendente
// (queued → generating → ready). Assim três GET seguidos mostram queued, generating e ready.
// Um corpo com filters.q === "falhar" termina em failed (generation_failed) em vez de ready.

const FAIL_QUERY = "falhar";
const BASE_TIME = "2026-11-23T12:00:00.000Z";
const FINISHED_TIME = "2026-11-23T12:01:00.000Z";
const LINK_EXPIRES_AT = "2026-11-23T13:00:00.000Z";
const ROW_COUNT = 3;
const FILE_SIZE = 412;

const CSV_BODY =
  "﻿" +
  [
    "Data de competência;Tipo;Descrição;Valor bruto",
    "01/10/2026;Despesa;Insumos da semana;1234,56",
    "08/10/2026;Receita;Vendas do salão;980,00",
    "15/10/2026;Despesa;Conta de energia;345,90",
  ].join("\r\n") +
  "\r\n";

// Ids determinísticos e válidos (UUID v4 com variante 8), a partir do contador sequencial.
const exportId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function freshState() {
  return { items: [], byRequestId: new Map(), next: 1 };
}
let state = freshState();

export function resetExports() {
  state = freshState();
}

function toItem(entry) {
  return {
    id: entry.id,
    format: entry.format,
    content: entry.content,
    status: entry.status,
    rowCount: entry.status === "ready" ? ROW_COUNT : null,
    fileSize: entry.status === "ready" ? FILE_SIZE : null,
    errorCode: entry.status === "failed" ? "generation_failed" : null,
    filters: entry.filters,
    createdAt: entry.createdAt,
    finishedAt: entry.status === "ready" || entry.status === "failed" ? FINISHED_TIME : null,
    available: entry.status === "ready",
  };
}

// Avança um passo: queued → generating; generating → ready (ou failed, se o filtro pede falha).
function advance(entry) {
  if (entry.status === "queued") {
    entry.status = "generating";
  } else if (entry.status === "generating") {
    entry.status = entry.filters?.q === FAIL_QUERY ? "failed" : "ready";
  }
}

function create(body) {
  const key = body.clientRequestId;
  if (typeof key === "string" && state.byRequestId.has(key)) {
    return { status: 200, body: toItem(state.byRequestId.get(key)) };
  }
  const n = state.next;
  state.next += 1;
  const entry = {
    id: exportId(n),
    format: body.format === "xlsx" ? "xlsx" : "csv",
    content: body.content === "full" ? "full" : "entries",
    status: "queued",
    filters: body.filters ?? {},
    createdAt: BASE_TIME,
  };
  state.items.push(entry);
  if (typeof key === "string") state.byRequestId.set(key, entry);
  return { status: 202, body: toItem(entry) };
}

function list() {
  // Snapshot primeiro, avanço depois: a resposta mostra o estado de antes deste GET.
  const items = state.items.map(toItem).reverse();
  for (const entry of state.items) advance(entry);
  return { status: 200, body: { items } };
}

function find(id) {
  return state.items.find((entry) => entry.id === id) ?? null;
}

const NOT_FOUND = { status: 404, body: { code: "not_found" } };

// Roteia /api/exports* (GET, POST). Os guards de sessão e de contexto ficam em fake-api.mjs.
// Download devolve `raw` (texto) e `headers`; as demais respostas são JSON em `body`.
export function answerExports(method, url, body) {
  const { pathname } = new URL(url, "http://localhost");
  const input = body && typeof body === "object" ? body : {};

  if (pathname === "/api/exports") {
    if (method === "GET") return list();
    if (method === "POST") return create(input);
    return { status: 404, body: { code: "not_found" } };
  }

  const link = /^\/api\/exports\/([^/]+)\/link$/.exec(pathname);
  if (link && method === "POST") {
    const entry = find(link[1]);
    if (entry?.status !== "ready") return NOT_FOUND;
    return {
      status: 200,
      body: { url: `/api/exports/${entry.id}/download?t=fake`, expiresAt: LINK_EXPIRES_AT },
    };
  }

  const download = /^\/api\/exports\/([^/]+)\/download$/.exec(pathname);
  if (download && method === "GET") {
    const entry = find(download[1]);
    if (entry?.status !== "ready") return NOT_FOUND;
    return {
      status: 200,
      raw: CSV_BODY,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lancamentos_2026-10-01_2026-10-31.csv"',
      },
    };
  }

  return { status: 404, body: { code: "not_found" } };
}
