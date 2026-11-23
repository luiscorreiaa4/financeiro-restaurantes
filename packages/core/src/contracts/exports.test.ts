import { describe, expect, it } from "vitest";
import {
  EXPORT_LINK_TTL_SECONDS,
  EXPORT_MAX_PENDING,
  EXPORT_MAX_ROWS,
  EXPORT_RETENTION_DAYS,
  exportCreateBodySchema,
  exportItemSchema,
  exportLinkResponseSchema,
  exportListResponseSchema,
} from "./exports";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const body = {
  format: "xlsx",
  content: "entries",
  filters: { from: "2026-11-01", to: "2026-11-30" },
  clientRequestId: ID,
};
const item = {
  id: ID,
  format: "csv",
  content: "full",
  status: "ready",
  rowCount: 10,
  fileSize: 2048,
  errorCode: null,
  filters: { from: "2026-11-01", to: "2026-11-30" },
  createdAt: "2026-11-23T10:00:00Z",
  finishedAt: "2026-11-23T10:00:05Z",
  available: true,
};

describe("contrato de exportação", () => {
  it("fixa as constantes de RF29 e DD-42", () => {
    expect(EXPORT_LINK_TTL_SECONDS).toBe(3600);
    expect(EXPORT_RETENTION_DAYS).toBe(7);
    expect(EXPORT_MAX_ROWS).toBe(100_000);
    expect(EXPORT_MAX_PENDING).toBe(3);
  });

  it("aceita o corpo mínimo do pedido", () => {
    expect(exportCreateBodySchema.safeParse(body).success).toBe(true);
  });

  it("recusa ordenação dentro dos filtros", () => {
    const r = exportCreateBodySchema.safeParse({
      ...body,
      filters: { ...body.filters, sort: "amount" },
    });
    expect(r.success).toBe(false);
  });

  it("recusa formato fora da lista", () => {
    expect(exportCreateBodySchema.safeParse({ ...body, format: "pdf" }).success).toBe(false);
  });

  it("recusa período invertido", () => {
    const r = exportCreateBodySchema.safeParse({
      ...body,
      filters: { from: "2026-11-30", to: "2026-11-01" },
    });
    expect(r.success).toBe(false);
  });

  it("recusa campo extra no corpo", () => {
    expect(exportCreateBodySchema.safeParse({ ...body, extra: 1 }).success).toBe(false);
  });

  it("valida item, lista e link", () => {
    expect(exportItemSchema.safeParse(item).success).toBe(true);
    expect(exportListResponseSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(
      exportLinkResponseSchema.safeParse({
        url: `/api/exports/${ID}/download?t=x`,
        expiresAt: "2026-11-23T11:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      exportLinkResponseSchema.safeParse({ url: "https://x", expiresAt: "2026-11-23T11:00:00Z" })
        .success,
    ).toBe(false);
  });
});
