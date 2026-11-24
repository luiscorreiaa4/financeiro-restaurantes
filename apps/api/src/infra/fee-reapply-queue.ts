import type { PgBoss } from "pg-boss";
import { FEE_REAPPLY_QUEUE } from "../modules/fee-reapply/queues";

export const FEE_REAPPLY_DLQ = "fee-reapply-dlq";

const DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60;

export interface FeeReapplyQueueConfig {
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  /** Só vale com `retryBackoff`. */
  readonly retryDelayMax?: number;
  readonly expireInSeconds: number;
  readonly retentionSeconds?: number;
}

export const FEE_REAPPLY_QUEUE_CONFIG: FeeReapplyQueueConfig = {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 120,
  // 366 dias de receitas em lotes de 200: minutos, com folga para um worker lento.
  expireInSeconds: 1800,
};

/**
 * Cria (se faltar) a fila `fee-reapply` e a DLQ (DLQ antes da fila) e converge a configuração.
 * Idempotente; chamada pelo servidor (que enfileira) e pelo worker (que consome).
 */
export async function ensureFeeReapplyQueues(
  boss: PgBoss,
  config: FeeReapplyQueueConfig = FEE_REAPPLY_QUEUE_CONFIG,
): Promise<void> {
  await boss.createQueue(FEE_REAPPLY_DLQ, { retentionSeconds: DLQ_RETENTION_SECONDS });
  // `exclusive` + singletonKey = id da linha: reenfileirar (replay da confirmação) não duplica o job.
  await boss.createQueue(FEE_REAPPLY_QUEUE, {
    policy: "exclusive",
    deadLetter: FEE_REAPPLY_DLQ,
    ...config,
  });
  await boss.updateQueue(FEE_REAPPLY_QUEUE, { ...config, deadLetter: FEE_REAPPLY_DLQ });
}
