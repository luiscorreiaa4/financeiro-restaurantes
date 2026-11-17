import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "@/lib/api/client";
import { entriesApi, isAlreadySubmitted, isEntryStale } from "./entries-api";
import { detailFixture } from "./entries-test-helpers";

const ENTRY_ID = "0193a1b2-0000-7000-8000-000000000001";
const UNIT = "0193a1b2-0000-7000-8000-00000000000a";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(...responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
  const api = entriesApi(createApiClient({ baseUrl: "", fetch: fetchImpl }));
  const calledUrl = (index: number) => String(fetchImpl.mock.calls[index]?.[0]);
  return { api, calledUrl };
}

describe("cliente das rotas de lançamentos", () => {
  it("a lista leva filtros, ordenação, cursor e limite na query string", async () => {
    const { api, calledUrl } = setup(jsonResponse(200, { items: [], nextCursor: null }));
    const page = await api.list({
      from: "2026-10-01",
      to: "2026-10-31",
      unitIds: [UNIT],
      sort: "amount",
      dir: "asc",
      cursor: "abc",
      limit: 20,
    });
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(calledUrl(0)).toBe(
      `/api/entries?from=2026-10-01&to=2026-10-31&unitIds=${UNIT}&sort=amount&dir=asc&cursor=abc&limit=20`,
    );
  });

  it("os totais levam os mesmos filtros, sem cursor nem limite", async () => {
    const totals = {
      revenueCents: 100000,
      expenseCents: 45000,
      resultCents: 55000,
      count: 3,
      hasRestricted: true,
    };
    const { api, calledUrl } = setup(jsonResponse(200, totals));
    expect(
      await api.totals({ from: "2026-10-01", to: "2026-10-31", q: "450,00", cursor: "abc" }),
    ).toEqual(totals);
    expect(calledUrl(0)).toBe("/api/entries/totals?from=2026-10-01&to=2026-10-31&q=450%2C00");
  });

  it("opções, detalhe e origem chamam as rotas certas", async () => {
    const options = {
      categories: [],
      suppliers: [],
      paymentMethods: [],
      salesChannels: [],
      units: [],
      members: [],
    };
    const source = {
      channel: "whatsapp",
      kind: "text",
      text: "paguei 450 de gás",
      transcription: null,
      accessKey: null,
      sentBy: null,
      sentAt: null,
      restricted: false,
      mediaAvailable: false,
    };
    const { api, calledUrl } = setup(
      jsonResponse(200, options),
      jsonResponse(404, { code: "not_found" }),
      jsonResponse(200, source),
    );
    expect(await api.options()).toEqual(options);
    await expect(api.detail(ENTRY_ID)).rejects.toMatchObject({ status: 404 });
    expect(await api.source(ENTRY_ID)).toEqual(source);
    expect(calledUrl(0)).toBe("/api/entries/options");
    expect(calledUrl(1)).toBe(`/api/entries/${ENTRY_ID}`);
    expect(calledUrl(2)).toBe(`/api/entries/${ENTRY_ID}/source`);
  });

  it("resposta fora do contrato vira erro, nunca dado sem validar", async () => {
    // Valor com centavos fracionados: dinheiro é sempre inteiro (RNF13.R1).
    const { api } = setup(
      jsonResponse(200, {
        revenueCents: 10.5,
        expenseCents: 0,
        resultCents: 10.5,
        count: 1,
        hasRestricted: false,
      }),
    );
    await expect(api.totals({ from: "2026-10-01", to: "2026-10-31" })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("cliente de escrita de lançamentos", () => {
  const detail = detailFixture({ id: ENTRY_ID });

  function call(index: number, fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
    const [url, init] = fetchImpl.mock.calls[index] ?? [];
    return { url: String(url), init: init as RequestInit | undefined };
  }

  function writeSetup(...responses: Response[]) {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
    const api = entriesApi(createApiClient({ baseUrl: "", fetch: fetchImpl }));
    return { api, fetchImpl };
  }

  it("update envia PATCH com a versão esperada e o que mudou", async () => {
    const { api, fetchImpl } = writeSetup(jsonResponse(200, detail));
    await api.update(ENTRY_ID, {
      expectedVersion: 1,
      patch: { description: "Gás" },
      markReviewed: false,
    });
    const { url, init } = call(0, fetchImpl);
    expect(url).toBe(`/api/entries/${ENTRY_ID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedVersion: 1,
      patch: { description: "Gás" },
      markReviewed: false,
    });
  });

  it("remove envia DELETE com o motivo; restore e lote chamam as rotas certas", async () => {
    const { api, fetchImpl } = writeSetup(
      jsonResponse(200, detail),
      jsonResponse(200, detail),
      jsonResponse(200, { count: 2, totalCents: 90000 }),
      jsonResponse(200, { count: 2, totalCents: 90000 }),
    );
    await api.remove(ENTRY_ID, "duplicado");
    await api.restore(ENTRY_ID);
    expect(await api.batchPreview([ENTRY_ID, UNIT])).toEqual({ count: 2, totalCents: 90000 });
    expect(await api.batchDelete([ENTRY_ID, UNIT], "erro")).toEqual({
      count: 2,
      totalCents: 90000,
    });
    expect(call(0, fetchImpl).url).toBe(`/api/entries/${ENTRY_ID}`);
    expect(call(0, fetchImpl).init?.method).toBe("DELETE");
    expect(JSON.parse(String(call(0, fetchImpl).init?.body))).toEqual({ reason: "duplicado" });
    expect(call(1, fetchImpl).url).toBe(`/api/entries/${ENTRY_ID}/restore`);
    expect(call(1, fetchImpl).init?.method).toBe("POST");
    expect(call(2, fetchImpl).url).toBe("/api/entries/batch/preview");
    expect(JSON.parse(String(call(2, fetchImpl).init?.body))).toEqual({ ids: [ENTRY_ID, UNIT] });
    expect(call(3, fetchImpl).url).toBe("/api/entries/batch/delete");
    expect(JSON.parse(String(call(3, fetchImpl).init?.body))).toEqual({
      ids: [ENTRY_ID, UNIT],
      reason: "erro",
    });
  });

  it("trash leva período, unidade, autor e cursor na query", async () => {
    const { api, fetchImpl } = writeSetup(jsonResponse(200, { items: [], nextCursor: null }));
    await api.trash({
      deletedFrom: "2026-10-01",
      deletedTo: "2026-10-31",
      unitIds: [UNIT],
      deletedBy: ENTRY_ID,
      cursor: "abc",
    });
    expect(call(0, fetchImpl).url).toBe(
      `/api/trash?deletedFrom=2026-10-01&deletedTo=2026-10-31&unitIds=${UNIT}&deletedBy=${ENTRY_ID}&cursor=abc`,
    );
  });

  it("isEntryStale devolve o detalhe atual só no 409 entry_stale", async () => {
    const { api } = writeSetup(
      jsonResponse(409, { code: "entry_stale", current: detail }),
      jsonResponse(409, { code: "context_changed" }),
    );
    const stale = await api
      .update(ENTRY_ID, { expectedVersion: 1, patch: { description: "x" }, markReviewed: false })
      .catch((e: unknown) => e);
    expect(isEntryStale(stale)?.id).toBe(ENTRY_ID);
    const other = await api
      .update(ENTRY_ID, { expectedVersion: 1, patch: { description: "x" }, markReviewed: false })
      .catch((e: unknown) => e);
    expect(isEntryStale(other)).toBeNull();
    expect(isEntryStale(new Error("x"))).toBeNull();
  });

  const createBody = {
    clientRequestId: "0193a1b2-0000-7000-8000-0000000000ee",
    type: "expense" as const,
    occurredOn: "2026-11-03",
    description: "Gás",
    amountCents: 45000,
    categoryId: "0193a1b2-0000-7000-8000-0000000000cc",
    unitId: UNIT,
  };

  it("create envia POST com a chave da tentativa e valida o detalhe devolvido", async () => {
    const { api, fetchImpl } = writeSetup(jsonResponse(201, detail));
    const created = await api.create(createBody);
    expect(created.id).toBe(ENTRY_ID);
    const { url, init } = call(0, fetchImpl);
    expect(url).toBe("/api/entries");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(createBody);
  });

  it("isAlreadySubmitted reconhece só o 409 already_submitted (e não o context_changed)", async () => {
    const { api } = writeSetup(
      jsonResponse(409, { code: "already_submitted" }),
      jsonResponse(409, { code: "context_changed" }),
    );
    const submitted = await api.create(createBody).catch((e: unknown) => e);
    expect(isAlreadySubmitted(submitted)).toBe(true);
    const other = await api.create(createBody).catch((e: unknown) => e);
    expect(isAlreadySubmitted(other)).toBe(false);
    expect(isAlreadySubmitted(new Error("x"))).toBe(false);
  });

  it("create com resposta fora do contrato vira ApiError", async () => {
    const { api } = writeSetup(jsonResponse(201, { id: "x" }));
    await expect(api.create(createBody)).rejects.toBeInstanceOf(ApiError);
  });

  it("resposta de escrita fora do contrato vira ApiError", async () => {
    const { api } = writeSetup(jsonResponse(200, { count: 1.5, totalCents: 10 }));
    await expect(api.batchPreview([ENTRY_ID])).rejects.toBeInstanceOf(ApiError);
  });
});
