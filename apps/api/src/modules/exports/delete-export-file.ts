import type { ExportFileStore } from "@app/core";
import { type Database, exportsRepo, withTenant } from "@app/db";
import type { JobLogger } from "../../infra/logger";
import { type ExportJobOutcome, exportJobSchema } from "./queues";

/**
 * Apaga o arquivo da exportação depois da retenção (RF29.R5). Idempotente: o segundo job
 * encontra `file_deleted_at` preenchido e devolve `skipped`. A linha do pedido fica (histórico).
 */
export function createDeleteExportFile(deps: {
  appDb: Database;
  store: ExportFileStore;
  logger: JobLogger;
}): (payload: unknown) => Promise<ExportJobOutcome> {
  return async (payload) => {
    const parsed = exportJobSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.error({ issues: parsed.error.issues.length }, "job delete-export-file inválido");
      return "skipped";
    }
    const { tenantId, exportId } = parsed.data;
    return withTenant(deps.appDb, tenantId, async (tx) => {
      const record = await exportsRepo.get(tx, exportId);
      if (record === null || record.tenantId !== tenantId) return "skipped";
      if (record.fileDeletedAt !== null || record.fileKey === null) return "skipped";
      await deps.store.delete(record.fileKey);
      await exportsRepo.markFileDeleted(tx, exportId);
      deps.logger.info({ exportId }, "arquivo da exportação apagado");
      return "done";
    });
  };
}
