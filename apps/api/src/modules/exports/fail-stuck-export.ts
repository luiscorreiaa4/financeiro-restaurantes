import type { ExportFileStore } from "@app/core";
import { type Database, exportsRepo, withTenant } from "@app/db";
import type { JobLogger } from "../../infra/logger";
import { discardExportFile, failExport } from "./export-failure";
import { type ExportJobOutcome, exportJobSchema } from "./queues";

/**
 * Consumidor da DLQ de `generate-export`: o job esgotou as tentativas (por exemplo, expirou com
 * o worker morto) sem passar pelo caso de uso. O pedido que ainda está `queued` ou `generating`
 * vira `failed`/`generation_failed`, com auditoria, e o arquivo órfão é apagado. Idempotente.
 */
export function createFailStuckExport(deps: {
  appDb: Database;
  store: ExportFileStore;
  logger: JobLogger;
}): (payload: unknown) => Promise<ExportJobOutcome> {
  return async (payload) => {
    const parsed = exportJobSchema.safeParse(payload);
    if (!parsed.success) {
      deps.logger.error(
        { issues: parsed.error.issues.length },
        "job na DLQ de exportação inválido",
      );
      return "skipped";
    }
    const { tenantId, exportId } = parsed.data;
    const record = await withTenant(deps.appDb, tenantId, (tx) => exportsRepo.get(tx, exportId));
    if (record === null || record.tenantId !== tenantId) return "skipped";
    if (record.status !== "queued" && record.status !== "generating") return "skipped";
    if (!(await failExport(deps.appDb, record, "generation_failed"))) return "skipped";
    await discardExportFile(deps.store, record);
    deps.logger.warn(
      { exportId, errorCode: "generation_failed" },
      "exportação presa falhou na DLQ",
    );
    return "done";
  };
}
