import type { JobQueue } from "@app/core";
import { PgBoss } from "pg-boss";
import { PROCESS_INBOUND_QUEUE } from "../modules/inbound/ingest-webhook";

export interface PgBossQueue extends JobQueue {
  stop(): Promise<void>;
}

/**
 * Adaptador mínimo de `JobQueue` sobre o pg-boss (E3: só enfileirar). Conecta com o papel
 * administrativo, único com acesso ao esquema `pgboss`. Workers, retry e DLQ são da E4.
 *
 * `exclusive` + `singletonKey` = no máximo um job aguardando ou ativo por `wa_message_id`.
 */
export async function createPgBossQueue(
  connectionString: string,
  onError: (error: Error) => void,
): Promise<PgBossQueue> {
  const boss = new PgBoss({ connectionString });
  boss.on("error", onError);
  await boss.start();
  await boss.createQueue(PROCESS_INBOUND_QUEUE, { policy: "exclusive" });

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
