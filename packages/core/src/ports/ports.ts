import type { OutboundPurpose, ReplyTarget, SenderMembership } from "../conversation";
import type { BusinessDate, ExtractionResult } from "../entry";
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
  }): Promise<
    Result<
      { result: ExtractionResult; usage: AiUsageRecord },
      ErrorOf<"ExtractionInvalid" | "LlmRefused">
    >
  >;
}

export interface Transcriber {
  transcribe(input: {
    audio: Uint8Array;
    contentType: string;
  }): Promise<Result<{ text: string; audioSeconds: number }, ErrorOf<"ExtractionInvalid">>>;
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
