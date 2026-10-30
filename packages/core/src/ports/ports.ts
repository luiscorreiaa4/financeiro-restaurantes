import type { OutboundPurpose, ReplyTarget, SenderMembership } from "../conversation";
import type {
  BusinessDate,
  CatalogSnapshot,
  CorrectionResult,
  Entry,
  EntryChange,
  ExtractionResult,
  RecentEntry,
} from "../entry";
import type { DomainError, Result } from "../errors";

/** Só tipos: as implementações vivem nos adaptadores (apps/api, packages/*). */

type ErrorOf<C extends DomainError["code"]> = Extract<DomainError, { code: C }>;

/** De onde veio a resposta, para guardá-la ligada à mensagem e ao tenant (correção por reply). */
export interface OutboundTrace {
  /** Nulo quando o remetente é desconhecido. */
  readonly tenantId: string | null;
  readonly inboundMessageId: string;
  readonly purpose: OutboundPurpose;
}

export interface MessageSender {
  /**
   * `to` em E.164 canônico (com o 9º dígito). `replyTo` é o wa_message_id citado. `trace` é
   * ignorado pelo envio real e usado pelo adaptador de desenvolvimento, que grava a resposta.
   */
  sendText(input: {
    to: string;
    text: string;
    replyTo?: string;
    trace?: OutboundTrace;
  }): Promise<Result<{ waMessageId: string }, ErrorOf<"SendFailed">>>;
  markAsRead(waMessageId: string): Promise<Result<true, ErrorOf<"SendFailed">>>;
  showTyping(waMessageId: string): Promise<Result<true, ErrorOf<"SendFailed">>>;
}

export interface TenantExtractionContext {
  readonly categories: readonly string[];
  readonly suppliers: readonly string[];
  readonly units: readonly string[];
  readonly paymentMethods: readonly string[];
}

export interface AiUsageRecord {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly audioSeconds: number;
  /** Custo estimado em micro-dólares (inteiro). */
  readonly costUsdMicros: number;
}

export interface EntryExtractor {
  extract(input: {
    text?: string;
    image?: { bytes: Uint8Array; contentType: string };
    context: TenantExtractionContext;
    today: BusinessDate;
    /** Chamado a cada chamada ao modelo, mesmo quando a extração falha (RNF08: todo uso é medido). */
    onUsage?: (usage: AiUsageRecord) => void;
  }): Promise<
    Result<
      /** Um registro por chamada ao modelo (inclui nova tentativa e escalada para o Sonnet). */
      { result: ExtractionResult; usage: readonly AiUsageRecord[] },
      ErrorOf<"ExtractionInvalid" | "LlmRefused">
    >
  >;
}

export interface CorrectionExtractor {
  extract(input: {
    text: string;
    /** Lançamentos da confirmação citada, já resumidos pelo sistema (valores formatados). */
    entries: readonly { readonly position: number; readonly summary: string }[];
    today: BusinessDate;
    onUsage?: (usage: AiUsageRecord) => void;
  }): Promise<
    Result<
      { result: CorrectionResult; usage: readonly AiUsageRecord[] },
      ErrorOf<"ExtractionInvalid" | "LlmRefused">
    >
  >;
}

export interface Transcriber {
  /** `audioSeconds` é medido por nós (a API de transcrição não devolve duração); entra no uso. */
  transcribe(input: {
    audio: Uint8Array;
    contentType: string;
    audioSeconds: number;
  }): Promise<
    Result<
      { text: string; usage: AiUsageRecord },
      ErrorOf<"ExtractionInvalid" | "MediaUnavailable">
    >
  >;
}

/** Baixa a mídia recebida (Meta: duas chamadas, a URL vale 5 min; dev: arquivo local). */
export interface MediaDownloader {
  download(
    mediaId: string,
  ): Promise<Result<{ bytes: Uint8Array; contentType: string }, ErrorOf<"MediaUnavailable">>>;
}

/**
 * Converte o áudio recebido (OGG/Opus do WhatsApp, que a transcrição não aceita) para MP3 em taxa
 * constante, o que dá a duração exata pelo tamanho (limite de 180 s antes de gastar IA).
 */
export interface AudioConverter {
  toMp3(input: {
    bytes: Uint8Array;
    contentType: string;
  }): Promise<
    Result<
      { bytes: Uint8Array; contentType: "audio/mpeg"; bitsPerSecond: number },
      ErrorOf<"MediaUnavailable">
    >
  >;
}

/** Lê o texto de um QR Code numa foto de nota (nulo se não achar). */
export interface QrCodeReader {
  read(input: { bytes: Uint8Array; contentType: string }): string | null;
}

/** Liga a mídia e a transcrição à mensagem recebida (papel `app_ingest`). */
export interface InboundMediaRepo {
  attachMedia(inboundMessageId: string, mediaKey: string): Promise<void>;
  saveTranscription(inboundMessageId: string, text: string): Promise<void>;
}

