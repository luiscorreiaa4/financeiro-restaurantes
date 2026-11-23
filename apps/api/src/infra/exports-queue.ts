import type { PgBoss } from "pg-boss";
import { DELETE_EXPORT_FILE_QUEUE, GENERATE_EXPORT_QUEUE } from "../modules/exports/queues";

export const GENERATE_EXPORT_DLQ = "generate-export-dlq";
export const DELETE_EXPORT_FILE_DLQ = "delete-export-file-dlq";

const DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60;

export interface ExportQueueConfig {
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  /** Só vale com `retryBackoff`. */
  readonly retryDelayMax?: number;
  readonly expireInSeconds: number;
  readonly retentionSeconds?: number;
}

export interface ExportQueuesConfig {
  readonly generate: ExportQueueConfig;
  readonly delete: ExportQueueConfig;
}

export const EXPORT_QUEUES_CONFIG: ExportQueuesConfig = {
  generate: {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 120,
    // 100 mil linhas em XLSX levam alguns segundos; folga para um worker lento.
    expireInSeconds: 600,
  },
  delete: {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 300,
    // O job fica `created` por 7 dias (startAfter) e `keep_until = start_after + retention` (T2):
    // 8 dias dão 1 dia de folga depois da execução.
    retentionSeconds: 8 * 24 * 60 * 60,
  },
};

/**
 * Cria (se faltar) as filas de exportação e as suas DLQs (DLQ antes da fila) e converge a
 * configuração. `delete-export-file` é `exclusive`: com `singletonKey` = exportId, um reenfileirar
 * (retry do gerador) não duplica o job agendado. Idempotente.
 */
export async function ensureExportQueues(
  boss: PgBoss,
  config: ExportQueuesConfig = EXPORT_QUEUES_CONFIG,
): Promise<void> {
  await boss.createQueue(GENERATE_EXPORT_DLQ, { retentionSeconds: DLQ_RETENTION_SECONDS });
  await boss.createQueue(DELETE_EXPORT_FILE_DLQ, { retentionSeconds: DLQ_RETENTION_SECONDS });
  await boss.createQueue(GENERATE_EXPORT_QUEUE, {
    deadLetter: GENERATE_EXPORT_DLQ,
    ...config.generate,
  });
  await boss.createQueue(DELETE_EXPORT_FILE_QUEUE, {
    policy: "exclusive",
    deadLetter: DELETE_EXPORT_FILE_DLQ,
    ...config.delete,
  });
  await boss.updateQueue(GENERATE_EXPORT_QUEUE, {
    ...config.generate,
    deadLetter: GENERATE_EXPORT_DLQ,
  });
  await boss.updateQueue(DELETE_EXPORT_FILE_QUEUE, {
    ...config.delete,
    deadLetter: DELETE_EXPORT_FILE_DLQ,
  });
}
