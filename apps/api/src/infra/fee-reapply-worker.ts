import { type ConstructorOptions, type JobResult, PgBoss } from "pg-boss";
import {
  FEE_REAPPLY_QUEUE,
  type FeeReapplyJobAttempt,
  type FeeReapplyJobOutcome,
  feeReapplyJobSchema,
} from "../modules/fee-reapply/queues";
import {
  ensureFeeReapplyQueues,
  FEE_REAPPLY_DLQ,
  FEE_REAPPLY_QUEUE_CONFIG,
  type FeeReapplyQueueConfig,
} from "./fee-reapply-queue";
import type { JobLogger } from "./logger";

export interface FeeReapplyWorker {
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
}

export interface StartFeeReapplyWorkerOptions {
  readonly connectionString: string;
  readonly runFeeReapply: (
    payload: unknown,
    attempt: FeeReapplyJobAttempt,
  ) => Promise<FeeReapplyJobOutcome>;
  /** Consome a DLQ: falha a linha presa (ver `createFailStuckFeeReapply`). */
  readonly failStuck: (payload: unknown) => Promise<FeeReapplyJobOutcome>;
  readonly logger: JobLogger;
  readonly onError: (error: Error) => void;
  /** Só os testes mudam isto. */
  readonly queueConfig?: FeeReapplyQueueConfig;
  readonly bossOptions?: Omit<ConstructorOptions, "connectionString">;
  readonly pollingIntervalSeconds?: number;
}

/** Worker do pg-boss para `fee-reapply`, com o papel administrativo. */
export async function startFeeReapplyWorker(
  options: StartFeeReapplyWorkerOptions,
): Promise<FeeReapplyWorker> {
  const config = options.queueConfig ?? FEE_REAPPLY_QUEUE_CONFIG;
  const boss = new PgBoss({ connectionString: options.connectionString, ...options.bossOptions });
  boss.on("error", options.onError);
  await boss.start();
  await ensureFeeReapplyQueues(boss, config);

  const register = (
    queue: string,
    run: (data: unknown, attempt: FeeReapplyJobAttempt) => Promise<FeeReapplyJobOutcome>,
  ) =>
    boss.work(
      queue,
      {
        batchSize: 1,
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
        perJobResults: true,
      },
      async (jobs): Promise<JobResult[]> => {
        const results: JobResult[] = [];
        for (const job of jobs) {
          // Payload fora do contrato não melhora com retry: vai direto para a DLQ.
          if (!feeReapplyJobSchema.safeParse(job.data).success) {
            results.push({ id: job.id, status: "deadletter" });
            continue;
          }
          try {
            await run(job.data, { retryCount: job.retryCount, retryLimit: config.retryLimit });
            results.push({ id: job.id, status: "completed" });
          } catch {
            // O caso de uso já registrou o erro; "failed" aplica a política de retry da fila.
            results.push({ id: job.id, status: "failed" });
          }
        }
        return results;
      },
    );

  await register(FEE_REAPPLY_QUEUE, options.runFeeReapply);
  // A DLQ não tem DLQ própria: o consumidor é idempotente e só conclui.
  await register(FEE_REAPPLY_DLQ, (data) => options.failStuck(data));
  options.logger.info({ queues: [FEE_REAPPLY_QUEUE] }, "worker de reaplicação de taxa iniciado");

  return {
    async stop(stopOptions) {
      await boss.stop({
        graceful: stopOptions?.graceful ?? true,
        timeout: stopOptions?.timeout ?? 30_000,
        close: true,
      });
    },
  };
}
