import type { Env } from "@app/config/env";
import { createDatabase, createInboundIngestRepo, createPool } from "@app/db";
import type { AppDeps } from "./app";
import { createPgBossQueue } from "./infra/pg-boss-queue";
import { createIngestWebhook } from "./modules/inbound/ingest-webhook";

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
