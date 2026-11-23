import {
  type EntryFilters,
  EXPORT_RETENTION_DAYS,
  type ExportContent,
  type ExportErrorCode,
  type ExportFormat,
  type ExportStatus,
} from "@app/core/contracts";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { auditLog, EXPORTS_CLIENT_REQUEST_UNIQUE, exports as exportsTable } from "../schema";
import type { Transaction } from "./client";
import { uuidv7 } from "./uuid";

export { EXPORTS_CLIENT_REQUEST_UNIQUE };

/** Retenção do arquivo (RF29.R5). */
const RETENTION_MS = EXPORT_RETENTION_DAYS * 86_400_000;

export interface ExportRecord {
  id: string;
  tenantId: string;
  requestedBy: string;
  unitChoice: string;
  format: ExportFormat;
  content: ExportContent;
  filters: EntryFilters;
  status: ExportStatus;
  rowCount: number | null;
  fileKey: string | null;
  fileSize: number | null;
  /** Gerado por quem via folha: o link e o download exigem que ainda veja (RF06.R3). */
  includedSensitive: boolean;
  errorCode: ExportErrorCode | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  fileDeletedAt: string | null;
}

export type ExportAuditAction =
  | "export_requested"
  | "export_ready"
  | "export_failed"
  | "export_downloaded";

type Row = typeof exportsTable.$inferSelect;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toRecord(row: Row): ExportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    requestedBy: row.requestedBy,
    unitChoice: row.unitChoice,
    format: row.format as ExportFormat,
    content: row.content as ExportContent,
    filters: row.filters as EntryFilters,
    status: row.status as ExportStatus,
    rowCount: row.rowCount,
    fileKey: row.fileKey,
    fileSize: row.fileSize,
    includedSensitive: row.includedSensitive,
    errorCode: row.errorCode as ExportErrorCode | null,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    fileDeletedAt: iso(row.fileDeletedAt),
  };
}

/** Pronto, com arquivo e criado há menos de 7 dias (estrito: no instante exato já expirou). */
export function isExportAvailable(r: ExportRecord, now: Date): boolean {
  return (
    r.status === "ready" &&
    r.fileDeletedAt === null &&
    new Date(r.createdAt).getTime() > now.getTime() - RETENTION_MS
  );
}

export const exportsRepo = {
  async insert(
    tx: Transaction,
    input: {
      id: string;
      tenantId: string;
      requestedBy: string;
      unitChoice: string;
      format: ExportFormat;
      content: ExportContent;
      filters: EntryFilters;
      clientRequestId: string;
    },
  ): Promise<ExportRecord> {
    const [row] = await tx
      .insert(exportsTable)
      .values({ ...input, status: "queued" })
      .returning();
    if (!row) throw new Error("insert em exports não devolveu a linha");
    return toRecord(row);
  },

  async findByClientRequest(
    tx: Transaction,
    requestedBy: string,
    clientRequestId: string,
  ): Promise<ExportRecord | null> {
    const [row] = await tx
      .select()
      .from(exportsTable)
      .where(
        and(
          eq(exportsTable.requestedBy, requestedBy),
          eq(exportsTable.clientRequestId, clientRequestId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async get(tx: Transaction, id: string): Promise<ExportRecord | null> {
    const [row] = await tx.select().from(exportsTable).where(eq(exportsTable.id, id)).limit(1);
    return row ? toRecord(row) : null;
  },

  async listForUser(tx: Transaction, requestedBy: string, since: Date): Promise<ExportRecord[]> {
    const rows = await tx
      .select()
      .from(exportsTable)
      .where(and(eq(exportsTable.requestedBy, requestedBy), gte(exportsTable.createdAt, since)))
      .orderBy(desc(exportsTable.createdAt), desc(exportsTable.id));
    return rows.map(toRecord);
  },

  async countPending(tx: Transaction, requestedBy: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(exportsTable)
      .where(
        and(
          eq(exportsTable.requestedBy, requestedBy),
          inArray(exportsTable.status, ["queued", "generating"]),
        ),
      );
    return row?.n ?? 0;
  },

  async markGenerating(tx: Transaction, id: string): Promise<boolean> {
    const rows = await tx
      .update(exportsTable)
      .set({ status: "generating", startedAt: sql`now()` })
      .where(and(eq(exportsTable.id, id), eq(exportsTable.status, "queued")))
      .returning({ id: exportsTable.id });
    return rows.length === 1;
  },

  async markReady(
    tx: Transaction,
    id: string,
    result: { fileKey: string; fileSize: number; rowCount: number; includedSensitive: boolean },
  ): Promise<boolean> {
    const rows = await tx
      .update(exportsTable)
      .set({ status: "ready", ...result, finishedAt: sql`now()` })
      .where(and(eq(exportsTable.id, id), eq(exportsTable.status, "generating")))
      .returning({ id: exportsTable.id });
    return rows.length === 1;
  },

  async markFailed(tx: Transaction, id: string, errorCode: ExportErrorCode): Promise<boolean> {
    const rows = await tx
      .update(exportsTable)
      .set({ status: "failed", errorCode, finishedAt: sql`now()` })
      .where(and(eq(exportsTable.id, id), inArray(exportsTable.status, ["queued", "generating"])))
      .returning({ id: exportsTable.id });
    return rows.length === 1;
  },

  async markFileDeleted(tx: Transaction, id: string): Promise<boolean> {
    const rows = await tx
      .update(exportsTable)
      .set({ fileDeletedAt: sql`now()` })
      .where(and(eq(exportsTable.id, id), isNull(exportsTable.fileDeletedAt)))
      .returning({ id: exportsTable.id });
    return rows.length === 1;
  },

  /** `metadata` nunca leva texto livre de busca nem conteúdo do arquivo (quem chama decide o recorte). */
  async audit(
    tx: Transaction,
    input: {
      tenantId: string;
      actorId: string;
      action: ExportAuditAction;
      exportId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.insert(auditLog).values({
      id: uuidv7(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      target: input.exportId,
      metadata: input.metadata,
    });
  },
};
