import type { Env } from "@app/config/env";
import type { MessageSender } from "@app/core";
import {
  createDatabase,
  createInboundIngestRepo,
  createInboundProcessingRepo,
  createInboundSenderRepo,
  createOutboundMessageRepo,
  createPool,
  createSenderDirectory,
  createTenantConversationRepo,
} from "@app/db";
import type { AppDeps } from "./app";
import { createDevMessageSender } from "./infra/dev-message-sender";
import type { JobLogger } from "./infra/logger";
import { createPgBossQueue } from "./infra/pg-boss-queue";
import { type ProcessInboundWorker, startProcessInboundWorker } from "./infra/pg-boss-worker";
import { createIngestWebhook } from "./modules/inbound/ingest-webhook";
import { createProcessInbound } from "./modules/inbound/process-inbound";
import { createRouteInbound, defaultHandlers } from "./modules/inbound/route-inbound";

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
 * Composição do worker (`worker.ts`). Dois papéis de banco: `app_ingest` identifica o remetente
 * (a mensagem ainda não tem tenant) e `app` trabalha por tenant com `withTenant`.
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
  const appPool = createPool(env.DATABASE_URL);
  const ingestDb = createDatabase(ingestPool);

  const route = createRouteInbound({
    directory: createSenderDirectory(ingestDb),
    senderRepo: createInboundSenderRepo(ingestDb),
    conversation: createTenantConversationRepo(createDatabase(appPool)),
    sender: createMessageSender(env, createOutboundMessageRepo(ingestDb)),
    clock: { now: () => new Date() },
    handlers: defaultHandlers(logger),
    supportContact: env.SUPPORT_CONTACT,
    logger,
  });
  const processInbound = createProcessInbound({
    repo: createInboundProcessingRepo(ingestDb),
    route,
    logger,
  });

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
      await Promise.all([ingestPool.end(), appPool.end()]);
    },
  };
}

/** `CHANNEL_MODE` escolhe o adaptador de envio; o resto do código não sabe a diferença. */
function createMessageSender(
  env: Env,
  outbound: ReturnType<typeof createOutboundMessageRepo>,
): MessageSender {
  if (env.CHANNEL_MODE === "whatsapp") {
    throw new Error("CHANNEL_MODE=whatsapp depende do CloudMessageSender, que chega na E10");
  }
  return createDevMessageSender({ repo: outbound, nodeEnv: env.NODE_ENV });
}
