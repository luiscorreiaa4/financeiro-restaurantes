import type { ExportFileStore } from "@app/core";
import type { ExportErrorCode } from "@app/core/contracts";
import { type Database, type ExportRecord, exportsRepo, withTenant } from "@app/db";
import { type ExportFileExt, exportFileKey } from "../../infra/exports/local-export-store";

/** Extensão do arquivo do pedido: a mesma regra de `exportFileName` (COMPLETO em CSV é zip). */
export function exportFileExt(record: Pick<ExportRecord, "format" | "content">): ExportFileExt {
  if (record.format === "xlsx") return "xlsx";
  return record.content === "full" ? "zip" : "csv";
}

/** Marca o pedido como `failed` e audita, na mesma transação. Só o código, nunca a mensagem. */
export async function failExport(
  appDb: Database,
  record: Pick<ExportRecord, "id" | "tenantId" | "requestedBy">,
  code: ExportErrorCode,
): Promise<boolean> {
  return withTenant(appDb, record.tenantId, async (tx) => {
    const marked = await exportsRepo.markFailed(tx, record.id, code);
    if (marked) {
      await exportsRepo.audit(tx, {
        tenantId: record.tenantId,
        actorId: record.requestedBy,
        action: "export_failed",
        exportId: record.id,
        metadata: { errorCode: code },
      });
    }
    return marked;
  });
}

/**
 * Apaga, sem falhar, o arquivo que um `put` anterior pode ter deixado antes da falha terminal
 * (RF29.R5: nada fica além da retenção). A chave é determinística e só tem ids.
 */
export async function discardExportFile(
  store: ExportFileStore,
  record: Pick<ExportRecord, "id" | "tenantId" | "format" | "content">,
): Promise<void> {
  try {
    await store.delete(exportFileKey(record.tenantId, record.id, exportFileExt(record)));
  } catch {
    // Não mascara a falha original.
  }
}
