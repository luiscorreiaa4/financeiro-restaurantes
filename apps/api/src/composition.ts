import type { Env } from "@app/config/env";
import {
  createDatabase,
  createInboundIngestRepo,
  createInboundProcessingRepo,
  createPool,
} from "@app/db";
import type { AppDeps } from "./app";
import type { JobLogger } from "./infra/logger";
import { createPgBossQueue } from "./infra/pg-boss-queue";
import { type ProcessInboundWorker, startProcessInboundWorker } from "./infra/pg-boss-worker";
import { createIngestWebhook } from "./modules/inbound/ingest-webhook";
import { createProcessInbound, routeNothing } from "./modules/inbound/process-inbound";

export interface Composition {
  readonly deps: AppDeps;
  close(): Promise<void>;
}

/** Única raiz de composição: é aqui que portas e adaptadores se encontram. */
export async function compose(
  env: Env,
  onQueueError: (error: Error) => void,
): Promise<Composition> {
  if (env.DATABASE_INGEST_URL === undefined) {
    throw new Error("DATABASE_INGEST_URL é obrigatória para o webhook do WhatsApp");
  }
  const ingestPool = createPool(env.DATABASE_INGEST_URL);
  const queue = await createPgBossQueue(env.DATABASE_ADMIN_URL, onQueueError);
  const repo = createInboundIngestRepo(createDatabase(ingestPool));

  return {
    deps: {
      whatsapp: {
        appSecret: env.WHATSAPP_APP_SECRET,
        verifyToken: env.WHATSAPP_VERIFY_TOKEN,
        ingest: createIngestWebhook({ repo, queue }),
      },
    },
    async close() {
      await queue.stop();
      await ingestPool.end();
    },
  };
}

/**
 * Composição do worker (`worker.ts`). Na E4 o worker usa o papel `app_ingest`, porque a mensagem
 * ainda não tem tenant; a E5 acrescenta o trabalho por tenant com `withTenant` e o papel `app`.
 */
export async function composeWorker(
  env: Env,
  logger: JobLogger,
  onQueueError: (error: Error) => void,
): Promise<{ worker: ProcessInboundWorker; close(): Promise<void> }> {
  if (env.DATABASE_INGEST_URL === undefined) {
    throw new Error("DATABASE_INGEST_URL é obrigatória para o worker do WhatsApp");
  }
  const ingestPool = createPool(env.DATABASE_INGEST_URL);
  const repo = createInboundProcessingRepo(createDatabase(ingestPool));
  const processInbound = createProcessInbound({ repo, route: routeNothing, logger });

  const worker = await startProcessInboundWorker({
    connectionString: env.DATABASE_ADMIN_URL,
    processInbound,
    logger,
    onError: onQueueError,
  });

  return {
    worker,
    async close() {
      await worker.stop();
      await ingestPool.end();
    },
  };
}
