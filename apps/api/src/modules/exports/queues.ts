import { z } from "zod";

export const GENERATE_EXPORT_QUEUE = "generate-export";
export const DELETE_EXPORT_FILE_QUEUE = "delete-export-file";

/** Só ids: nada de filtro, conteúdo ou ator (o worker recalcula tudo a partir do pedido). */
export const exportJobSchema = z.object({ tenantId: z.uuid(), exportId: z.uuid() });

export type ExportJob = z.infer<typeof exportJobSchema>;

export interface ExportJobAttempt {
  /** Quantas vezes o job já foi retentado (0 na primeira execução). */
  readonly retryCount: number;
  readonly retryLimit: number;
}

export type ExportJobOutcome = "done" | "skipped";
