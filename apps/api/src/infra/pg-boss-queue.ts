import type { JobQueue } from "@app/core";
import { PgBoss } from "pg-boss";
import {
  ensureProcessInboundQueues,
  type ProcessInboundQueueConfig,
} from "./process-inbound-queue";

export interface PgBossQueue extends JobQueue {
  stop(): Promise<void>;
}

/**
 * Adaptador de `JobQueue` sobre o pg-boss, só para enfileirar (quem consome é o worker,
 * `pg-boss-worker.ts`). Conecta com o papel administrativo, único com acesso ao esquema
 * `pgboss`. As filas e a política de retry/DLQ vêm de `ensureProcessInboundQueues`.
 */
export async function createPgBossQueue(
  connectionString: string,
  onError: (error: Error) => void,
  queueConfig?: ProcessInboundQueueConfig,
): Promise<PgBossQueue> {
  const boss = new PgBoss({ connectionString });
  boss.on("error", onError);
  await boss.start();
  await ensureProcessInboundQueues(boss, queueConfig);

  return {
    async enqueue(queue, payload, options) {
      const jobId = await boss.send(queue, payload, {
        ...(options?.singletonKey === undefined ? {} : { singletonKey: options.singletonKey }),
        ...(options?.startAfterSeconds === undefined
          ? {}
          : { startAfter: options.startAfterSeconds }),
      });
      return { jobId };
    },
    async stop() {
      await boss.stop();
    },
  };
}
