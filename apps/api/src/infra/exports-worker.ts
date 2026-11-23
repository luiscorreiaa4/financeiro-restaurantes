import { type ConstructorOptions, type JobResult, PgBoss } from "pg-boss";
import {
  DELETE_EXPORT_FILE_QUEUE,
  type ExportJobAttempt,
  type ExportJobOutcome,
  exportJobSchema,
  GENERATE_EXPORT_QUEUE,
} from "../modules/exports/queues";
import {
  EXPORT_QUEUES_CONFIG,
  type ExportQueuesConfig,
  ensureExportQueues,
  GENERATE_EXPORT_DLQ,
} from "./exports-queue";
import type { JobLogger } from "./logger";

export interface ExportWorker {
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
}

export interface StartExportWorkerOptions {
  readonly connectionString: string;
  readonly generateExport: (
    payload: unknown,
    attempt: ExportJobAttempt,
  ) => Promise<ExportJobOutcome>;
  readonly deleteExportFile: (payload: unknown) => Promise<ExportJobOutcome>;
  /** Consome a DLQ de `generate-export`: falha o pedido preso (ver `createFailStuckExport`). */
  readonly failStuckExport: (payload: unknown) => Promise<ExportJobOutcome>;
  readonly logger: JobLogger;
  readonly onError: (error: Error) => void;
  /** Só os testes mudam isto. */
  readonly queuesConfig?: ExportQueuesConfig;
  readonly bossOptions?: Omit<ConstructorOptions, "connectionString">;
  readonly pollingIntervalSeconds?: number;
}

/** Worker do pg-boss para `generate-export` e `delete-export-file`, com o papel administrativo. */
export async function startExportWorker(options: StartExportWorkerOptions): Promise<ExportWorker> {
  const config = options.queuesConfig ?? EXPORT_QUEUES_CONFIG;
  const boss = new PgBoss({ connectionString: options.connectionString, ...options.bossOptions });
  boss.on("error", options.onError);
  await boss.start();
  await ensureExportQueues(boss, config);

  const register = (
    queue: string,
    retryLimit: number,
    run: (data: unknown, attempt: ExportJobAttempt) => Promise<ExportJobOutcome>,
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
          if (!exportJobSchema.safeParse(job.data).success) {
            results.push({ id: job.id, status: "deadletter" });
            continue;
          }
          try {
            await run(job.data, { retryCount: job.retryCount, retryLimit });
            results.push({ id: job.id, status: "completed" });
          } catch {
            // O caso de uso já registrou o erro; "failed" aplica a política de retry da fila.
            results.push({ id: job.id, status: "failed" });
          }
        }
        return results;
      },
    );

  await register(GENERATE_EXPORT_QUEUE, config.generate.retryLimit, options.generateExport);
  await register(DELETE_EXPORT_FILE_QUEUE, config.delete.retryLimit, (data) =>
    options.deleteExportFile(data),
  );
  // A DLQ de generate-export não tem DLQ própria: o consumidor é idempotente e só conclui.
  await register(GENERATE_EXPORT_DLQ, config.generate.retryLimit, (data) =>
    options.failStuckExport(data),
  );
  options.logger.info(
    { queues: [GENERATE_EXPORT_QUEUE, DELETE_EXPORT_FILE_QUEUE] },
    "worker de exportação iniciado",
  );

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
