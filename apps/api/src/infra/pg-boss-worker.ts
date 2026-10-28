import { type ConstructorOptions, type JobResult, PgBoss } from "pg-boss";
import { PROCESS_INBOUND_QUEUE } from "../modules/inbound/ingest-webhook";
import type { ProcessInbound } from "../modules/inbound/process-inbound";
import type { JobLogger } from "./logger";
import {
  ensureProcessInboundQueues,
  PROCESS_INBOUND_QUEUE_CONFIG,
  type ProcessInboundQueueConfig,
} from "./process-inbound-queue";

export interface ProcessInboundWorker {
  /**
   * Encerramento limpo: para de buscar jobs e espera os que estão em andamento terminarem
   * (até `timeout`) antes de fechar a conexão.
   */
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
}

export interface StartWorkerOptions {
  readonly connectionString: string;
  readonly processInbound: ProcessInbound;
  readonly logger: JobLogger;
  readonly onError: (error: Error) => void;
  /** Só os testes mudam isto (retry e expiração rápidos). */
  readonly queueConfig?: ProcessInboundQueueConfig;
  readonly bossOptions?: Omit<ConstructorOptions, "connectionString">;
  readonly batchSize?: number;
  readonly pollingIntervalSeconds?: number;
}

const DEFAULT_STOP_TIMEOUT_MS = 30_000;

/**
 * Worker do pg-boss para `process-inbound`. O handler recebe um lote e responde job a job
 * (`perJobResults`): a falha de uma mensagem não derruba as outras do lote. Roda com o papel
 * administrativo, o único com acesso ao esquema `pgboss`.
 */
export async function startProcessInboundWorker(
  options: StartWorkerOptions,
): Promise<ProcessInboundWorker> {
  const queueConfig = options.queueConfig ?? PROCESS_INBOUND_QUEUE_CONFIG;
  const boss = new PgBoss({ connectionString: options.connectionString, ...options.bossOptions });
  boss.on("error", options.onError);
  await boss.start();
  await ensureProcessInboundQueues(boss, queueConfig);

  await boss.work(
    PROCESS_INBOUND_QUEUE,
    {
      batchSize: options.batchSize ?? 5,
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
      perJobResults: true,
    },
    async (jobs): Promise<JobResult[]> => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        try {
          const outcome = await options.processInbound(job.data, {
            retryCount: job.retryCount,
            retryLimit: queueConfig.retryLimit,
          });
          // Payload fora do contrato não melhora com retry: vai direto para a DLQ.
          results.push({
            id: job.id,
            status: outcome === "invalid_payload" ? "deadletter" : "completed",
          });
        } catch {
          // O caso de uso já registrou o erro; "failed" aplica a política de retry da fila.
          results.push({ id: job.id, status: "failed" });
        }
      }
      return results;
    },
  );
  options.logger.info({ queue: PROCESS_INBOUND_QUEUE }, "worker iniciado");

  return {
    async stop(stopOptions) {
      await boss.stop({
        graceful: stopOptions?.graceful ?? true,
        timeout: stopOptions?.timeout ?? DEFAULT_STOP_TIMEOUT_MS,
        close: true,
      });
    },
  };
}
