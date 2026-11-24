import {
  createAnthropicLlmClient,
  createClaudeCorrectionExtractor,
  createClaudeEntryExtractor,
  createOpenAiTranscriber,
} from "@app/ai";
import type { Env } from "@app/config/env";
import {
  DEFAULT_USAGE_LIMITS,
  type EmailSender,
  type ExportFileStore,
  fail,
  type JobQueue,
  type MediaDownloader,
  type MessageSender,
  type Transcriber,
} from "@app/core";
import {
  createAuthStore,
  createCatalogSettingsRepo,
  createChoiceStore,
  createDatabase,
  createEntryStore,
  createFeeReapplyRepo,
  createInboundIngestRepo,
  createInboundMediaRepo,
  createInboundProcessingRepo,
  createInboundSenderRepo,
  createOutboundMessageRepo,
  createOwnedUnitsStore,
  createPanelAccessStore,
  createPool,
  createSenderDirectory,
  createSignupRepo,
  createSignupStore,
  createTenantConversationRepo,
  createUnitSettingsRepo,
  createUsageGuardStore,
  uuidv7,
} from "@app/db";
import type { AppDeps } from "./app";
import { appOriginOf } from "./http/origin-guard";
import { createBackgroundTasks } from "./infra/auth/background-tasks";
import { createAuth, createAuthGateway } from "./infra/auth/create-auth";
import { createSystemClock } from "./infra/clock";
import { createDevMessageSender } from "./infra/dev-message-sender";
import { createFileEmailSender } from "./infra/email/file-email-sender";
import { createExportLinkSigner } from "./infra/exports/export-link";
import { createLocalExportStore } from "./infra/exports/local-export-store";
import { type ExportWorker, startExportWorker } from "./infra/exports-worker";
import { type FeeReapplyWorker, startFeeReapplyWorker } from "./infra/fee-reapply-worker";
import { createLogger, type JobLogger } from "./infra/logger";
import { createDevFileMediaDownloader } from "./infra/media/dev-file-media-downloader";
import { createFfmpegAudioConverter } from "./infra/media/ffmpeg-audio-converter";
import { createLocalMediaStore } from "./infra/media/local-media-store";
import { createQrReader } from "./infra/media/qr-reader";
import { createPgBossQueue } from "./infra/pg-boss-queue";
import { type ProcessInboundWorker, startProcessInboundWorker } from "./infra/pg-boss-worker";
import { createCheckEntry, createCheckSession } from "./modules/auth/check-session";
import { createEntryHandlers } from "./modules/entries/entry-handlers";
import { createDeleteExportFile } from "./modules/exports/delete-export-file";
import { createFailStuckExport } from "./modules/exports/fail-stuck-export";
import { createGenerateExport } from "./modules/exports/generate-export";
import {
  createFailStuckFeeReapply,
  createRunFeeReapply,
} from "./modules/fee-reapply/run-fee-reapply";
import { createIngestWebhook } from "./modules/inbound/ingest-webhook";
import { createFailureNotifier } from "./modules/inbound/notify-failure";
import { createProcessInbound } from "./modules/inbound/process-inbound";
import { createRouteInbound, defaultHandlers } from "./modules/inbound/route-inbound";
import { createPendingAnswerRouter, createSwitchHandlers } from "./modules/inbound/switch-handlers";
import { createProfileService } from "./modules/profile/profile-service";
import {
  createRecoverPassword,
  createRequestRecoveryLink,
} from "./modules/recovery/recover-password";
import { createCreateAccount } from "./modules/signup/create-account";
import { createCreateCompany } from "./modules/signup/create-company";
import { createRequestSignupCode } from "./modules/signup/request-signup-code";
import { createVerifySignupCode } from "./modules/signup/verify-signup-code";

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
  const auth = composeAuth(env, queue);

  return {
    deps: {
      whatsapp: {
        appSecret: env.WHATSAPP_APP_SECRET,
        verifyToken: env.WHATSAPP_VERIFY_TOKEN,
        ingest: createIngestWebhook({ repo, queue }),
      },
      auth: auth.deps,
      signup: auth.signup,
      recovery: auth.recovery,
      profile: auth.profile,
      panel: auth.panel,
      entries: auth.entries,
      exports: auth.exports,
      settings: auth.settings,
      restricted: auth.restricted,
    },
    async close() {
      await queue.stop();
      await Promise.all([ingestPool.end(), auth.close()]);
    },
  };
}

