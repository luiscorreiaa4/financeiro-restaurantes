import type { ExportRecord } from "@app/db";
import { exportContentType, exportFileName } from "../../infra/exports/export-writers";
import { exportFileExt } from "./export-failure";

/**
 * Nome e tipo do arquivo para o download. O nome só tem o tipo de conteúdo e as datas do
 * período (nada de filtro de texto, unidade ou empresa); o tipo vem da extensão do pedido.
 */
export function exportDownloadInfo(record: Pick<ExportRecord, "format" | "content" | "filters">): {
  fileName: string;
  contentType: string;
} {
  return {
    fileName: exportFileName(record.content, record.format, record.filters),
    contentType: exportContentType(exportFileExt(record)),
  };
}
