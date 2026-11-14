import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "@/lib/api/client";
import { entriesApi } from "./entries-api";

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