/**
 * Acesso ao painel (F1a): Better Auth sobre o papel `app_auth`. O autocadastro (F1b) usa a
 * mesma conexão, o mesmo envio de e-mail e a mesma fila em segundo plano.
 */
function composeAuth(
  env: Env,
  queue: JobQueue,
): {
  deps: NonNullable<AppDeps["auth"]>;
  signup: NonNullable<AppDeps["signup"]>;
  recovery: NonNullable<AppDeps["recovery"]>;
  profile: NonNullable<AppDeps["profile"]>;
  panel: NonNullable<AppDeps["panel"]>;
  entries: NonNullable<AppDeps["entries"]>;
  exports: NonNullable<AppDeps["exports"]>;
  settings: NonNullable<AppDeps["settings"]>;
  restricted: NonNullable<AppDeps["restricted"]>;
  close(): Promise<void>;
} {
  if (env.DATABASE_AUTH_URL === undefined) {
    throw new Error("DATABASE_AUTH_URL é obrigatória para o login do painel (papel app_auth)");
  }
  if (env.AUTH_SECRET === undefined) {
    throw new Error("AUTH_SECRET é obrigatória para assinar o cookie de sessão do painel");
  }
  const email = createAuthEmailSender(env);
  const pool = createPool(env.DATABASE_AUTH_URL);
  const clock = createSystemClock();
  const authDb = createDatabase(pool);
  // Painel (F2): dado de tenant pelo papel `app`, sob RLS; os vínculos pelo `app_auth`.
  const appPool = createPool(env.DATABASE_URL);
  const appDb = createDatabase(appPool);
  const panelAccess = createPanelAccessStore(authDb);
  const store = createAuthStore(authDb, clock);
  const signupStore = createSignupStore(authDb, clock);
  // Só o texto fixo das mensagens do Better Auth chega ao log (regra 9).
  const logger = createLogger(env.LOG_LEVEL);
  // Auditoria que falha depois da troca já feita (DD-30): só o evento e o tipo do erro, sem
  // mensagem (o Drizzle põe os parâmetros do SQL nela).
  const onAuditFailure = (event: string, error: unknown) =>
    logger.error(
      { event, errorName: error instanceof Error ? error.name : "unknown" },
      "auditoria falhou depois da troca",
    );
  // Erro no envio do código: só o tipo do erro, sem mensagem (pode ter e-mail).
  // Fila cheia: só a contagem de pendentes, nada da tarefa.
  const background = createBackgroundTasks({
    onError: (error) =>
      logger.error(
        { errorName: error instanceof Error ? error.name : typeof error },
        "falha no envio do código",
      ),
    onDrop: (pending) => logger.warn({ pending }, "envio de código descartado: fila cheia"),
  });
  const auth = createAuth({
    pool,
    store,
    email,
    clock,
    secret: env.AUTH_SECRET,
    baseUrl: env.APP_URL,
    trustedOrigins: [appOriginOf(env.APP_URL)],
    secureCookies: env.NODE_ENV !== "development",
    background,
    log: (level, message) => logger[level]({ component: "better-auth" }, message),
  });
  const gateway = createAuthGateway(auth, { store, clock, background });
  const checkSession = createCheckSession({ gateway, access: store, clock });
  const checkEntry = createCheckEntry({ gateway, access: store, clock });
  const signupRepo = createSignupRepo(authDb);
  const panel: NonNullable<AppDeps["panel"]> = {
    checkSession,
    checkEntry,
    access: panelAccess,
    appDb,
    secure: env.NODE_ENV !== "development",
  };
  return {
    deps: {
      gateway,
      checkSession,
      secure: env.NODE_ENV !== "development",
    },
    signup: {
      secure: env.NODE_ENV !== "development",
      requestCode: createRequestSignupCode({
        store: signupStore,
        users: store,
        audit: store,
        email,
        clock,
        background,
        // Link do aviso de conta existente: da configuração, nunca da requisição.
        loginUrl: new URL("/login", env.APP_URL).toString(),
      }),
      verifyCode: createVerifySignupCode({ store: signupStore, audit: store, clock }),
      createAccount: createCreateAccount({
        repo: signupRepo,
        receipts: signupStore,
        gateway,
        clock,
        newId: uuidv7,
        // Só o tipo do erro (regra 9); a conta já existe e o painel leva ao login.
        onSessionError: (error) =>
          logger.error(
            { errorName: error instanceof Error ? error.name : typeof error },
            "falha ao abrir a sessão do cadastro",
          ),
      }),
      companies: {
        checkEntry,
        createCompany: createCreateCompany({
          repo: signupRepo,
          users: store,
          clock,
          newId: uuidv7,
        }),
      },
    },
    recovery: {
      recover: createRecoverPassword({ store, gateway, email, background, clock, onAuditFailure }),
      requestLink: createRequestRecoveryLink({ gateway }),
    },
    profile: {
      checkSession,
      service: createProfileService({ store, gateway, email, background, clock, onAuditFailure }),
    },
    panel,
    // Lançamentos (F3a, F3b): os mesmos guards e o mesmo banco do painel, mais o relógio, o
    // cadastro e a gravação da edição (o mesmo `EntryStore` do canal, pelo papel `app`).
    entries: { ...panel, clock, store: createEntryStore(appDb), newId: uuidv7 },
    // Configurações (F6a): os mesmos guards e o banco do papel `app`.
    settings: {
      ...panel,
      unitSettings: createUnitSettingsRepo(appDb),
      catalogSettings: createCatalogSettingsRepo(appDb),
      // Reaplicação de taxa: a linha é gravada aqui e o job `fee-reapply` enfileirado depois do commit.
      feeReapply: createFeeReapplyRepo(appDb),
      queue,
      clock,
      newId: uuidv7,
    },
    // Reativar unidade no acesso restrito (F6a): lê pelo `app_auth`, grava pelo `app`.
    restricted: {
      checkEntry,
      ownedUnits: createOwnedUnitsStore(authDb),
      unitSettings: createUnitSettingsRepo(appDb),
    },
    // Exportação (F5): a mesma pasta de arquivos do worker; o link é assinado com o AUTH_SECRET.
    exports: {
      ...panel,
      clock,
      store: createExportFileStore(env),
      queue,
      linkSigner: createExportLinkSigner(env.AUTH_SECRET, clock),
      newId: uuidv7,
    },
    async close() {
      await background.drain();
      await Promise.all([pool.end(), appPool.end()]);
    },
  };
}

