import type { PgBoss } from "pg-boss";
import { PROCESS_INBOUND_QUEUE } from "../modules/inbound/ingest-webhook";

export const PROCESS_INBOUND_DLQ = "process-inbound-dlq";

/** Duas semanas, o mesmo padrão de retenção do pg-boss. */
const DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60;

export interface ProcessInboundQueueConfig {
  /** Retentativas depois da primeira execução (total de execuções = retryLimit + 1). */
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  /** Só vale com `retryBackoff`: o pg-boss recusa o teto sem backoff. */
  readonly retryDelayMax?: number;
  /** Tempo máximo ativo: um job de um worker que caiu volta para a fila depois disso. */
  readonly expireInSeconds: number;
}

/** Atrasos de 10, 20, 40, 80 e 160 s entre as retentativas, com teto de 300 s. */
export const PROCESS_INBOUND_QUEUE_CONFIG: ProcessInboundQueueConfig = {
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 300,
};

/**
 * Cria (se faltar) a fila `process-inbound` e a sua fila de mensagens mortas, e converge a
 * configuração de uma fila que já existia: a E3 a criou só com `policy: exclusive`, e
 * `createQueue` não altera uma fila existente. Idempotente; servidor e worker chamam ao subir.
 *
 * `exclusive` + `singletonKey` = no máximo um job aguardando ou ativo por `wa_message_id`.
 */
export async function ensureProcessInboundQueues(
  boss: PgBoss,
  config: ProcessInboundQueueConfig = PROCESS_INBOUND_QUEUE_CONFIG,
): Promise<void> {
  await boss.createQueue(PROCESS_INBOUND_DLQ, { retentionSeconds: DLQ_RETENTION_SECONDS });
  await boss.createQueue(PROCESS_INBOUND_QUEUE, {
    policy: "exclusive",
    deadLetter: PROCESS_INBOUND_DLQ,
    ...config,
  });
  await boss.updateQueue(PROCESS_INBOUND_QUEUE, { ...config, deadLetter: PROCESS_INBOUND_DLQ });
}
