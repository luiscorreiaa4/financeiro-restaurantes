import {
  createAnthropicLlmClient,
  createClaudeCorrectionExtractor,
  createClaudeEntryExtractor,
  createOpenAiTranscriber,
} from "@app/ai";
import type { Env } from "@app/config/env";
import {
  DEFAULT_USAGE_LIMITS,
  fail,
  type MediaDownloader,
  type MessageSender,
  type Transcriber,
} from "@app/core";
import {
  createDatabase,
  createEntryStore,
  createInboundIngestRepo,
  createInboundMediaRepo,
  createInboundProcessingRepo,
  createInboundSenderRepo,
  createOutboundMessageRepo,
  createPool,
  createSenderDirectory,
  createTenantConversationRepo,
  createUsageGuardStore,
  uuidv7,
} from "@app/db";
import type { AppDeps } from "./app";
import { createSystemClock } from "./infra/clock";
import { createDevMessageSender } from "./infra/dev-message-sender";
import type { JobLogger } from "./infra/logger";
import { createDevFileMediaDownloader } from "./infra/media/dev-file-media-downloader";
import { createFfmpegAudioConverter } from "./infra/media/ffmpeg-audio-converter";
import { createLocalMediaStore } from "./infra/media/local-media-store";
import { createQrReader } from "./infra/media/qr-reader";
import { createPgBossQueue } from "./infra/pg-boss-queue";
import { type ProcessInboundWorker, startProcessInboundWorker } from "./infra/pg-boss-worker";
import { createEntryHandlers } from "./modules/entries/entry-handlers";
import { createIngestWebhook } from "./modules/inbound/ingest-webhook";
import { createFailureNotifier } from "./modules/inbound/notify-failure";
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
  const appDb = createDatabase(appPool);
  if (env.ANTHROPIC_API_KEY === undefined) {
    throw new Error("ANTHROPIC_API_KEY é obrigatória para o worker interpretar as mensagens");
  }

  const clock = createSystemClock();
  const llm = createAnthropicLlmClient(env.ANTHROPIC_API_KEY);
  const models = { default: env.AI_MODEL_DEFAULT, advanced: env.AI_MODEL_ADVANCED };
  const sender = createMessageSender(env, createOutboundMessageRepo(ingestDb));
  const handlers = {
    ...defaultHandlers(logger),
    ...createEntryHandlers({
      store: createEntryStore(appDb),
      extractor: createClaudeEntryExtractor({ llm, models }),
      correctionExtractor: createClaudeCorrectionExtractor({ llm, models }),
      clock,
      media: {
        downloader: createMediaDownloader(env),
        store: createMediaStore(env),
        inbound: createInboundMediaRepo(ingestDb),
        audioConverter: createFfmpegAudioConverter(),
        transcriber: createTranscriber(env),
        qrReader: createQrReader(),
        limits: DEFAULT_USAGE_LIMITS,
      },
      newId: uuidv7,
      logger,
    }),
  };

  const route = createRouteInbound({
    directory: createSenderDirectory(ingestDb),
    senderRepo: createInboundSenderRepo(ingestDb),
    conversation: createTenantConversationRepo(appDb),
    sender,
    clock,
    handlers,
    supportContact: env.SUPPORT_CONTACT,
    logger,
    usageGuard: { store: createUsageGuardStore(appDb), limits: DEFAULT_USAGE_LIMITS },
  });
  const processInbound = createProcessInbound({
    repo: createInboundProcessingRepo(ingestDb),
    route,
    logger,
    onFinalFailure: createFailureNotifier({
      sender,
      supportContact: env.SUPPORT_CONTACT,
      logger,
    }),
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

/** Mídia recebida: em desenvolvimento lê o arquivo que o chat guardou; no real, baixa da Meta. */
function createMediaDownloader(env: Env): MediaDownloader {
  if (env.CHANNEL_MODE === "whatsapp") {
    throw new Error("CHANNEL_MODE=whatsapp depende do MetaMediaDownloader, ligado na E10");
  }
  return createDevFileMediaDownloader({ directory: env.DEV_MEDIA_DIR, nodeEnv: env.NODE_ENV });
}

/** Guarda a mídia. O S3 (com a regra de ciclo de vida de 90 dias do áudio) chega na E10. */
function createMediaStore(env: Env) {
  if (env.CHANNEL_MODE === "whatsapp") {
    throw new Error("CHANNEL_MODE=whatsapp depende do S3MediaStore, que chega na E10");
  }
  return createLocalMediaStore({ directory: env.DEV_MEDIA_DIR, nodeEnv: env.NODE_ENV });
}

/** Sem chave da OpenAI o áudio falha com erro claro (o job é retentado e depois avisa o usuário). */
function createTranscriber(env: Env): Transcriber {
  if (env.OPENAI_API_KEY === undefined) {
    return { transcribe: async () => fail("MediaUnavailable", { detail: "sem_chave_openai" }) };
  }
  return createOpenAiTranscriber({ apiKey: env.OPENAI_API_KEY, model: env.TRANSCRIPTION_MODEL });
}