/** E-mail do código de acesso. O envio real (domínio, SPF, DKIM) chega na F8. */
export function createAuthEmailSender(env: Pick<Env, "NODE_ENV" | "DEV_MAIL_DIR">): EmailSender {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "sem serviço de e-mail configurado (F8): o envio para arquivo é só de desenvolvimento",
    );
  }
  return createFileEmailSender(env.DEV_MAIL_DIR);
}

/**
 * Composição do worker (`worker.ts`). Dois papéis de banco: `app_ingest` identifica o remetente
 * (a mensagem ainda não tem tenant) e `app` trabalha por tenant com `withTenant`.
 */
export async function composeWorker(
  env: Env,
  logger: JobLogger,
  onQueueError: (error: Error) => void,
): Promise<{
  worker: ProcessInboundWorker;
  exportWorker: ExportWorker;
  feeReapplyWorker: FeeReapplyWorker;
  close(): Promise<void>;
}> {
  if (env.DATABASE_INGEST_URL === undefined) {
    throw new Error("DATABASE_INGEST_URL é obrigatória para o worker do WhatsApp");
  }
  const ingestPool = createPool(env.DATABASE_INGEST_URL);
  const appPool = createPool(env.DATABASE_URL);
  const ingestDb = createDatabase(ingestPool);
  const appDb = createDatabase(appPool);
  if (env.DATABASE_AUTH_URL === undefined) {
    throw new Error("DATABASE_AUTH_URL é obrigatória para o worker de exportação (papel app_auth)");
  }
  // Vínculos do usuário (papel `app_auth`): o worker recalcula o ator ao gerar a exportação.
  const authPool = createPool(env.DATABASE_AUTH_URL);
  if (env.ANTHROPIC_API_KEY === undefined) {
    throw new Error("ANTHROPIC_API_KEY é obrigatória para o worker interpretar as mensagens");
  }

  const clock = createSystemClock();
  const llm = createAnthropicLlmClient(env.ANTHROPIC_API_KEY);
  const models = { default: env.AI_MODEL_DEFAULT, advanced: env.AI_MODEL_ADVANCED };
  const sender = createMessageSender(env, createOutboundMessageRepo(ingestDb));
  const entryStore = createEntryStore(appDb);
  const entryHandlers = createEntryHandlers({
    store: entryStore,
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
  });
  // `trocar unidade` e `trocar empresa` (RF19, DE-25): a lista numerada é respondida sem IA.
  const switchHandlers = createSwitchHandlers({
    choices: createChoiceStore(appDb),
    store: entryStore,
    clock,
    newId: uuidv7,
  });
  const handlers = {
    ...defaultHandlers(logger),
    ...entryHandlers,
    switchUnit: switchHandlers.switchUnit,
    switchTenant: switchHandlers.switchTenant,
    pendingAnswer: createPendingAnswerRouter({
      store: entryStore,
      clock,
      answerChoice: switchHandlers.answerChoice,
      fallback: entryHandlers.pendingAnswer,
      extract: entryHandlers.extract,
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

  const queue = await createPgBossQueue(env.DATABASE_ADMIN_URL, onQueueError);
  const exportStore = createExportFileStore(env);
  const exportWorker = await startExportWorker({
    connectionString: env.DATABASE_ADMIN_URL,
    generateExport: createGenerateExport({
      appDb,
      access: createPanelAccessStore(createDatabase(authPool)),
      store: exportStore,
      queue,
      clock,
      logger,
    }),
    deleteExportFile: createDeleteExportFile({ appDb, store: exportStore, logger }),
    failStuckExport: createFailStuckExport({ appDb, store: exportStore, logger }),
    logger,
    onError: onQueueError,
  });

  const feeReapplyRepo = createFeeReapplyRepo(appDb);
  const feeReapplyWorker = await startFeeReapplyWorker({
    connectionString: env.DATABASE_ADMIN_URL,
    runFeeReapply: createRunFeeReapply({
      repo: feeReapplyRepo,
      store: createEntryStore(appDb),
      access: createPanelAccessStore(createDatabase(authPool)),
      clock,
      logger,
    }),
    failStuck: createFailStuckFeeReapply({ repo: feeReapplyRepo, logger }),
    logger,
    onError: onQueueError,
  });

  return {
    worker,
    exportWorker,
    feeReapplyWorker,
    async close() {
      await Promise.all([worker.stop(), exportWorker.stop(), feeReapplyWorker.stop()]);
      await queue.stop();
      await Promise.all([ingestPool.end(), appPool.end(), authPool.end()]);
    },
  };
}

/**
 * Arquivos das exportações (RF29). Em desenvolvimento, uma pasta local; o S3 chega na E10 e,
 * até lá, a composição de produção recusa subir.
 */
export const DEV_EXPORTS_DIR = ".dev-exports";

function createExportFileStore(env: Pick<Env, "NODE_ENV">): ExportFileStore {
  if (env.NODE_ENV === "production") {
    throw new Error("sem S3 para as exportações (E10): o store local é só de desenvolvimento");
  }
  return createLocalExportStore(DEV_EXPORTS_DIR, env.NODE_ENV);
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