/** Contagens de mensagens para os limites de uso (RF21), dentro de `withTenant`. */
export interface UsageGuardStore {
  countMessages(input: {
    tenantId: string;
    userId: string;
    userSince: Date;
    tenantSince: Date;
  }): Promise<{ userLastHour: number; tenantLastDay: number }>;
  /** Já avisamos este número do limite desde `since`? (o aviso sai no máximo uma vez por hora) */
  hasRecentNotice(input: {
    tenantId: string;
    toWaId: string;
    text: string;
    since: Date;
  }): Promise<boolean>;
}

export interface MediaStore {
  /** A chave é sempre prefixada pelo tenant. Devolve a chave gravada. */
  put(input: {
    tenantId: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ key: string }>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export interface Clock {
  now(): Date;
  /** Data de negócio de hoje no fuso informado (padrão America/Sao_Paulo). */
  today(timeZone?: string): BusinessDate;
}

export interface JobQueue {
  /** `singletonKey` impede enfileirar duas vezes o mesmo trabalho (ex.: wa_message_id). */
  enqueue(
    queue: string,
    payload: Readonly<Record<string, unknown>>,
    options?: { singletonKey?: string; startAfterSeconds?: number },
  ): Promise<{ jobId: string | null }>;
}

export type InboundMessageType = "text" | "audio" | "image" | "unsupported";

export interface NewInboundMessage {
  readonly waMessageId: string;
  /** Telefone do remetente como a Meta informa (`from`), sem normalizar. */
  readonly waId: string | null;
  readonly waUserId: string | null;
  readonly type: InboundMessageType;
  readonly text: string | null;
  /** Fatia do payload que descreve só esta mensagem. */
  readonly raw: unknown;
}

export interface NewStatusEvent {
  /** Id da mensagem enviada por nós. */
  readonly waMessageId: string;
  readonly status: string;
  readonly recipientId: string | null;
  readonly errorCode: number | null;
  readonly errorTitle: string | null;
  readonly errorDetail: string | null;
  readonly occurredAt: Date | null;
  readonly raw: unknown;
}

export interface StoredInboundMessage {
  readonly id: string;
  readonly waMessageId: string;
  /** `true` só na gravação que criou a linha; reentregas da Meta voltam como `false`. */
  readonly isNew: boolean;
  readonly status: string;
}

/** Mensagem recebida que um worker acabou de assumir (estado `processing`). */
export interface ClaimedInboundMessage {
  readonly id: string;
  readonly waMessageId: string;
  readonly waId: string | null;
  readonly waUserId: string | null;
  readonly type: InboundMessageType;
  readonly text: string | null;
  /** `context.id` do webhook: a mensagem que o usuário citou ao responder. */
  readonly replyToWaMessageId: string | null;
  /** Áudio ou imagem: id da mídia na Meta, tipo e legenda (a legenda complementa a leitura). */
  readonly media: {
    readonly id: string;
    readonly mimeType: string | null;
    readonly caption: string | null;
  } | null;
}

/**
 * Transições de estado da mensagem recebida (seção 3.4 do plano do canal). Cada uma é um
 * `UPDATE` com guarda no estado de origem, então repetir a chamada ou rodar dois workers nunca
 * duplica nem desfaz trabalho: quem perde a corrida recebe `null`/`false`.
 */
export interface InboundProcessingRepo {
  /**
   * `received` ou `processing` (retomada após erro ou queda) vira `processing`. Devolve `null`
   * se a mensagem não existe ou já saiu desses estados (processada, falha, aguardando resposta).
   */
  claim(id: string): Promise<ClaimedInboundMessage | null>;
  /** `processing` vira `processed`. `false` se a mensagem não estava em `processing`. */
  markProcessed(id: string): Promise<boolean>;
  /**
   * `received` ou `processing` vira `failed`, guardando só um código curto do erro (nunca o
   * conteúdo da mensagem nem a mensagem de erro do banco). `false` se já estava em outro estado.
   */
  markFailed(id: string, errorCode: string): Promise<boolean>;
}

/** Gravação do webhook, antes de a mensagem ter tenant (papel `app_ingest`). */
export interface InboundIngestRepo {
  /**
   * Grava as mensagens que ainda não existem (idempotente por `waMessageId`) e devolve uma
   * entrada para cada `waMessageId` recebido, nova ou não.
   */
  saveMessages(messages: readonly NewInboundMessage[]): Promise<readonly StoredInboundMessage[]>;
  /** Grava eventos de status ainda não vistos e devolve quantos eram novos. */
  saveStatuses(events: readonly NewStatusEvent[]): Promise<number>;
}

/** Cadastro de quem escreve (papel `app_ingest`: a mensagem ainda não tem tenant). */
export interface SenderDirectory {
  /** Vínculos dos telefones candidatos (`lookupCandidates` da normalização), ativos ou não. */
  findMemberships(phoneCandidates: readonly string[]): Promise<readonly SenderMembership[]>;
}

/** Liga a mensagem recebida a quem a enviou (papel `app_ingest`). */
export interface InboundSenderRepo {
  /** Atribui tenant e usuário. Idempotente; `false` se a mensagem já tinha outro dono. */
  assignSender(
    inboundMessageId: string,
    sender: { tenantId: string; userId: string },
  ): Promise<boolean>;
}

/** Consultas e registros da conversa que sempre rodam dentro de `withTenant`. */
export interface TenantConversationRepo {
  /**
   * Registra o opt-in (permissão de receber mensagens nossas) na primeira mensagem do usuário.
   * `true` só quando criou o registro; repetir é inofensivo.
   */
  recordOptIn(input: {
    tenantId: string;
    userId: string;
    inboundMessageId: string;
  }): Promise<boolean>;
  /** A mensagem citada é uma resposta nossa, deste tenant? Nulo se não. */
  findReplyTarget(tenantId: string, waMessageId: string): Promise<ReplyTarget | null>;
  /** O usuário tem pergunta nossa ainda sem resposta e não expirada? */
  hasPendingQuestion(input: { tenantId: string; userId: string; now: Date }): Promise<boolean>;
}

/** Gravação de lançamentos por mensagem (E7). Sempre dentro de `withTenant` no adaptador. */
export interface EntryRegistration {
  readonly tenantId: string;
  readonly userId: string;
  readonly inboundMessageId: string;
  readonly entries: readonly { readonly position: number; readonly change: EntryChange }[];
  readonly newSuppliers: readonly { readonly id: string; readonly name: string }[];
  readonly usage: readonly AiUsageRecord[];
  /** Nota fiscal lida na foto: chave única por empresa (RF14.R2), gravada junto dos lançamentos. */
  readonly fiscalDocument?: {
    readonly id: string;
    readonly accessKey: string;
    readonly source: "qrcode_sefaz" | "ai_reading";
    /** Lida só pela IA enquanto a SEFAZ não foi consultada: marcada para nova conferência. */
    readonly needsRecheck: boolean;
  };
  /** Pergunta aberta antes desta gravação que deve ser fechada (respondida ou cancelada). */
  readonly closePendingQuestion?: {
    readonly id: string;
    readonly status: "answered" | "cancelled";
  };
  /** Pergunta nova sobre os lançamentos incompletos (uma aberta por colaborador, RF15.R8). */
  readonly openPendingQuestion?: {
    readonly id: string;
    readonly draft: unknown;
    readonly question: string;
    readonly expiresAt: Date;
  };
}

export interface PendingQuestionRecord {
  readonly id: string;
  readonly inboundMessageId: string;
  readonly draft: unknown;
  readonly question: string;
  readonly expiresAt: Date;
}

export interface EntryStore {
  loadCatalog(tenantId: string): Promise<CatalogSnapshot>;
  /** Lançamentos ativos criados desde `since`, para o sinal de duplicidade. */
  findRecentEntries(tenantId: string, since: Date): Promise<readonly RecentEntry[]>;
  findEntriesByInbound(tenantId: string, inboundMessageId: string): Promise<readonly Entry[]>;
  /**
   * Lançamentos ativos da mensagem mais recente do usuário que ainda tenha algum, desde `since`
   * e antes de `before` quando informado (desfazer repetido volta uma mensagem, RF18.R3).
   */
  findLatestActiveBatch(input: {
    tenantId: string;
    userId: string;
    since: Date;
  }): Promise<readonly Entry[]>;
  /** Grava tudo em uma transação: lançamentos, versões, fornecedores, uso de IA e pergunta. */
  register(registration: EntryRegistration): Promise<void>;
  /** Aplica alterações (correção, desfazer). `false` se algum lançamento mudou no meio. */
  applyChanges(tenantId: string, changes: readonly EntryChange[]): Promise<boolean>;
  setConfirmation(tenantId: string, inboundMessageId: string, waMessageId: string): Promise<void>;
  /** Já enviamos resposta desta finalidade para esta mensagem? (envio idempotente, RF16.Obs1) */
  hasOutbound(
    tenantId: string,
    inboundMessageId: string,
    purpose: OutboundPurpose,
  ): Promise<boolean>;
  /** Nota fiscal já registrada pela empresa com esta chave (quando e por quem), RF14.R2. */
  findFiscalDocument(
    tenantId: string,
    accessKey: string,
  ): Promise<{ registeredAt: Date; userName: string } | null>;
  /** Texto original (ou transcrição) de uma mensagem do tenant. */
  loadInboundText(tenantId: string, inboundMessageId: string): Promise<string | null>;
  findOpenPendingQuestion(input: {
    tenantId: string;
    userId: string;
    now: Date;
  }): Promise<PendingQuestionRecord | null>;
  /** Fecha a pergunta aberta sem gravar lançamento (cancelar, expirada, substituída). */
  closePendingQuestion(
    tenantId: string,
    id: string,
    status: "answered" | "cancelled" | "expired",
  ): Promise<void>;
  recordAiUsage(input: {
    tenantId: string;
    inboundMessageId: string | null;
    usage: readonly AiUsageRecord[];
  }): Promise<void>;
  /** Soma do custo de IA da conversa de uma mensagem (chat de desenvolvimento, `/custo`). */
  sumAiUsageForUser(input: { tenantId: string; userId: string }): Promise<{
    calls: number;
    costUsdMicros: number;
  }>;
}
