import { EXPORT_RETENTION_DAYS } from "@app/core/contracts";
import { describe, expect, it } from "vitest";
import { type ExportRecord, isExportAvailable } from "./exports-repo";

const NOW = new Date("2026-11-30T12:00:00.000Z");
const DAY = 86_400_000;
const LIMIT = EXPORT_RETENTION_DAYS * DAY;

function record(over: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: "e1",
    tenantId: "t1",
    requestedBy: "u1",
    unitChoice: "all",
    format: "csv",
    content: "entries",
    filters: {} as ExportRecord["filters"],
    status: "ready",
    rowCount: 1,
    fileKey: "exports/t1/e1.csv",
    fileSize: 10,
    includedSensitive: false,
    errorCode: null,
    createdAt: new Date(NOW.getTime() - DAY).toISOString(),
    startedAt: null,
    finishedAt: null,
    fileDeletedAt: null,
    ...over,
  };
}

describe("isExportAvailable (RF29.R5)", () => {
  it("disponível: pronto, arquivo presente, dentro de 7 dias", () => {
    expect(isExportAvailable(record(), NOW)).toBe(true);
  });
  it("no instante exato do limite não está disponível; 1 ms antes do limite (createdAt = limite - 1 ms) está", () => {
    expect(
      isExportAvailable(record({ createdAt: new Date(NOW.getTime() - LIMIT).toISOString() }), NOW),
    ).toBe(false);
    expect(
      isExportAvailable(
        record({ createdAt: new Date(NOW.getTime() - LIMIT + 1).toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });
  it("1 ms além do limite (createdAt = now - limite - 1 ms) não está disponível", () => {
    expect(
      isExportAvailable(
        record({ createdAt: new Date(NOW.getTime() - LIMIT - 1).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });
  it("não disponível fora de ready ou com arquivo apagado", () => {
    expect(isExportAvailable(record({ status: "generating" }), NOW)).toBe(false);
    expect(isExportAvailable(record({ status: "failed" }), NOW)).toBe(false);
    expect(isExportAvailable(record({ fileDeletedAt: NOW.toISOString() }), NOW)).toBe(false);
  });
});
