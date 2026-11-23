import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "@/lib/api/client";
import { exportsApi } from "./exports-api";
import { exportFixture, exportId } from "./exports-test-helpers";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(...responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
  const api = exportsApi(createApiClient({ baseUrl: "", fetch: fetchImpl }));
  return { api, fetchImpl };
}

describe("cliente das rotas de exportação", () => {
  it("a lista chama GET /api/exports e valida a resposta", async () => {
    const item = exportFixture({ status: "ready", rowCount: 3, fileSize: 400, available: true });
    const { api, fetchImpl } = setup(jsonResponse(200, { items: [item] }));
    await expect(api.list()).resolves.toEqual({ items: [item] });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("/api/exports");
  });

  it("criar envia o corpo e aceita o 202 (e o 200 do reenvio)", async () => {
    const body = {
      format: "csv" as const,
      content: "entries" as const,
      filters: { from: "2026-10-01", to: "2026-10-31" },
      clientRequestId: "0193a1b2-0000-4000-8000-0000000000f1",
    };
    const { api, fetchImpl } = setup(
      jsonResponse(202, exportFixture()),
      jsonResponse(200, exportFixture()),
    );
    await expect(api.create(body)).resolves.toEqual(exportFixture());
    await expect(api.create(body)).resolves.toEqual(exportFixture());
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("o link chama POST /api/exports/:id/link", async () => {
    const link = {
      url: `/api/exports/${exportId(1)}/download?t=abc`,
      expiresAt: "2026-11-23T13:00:00.000Z",
    };
    const { api, fetchImpl } = setup(jsonResponse(200, link));
    await expect(api.link(exportId(1))).resolves.toEqual(link);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`/api/exports/${exportId(1)}/link`);
  });

  it("resposta fora do contrato vira ApiError", async () => {
    const { api } = setup(jsonResponse(200, { items: [{ id: "x" }] }));
    await expect(api.list()).rejects.toBeInstanceOf(ApiError);
  });
});
