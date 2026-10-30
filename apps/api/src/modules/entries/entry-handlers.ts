import {
  type AiUsageRecord,
  type AudioConverter,
  buildDrafts,
  type CatalogSnapshot,
  type Clock,
  type CorrectionExtractor,
  can,
  cbrAudioSeconds,
  createEntry,
  type Entry,
  type EntryChange,
  type EntryExtractor,
  type EntryStore,
  editEntry,
  formatBRL,
  groupReceiptEntries,
  type InboundMediaRepo,
  interpretExtraction,
  type MediaDownloader,
  type MediaStore,
  normalizeName,
  type PendingEntry,
  type PendingQuestionRecord,
  parseNfceQr,
  planCorrection,
  type QrCodeReader,
  type ReplyTarget,
  softDeleteEntry,
  type TenantExtractionContext,
  type Transcriber,
  type UsageLimits,
} from "@app/core";
import type { JobLogger } from "../../infra/logger";
import { OUT_OF_SCOPE_TEXT, UNSUPPORTED_TYPE_TEXT } from "../inbound/messages";
import type { RouteContext, RouteHandlers } from "../inbound/route-inbound";
import {
  ALREADY_UNDONE_TEXT,
  AUDIO_TOO_LONG_TEXT,
  AUDIO_UNINTELLIGIBLE_TEXT,
  askWhichText,
  CANNOT_CHANGE_OTHERS_TEXT,
  CORRECTION_FUTURE_DATE_TEXT,
  CORRECTION_NO_CHANGE_TEXT,
  CORRECTION_STALE_TEXT,
  CORRECTION_UNCLEAR_HINT,
  confirmationText,
  correctionText,
  discardedText,
  duplicateReceiptText,
  EXTRACTION_FAILED_TEXT,
  IMAGE_TOO_BIG_TEXT,
  NOTHING_TO_UNDO_24H_TEXT,
  OPEN_QUESTION_HINT,
  PENDING_DISCARDED_TEXT,
  placeLabel,
  questionText,
  RECEIPT_UNREADABLE_TEXT,
  UNIT_MISSING_TEXT,
  undoText,
  unresolvedText,
} from "./messages";

/** A pergunta de volta vale por 24 horas; depois nada é gravado (RF15.R3). */
export const PENDING_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;
/** Janela do "desfazer" sozinho (RF18.R1) e da busca por duplicidade (RF12.R13). */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Evita um prompt gigante em restaurante com milhares de fornecedores. */
const MAX_CONTEXT_SUPPLIERS = 200;

export interface EntryHandlerDeps {
  readonly store: EntryStore;
  readonly extractor: EntryExtractor;
  readonly correctionExtractor: CorrectionExtractor;
  readonly clock: Clock;
  readonly media: {
    readonly downloader: MediaDownloader;
    readonly store: MediaStore;
    readonly inbound: InboundMediaRepo;
    readonly audioConverter: AudioConverter;
    readonly transcriber: Transcriber;
    readonly qrReader: QrCodeReader;
    readonly limits: UsageLimits;
  };
  /** UUID v7. */
  readonly newId: () => string;
  readonly logger: JobLogger;
}

type EntryHandlers = Pick<
  RouteHandlers,
  "undo" | "cancel" | "correction" | "pendingAnswer" | "extract"
>;

function extractionContext(catalog: CatalogSnapshot): TenantExtractionContext {
  return {
    categories: catalog.categories.map((category) => category.name),
    suppliers: catalog.suppliers.slice(0, MAX_CONTEXT_SUPPLIERS).map((supplier) => supplier.name),
    units: catalog.units.map((unit) => unit.name),
    paymentMethods: catalog.paymentMethods.map((method) => method.name),
  };
}

/** Falha ao obter ou converter a mídia: sobe para o job ser retentado e avisar na falha final. */
export class MediaFailedError extends Error {
  constructor(readonly detail: string) {
    super(`falha de mídia: ${detail}`);
    this.name = "MediaFailedError";
  }
}

interface PendingDraft {
  readonly entries?: readonly unknown[];
  readonly originalText?: string;
}

/**
 * Casos de uso do lançamento por mensagem (E7). Tudo que a IA devolve passa pelo `core`
 * (`interpretExtraction`, `buildDrafts`, `planCorrection`): o sistema valida, calcula e grava.
 * Reprocessar a mesma mensagem não duplica lançamento nem resposta (RF16.Obs1).
 */
export function createEntryHandlers(deps: EntryHandlerDeps): EntryHandlers {
  const { store, clock, logger } = deps;

  const place = (context: RouteContext, catalog: CatalogSnapshot, unitId: string | null) =>
    placeLabel({
      unitName: catalog.units.find((unit) => unit.id === unitId)?.name ?? null,
      tenantName: context.sender.tenantName,
      tenantCount: context.tenantCount,
    });

  /** Reenvia o que faltou depois de uma queda: sem nova chamada de IA e sem duplicar. */
  async function resend(
    context: RouteContext,
    entries: readonly Entry[],
    heard?: string,
  ): Promise<void> {
    const { tenantId, userId } = context.sender;
    const messageId = context.message.id;
    if (entries.length > 0 && !(await store.hasOutbound(tenantId, messageId, "confirmation"))) {
      const catalog = await store.loadCatalog(tenantId);
      const text = confirmationText({
        entries,
        catalog,
        place: place(context, catalog, entries[0]?.unitId ?? null),
        ...(heard ? { heard } : {}),
      });
      const waId = await context.reply(text, "confirmation");
      if (waId) await store.setConfirmation(tenantId, messageId, waId);
    }
    const open = await store.findOpenPendingQuestion({ tenantId, userId, now: clock.now() });
    if (
      open?.inboundMessageId === messageId &&
      !(await store.hasOutbound(tenantId, messageId, "question"))
    ) {
      await context.reply(`${open.question}`, "question");
    }
  }

  /**
   * Interpreta um texto (a mensagem, ou a mensagem combinada com a resposta a uma pergunta),
   * grava os lançamentos completos e pergunta só sobre o incompleto (RF15.Obs1).
   */
  async function handleText(
    context: RouteContext,
    input: {
      text?: string;
      image?: { bytes: Uint8Array; contentType: string };
      /** Foto de nota: itens agrupados por categoria e chave de acesso guardada (RF14). */
      receipt?: { accessKey: string | null };
      /** Trecho entendido do áudio, mostrado na confirmação (RF13.Obs2). */
      heard?: string;
      pending?: PendingQuestionRecord;
    },
  ): Promise<void> {
    const { tenantId, userId } = context.sender;
    const messageId = context.message.id;
    const now = clock.now();

    const existing = await store.findEntriesByInbound(tenantId, messageId);
    const alreadyAsked =
      (await store.findOpenPendingQuestion({ tenantId, userId, now }))?.inboundMessageId ===
      messageId;
    if (existing.length > 0 || alreadyAsked) return resend(context, existing, input.heard);

    const catalog = await store.loadCatalog(tenantId);
    const today = clock.today();
    const usage: AiUsageRecord[] = [];
    const extracted = await deps.extractor.extract({
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.image ? { image: input.image } : {}),
      context: extractionContext(catalog),
      today,
      onUsage: (record) => usage.push(record),
    });
    const recordUsage = () =>
      usage.length > 0
        ? store.recordAiUsage({ tenantId, inboundMessageId: messageId, usage })
        : Promise.resolve();

    if (!extracted.ok) {
      await recordUsage();
      logger.warn({ inboundMessageId: messageId, code: extracted.error.code }, "extração falhou");
      await context.reply(EXTRACTION_FAILED_TEXT, "notice");
      return;
    }

    const interpretation = interpretExtraction(extracted.value.result, today);

    if (interpretation.kind === "out_of_scope") {
      await recordUsage();
      await context.reply(OUT_OF_SCOPE_TEXT, "notice");
      return;
    }

    const expiresAt = new Date(now.getTime() + PENDING_QUESTION_TTL_MS);
    const closeOld = (status: "answered" | "cancelled") =>
      input.pending ? { closePendingQuestion: { id: input.pending.id, status } } : {};

    if (interpretation.kind === "unclear") {
      const question = `${interpretation.question}\n\n${OPEN_QUESTION_HINT}`;
      await store.register({
        tenantId,
        userId,
        inboundMessageId: messageId,
        entries: [],
        newSuppliers: [],
        usage,
        ...closeOld("answered"),
        openPendingQuestion: {
          id: deps.newId(),
          draft: { originalText: input.text ?? "" } satisfies PendingDraft,
          question,
          expiresAt,
        },
      });
      await context.reply(question, "question");
      return;
    }

    const unitId = context.defaultUnitId ?? catalog.units[0]?.id ?? null;
    if (unitId === null) {
      await recordUsage();
      await context.reply(UNIT_MISSING_TEXT, "notice");
      return;
    }

    // Foto de nota: valor ilegível nunca é inventado (RF14.Obs1, CA05): nada é gravado.
    if (input.receipt && interpretation.pending.length > 0) {
      await recordUsage();
      await context.reply(RECEIPT_UNREADABLE_TEXT, "notice");
      return;
    }
    const ready = input.receipt
      ? groupReceiptEntries(interpretation.ready, catalog)
      : interpretation.ready;

    const recent = await store.findRecentEntries(
      tenantId,
      new Date(now.getTime() - RECENT_WINDOW_MS),
    );
    const plan = buildDrafts(ready, {
      catalog,
      unitId,
      inboundMessageId: messageId,
      recent,
      newId: deps.newId,
    });
    const changes = plan.drafts.map(({ position, draft }) => {
      const created = createEntry(draft, {
        id: deps.newId(),
        tenantId,
        actorId: userId,
        channel: "whatsapp",
        at: now,
      });
      // Erro aqui é falha de programação ou de dado: sobe para o job retentar e cair na DLQ.
      if (!created.ok) throw new Error(`lançamento recusado pelo domínio: ${created.error.code}`);
      return { position, change: created.value };
    });

    // Resposta que não tem relação com a pergunta é um lançamento novo: a pergunta antiga sai.
    const droppedDescriptions = input.pending
      ? discardedDescriptions(input.pending, interpretation.ready, interpretation.pending)
      : [];
    const pendingStatus = droppedDescriptions.length > 0 ? "cancelled" : "answered";

    const hasPending = interpretation.pending.length > 0;
    const question = hasPending
      ? questionText(interpretation.pending, interpretation.modelQuestion)
      : null;

    await store.register({
      tenantId,
      userId,
      inboundMessageId: messageId,
      entries: changes,
      newSuppliers: plan.newSuppliers,
      usage,
      ...(input.receipt?.accessKey
        ? {
            fiscalDocument: {
              id: deps.newId(),
              accessKey: input.receipt.accessKey,
              // A consulta à SEFAZ ainda não existe: a nota é lida pela IA e fica marcada para
              // nova conferência (RF14.R5).
              source: "ai_reading" as const,
              needsRecheck: true,
            },
          }
        : {}),
      ...closeOld(pendingStatus),
      ...(hasPending && question
        ? {
            openPendingQuestion: {
              id: deps.newId(),
              draft: {
                entries: interpretation.pending.map((entry) => entry.extracted),
                originalText: input.text ?? "",
              } satisfies PendingDraft,
              question,
              expiresAt,
            },
          }
        : {}),
    });

    if (droppedDescriptions.length > 0) {
      await context.reply(discardedText(droppedDescriptions), "notice");
    }
    if (changes.length > 0) {
      const entries = changes.map(({ change }) => change.entry);
      const text = confirmationText({
        entries,
        catalog,
        place: place(context, catalog, unitId),
        ...(input.heard ? { heard: input.heard } : {}),
      });
      const waId = await context.reply(text, "confirmation");
      if (waId) await store.setConfirmation(tenantId, messageId, waId);
    }
    if (question) await context.reply(question, "question");
  }

  function discardedDescriptions(
    pending: PendingQuestionRecord,
    ready: readonly { description: string }[],
    stillPending: readonly PendingEntry[],
  ): string[] {
    const draft = pending.draft as PendingDraft;
    const old = (draft.entries ?? []) as { description?: string }[];
    if (old.length === 0) return [];
    const now = [
      ...ready.map((e) => e.description),
      ...stillPending.map((e) => e.extracted.description),
    ].map(normalizeName);
    const related = (description: string) =>
      now.some(
        (other) =>
          other.includes(normalizeName(description)) || normalizeName(description).includes(other),
      );
    const unrelated = old
      .map((entry) => entry.description ?? "")
      .filter((d) => d !== "" && !related(d));
    return unrelated.length === old.length ? unrelated : [];
  }

  async function activeEntries(context: RouteContext, inboundMessageId: string) {
    const all = await store.findEntriesByInbound(context.sender.tenantId, inboundMessageId);
    return all.filter((entry) => entry.deletedAt === null);
  }

  /** Staff mexe só nos próprios lançamentos; gerente e dono, nos da unidade (RF17.Obs1). */
  function mayChange(
    context: RouteContext,
    entry: Entry,
    action: "entry:edit" | "entry:delete",
  ): boolean {
    const { sender } = context;
    if (sender.unitId !== null && entry.unitId !== sender.unitId) return false;
    return can(sender.role, action, {
      isOwnEntry: entry.createdBy === sender.userId,
    });
  }

  /** Áudio (RF13): baixa, guarda, converte, confere a duração, transcreve e segue como texto. */
  async function handleAudio(context: RouteContext): Promise<void> {
    const { tenantId } = context.sender;
    const messageId = context.message.id;
    const { media } = deps;

    // Retry depois de transcrever: reaproveita o texto, sem baixar nem pagar de novo.
    const already = await store.loadInboundText(tenantId, messageId);
    if (already !== null && already !== "") {
      return handleText(context, { text: already, heard: already });
    }

    const mediaRef = context.message.media;
    if (mediaRef === null) {
      await context.reply(UNSUPPORTED_TYPE_TEXT, "notice");
      return;
    }
    const downloaded = await media.downloader.download(mediaRef.id);
    if (!downloaded.ok) throw new MediaFailedError(downloaded.error.detail);
    const stored = await media.store.put({
      tenantId,
      bytes: downloaded.value.bytes,
      contentType: downloaded.value.contentType,
    });
    await media.inbound.attachMedia(messageId, stored.key);

    const converted = await media.audioConverter.toMp3(downloaded.value);
    if (!converted.ok) throw new MediaFailedError(converted.error.detail);
    const seconds = cbrAudioSeconds(converted.value.bytes.length, converted.value.bitsPerSecond);
    if (seconds > media.limits.maxAudioSeconds) {
      await context.reply(AUDIO_TOO_LONG_TEXT, "notice");
      return;
    }

    const transcription = await media.transcriber.transcribe({
      audio: converted.value.bytes,
      contentType: converted.value.contentType,
      audioSeconds: seconds,
    });
    if (!transcription.ok) {
      if (transcription.error.code === "MediaUnavailable") {
        throw new MediaFailedError(transcription.error.detail);
      }
      await context.reply(AUDIO_UNINTELLIGIBLE_TEXT, "notice");
      return;
    }
    await store.recordAiUsage({
      tenantId,
      inboundMessageId: messageId,
      usage: [transcription.value.usage],
    });
    if (transcription.value.text === "") {
      await context.reply(AUDIO_UNINTELLIGIBLE_TEXT, "notice");
      return;
    }
    await media.inbound.saveTranscription(messageId, transcription.value.text);
    return handleText(context, {
      text: transcription.value.text,
      heard: transcription.value.text,
    });
  }

  /** Foto de nota (RF14): QR primeiro para a chave e a duplicidade; a IA lê a imagem. */
  async function handleImage(context: RouteContext): Promise<void> {
    const { tenantId } = context.sender;
    const messageId = context.message.id;
    const { media } = deps;

    const mediaRef = context.message.media;
    if (mediaRef === null) {
      await context.reply(UNSUPPORTED_TYPE_TEXT, "notice");
      return;
    }
    // Retry depois de gravar: não baixa de novo; o handleText reenvia o que faltou.
    if ((await store.findEntriesByInbound(tenantId, messageId)).length > 0) {
      return handleText(context, { receipt: { accessKey: null } });
    }
    const downloaded = await media.downloader.download(mediaRef.id);
    if (!downloaded.ok) throw new MediaFailedError(downloaded.error.detail);
    if (downloaded.value.bytes.length > media.limits.maxImageBytes) {
      await context.reply(IMAGE_TOO_BIG_TEXT, "notice");
      return;
    }
    const stored = await media.store.put({
      tenantId,
      bytes: downloaded.value.bytes,
      contentType: downloaded.value.contentType,
    });
    await media.inbound.attachMedia(messageId, stored.key);

    const qr = media.qrReader.read(downloaded.value);
    const accessKey = qr === null ? null : parseNfceQr(qr);
    if (accessKey !== null) {
      const duplicate = await store.findFiscalDocument(tenantId, accessKey);
      if (duplicate) {
        await context.reply(
          duplicateReceiptText(duplicate.registeredAt, duplicate.userName),
          "notice",
        );
        return;
      }
    }
    const caption = mediaRef.caption?.trim();
    return handleText(context, {
      ...(caption ? { text: caption } : {}),
      image: downloaded.value,
      receipt: { accessKey },
    });
  }

  return {
    extract: (context) => {
      switch (context.message.type) {
        case "audio":
          return handleAudio(context);
        case "image":
          return handleImage(context);
        default:
          return handleText(context, { text: context.message.text ?? "" });
      }
    },

    async pendingAnswer(context) {
      const { tenantId, userId } = context.sender;
      const pending = await store.findOpenPendingQuestion({
        tenantId,
        userId,
        now: clock.now(),
      });
      const answer = context.message.text ?? "";
      if (!pending) return handleText(context, { text: answer });
      const draft = pending.draft as PendingDraft;
      const lines = [
        draft.entries && draft.entries.length > 0
          ? `Lançamentos pendentes de uma mensagem anterior (JSON): ${JSON.stringify(draft.entries)}`
          : `Mensagem anterior: ${draft.originalText ?? ""}`,
        `Pergunta feita ao usuário: ${pending.question.split("\n\n")[0]}`,
        `Resposta do usuário: ${answer}`,
        "Complete os lançamentos pendentes com a resposta. Se a resposta não tiver relação com a pergunta e for um lançamento novo, devolva apenas o novo.",
      ];
      return handleText(context, { text: lines.join("\n"), pending });
    },

    async cancel(context) {
      const { tenantId, userId } = context.sender;
      const pending = await store.findOpenPendingQuestion({
        tenantId,
        userId,
        now: clock.now(),
      });
      if (!pending) {
        await context.reply("Não há nenhuma pergunta aberta para cancelar.", "notice");
        return;
      }
      await store.closePendingQuestion(tenantId, pending.id, "cancelled");
      await context.reply(PENDING_DISCARDED_TEXT, "notice");
    },

    async undo(context, target: ReplyTarget | null) {
      const { tenantId, userId } = context.sender;
      const now = clock.now();
      const entries = target
        ? target.inboundMessageId === null
          ? []
          : await store.findEntriesByInbound(tenantId, target.inboundMessageId)
        : await store.findLatestActiveBatch({
            tenantId,
            userId,
            since: new Date(now.getTime() - RECENT_WINDOW_MS),
          });
      const active = entries.filter((entry) => entry.deletedAt === null);
      if (active.length === 0) {
        await context.reply(target ? ALREADY_UNDONE_TEXT : NOTHING_TO_UNDO_24H_TEXT, "notice");
        return;
      }
      if (!active.every((entry) => mayChange(context, entry, "entry:delete"))) {
        await context.reply(CANNOT_CHANGE_OTHERS_TEXT, "notice");
        return;
      }
      const changes: EntryChange[] = [];
      for (const entry of active) {
        const deleted = softDeleteEntry(entry, { actorId: userId, channel: "whatsapp", at: now });
        if (deleted.ok) changes.push(deleted.value);
      }
      if (!(await store.applyChanges(tenantId, changes))) {
        await context.reply(CORRECTION_STALE_TEXT, "notice");
        return;
      }
      const catalog = await store.loadCatalog(tenantId);
      await context.reply(
        undoText(
          changes.map((change) => change.entry),
          catalog,
        ),
        "notice",
      );
    },

    async correction(context, target) {
      const { tenantId, userId } = context.sender;
      const now = clock.now();
      const entries =
        target.inboundMessageId === null
          ? []
          : await activeEntries(context, target.inboundMessageId);
      if (entries.length === 0) {
        await context.reply(ALREADY_UNDONE_TEXT, "notice");
        return;
      }
      if (!entries.every((entry) => mayChange(context, entry, "entry:edit"))) {
        await context.reply(CANNOT_CHANGE_OTHERS_TEXT, "notice");
        return;
      }
      const catalog = await store.loadCatalog(tenantId);
      const today = clock.today();
      const usage: AiUsageRecord[] = [];
      const extracted = await deps.correctionExtractor.extract({
        text: context.message.text ?? "",
        entries: entries.map((entry, index) => ({
          position: index + 1,
          summary: `${entry.description} — ${formatBRL(entry.amountCents)} — ${entry.occurredOn}`,
        })),
        today,
        onUsage: (record) => usage.push(record),
      });
      const recordUsage = () =>
        usage.length > 0
          ? store.recordAiUsage({ tenantId, inboundMessageId: context.message.id, usage })
          : Promise.resolve();
      if (!extracted.ok) {
        await recordUsage();
        await context.reply(`${EXTRACTION_FAILED_TEXT}\n${CORRECTION_UNCLEAR_HINT}`, "notice");
        return;
      }
      await recordUsage();

      const outcome = planCorrection(extracted.value.result, entries, catalog, today);
      switch (outcome.kind) {
        case "out_of_scope":
          await context.reply(CORRECTION_UNCLEAR_HINT, "notice");
          return;
        case "ask":
          await context.reply(`${outcome.question}\n${CORRECTION_UNCLEAR_HINT}`, "notice");
          return;
        case "ask_which":
          await context.reply(askWhichText(entries), "notice");
          return;
        case "rejected":
          await context.reply(
            outcome.reason === "future_date"
              ? CORRECTION_FUTURE_DATE_TEXT
              : CORRECTION_NO_CHANGE_TEXT,
            "notice",
          );
          return;
        case "ready": {
          const changes: EntryChange[] = [];
          for (const { entry, patch } of outcome.patches) {
            const edited = editEntry(entry, patch, {
              actorId: userId,
              channel: "whatsapp",
              at: now,
            });
            if (edited.ok) changes.push(edited.value);
          }
          if (changes.length === 0) {
            await context.reply(CORRECTION_NO_CHANGE_TEXT, "notice");
            return;
          }
          if (!(await store.applyChanges(tenantId, changes))) {
            await context.reply(CORRECTION_STALE_TEXT, "notice");
            return;
          }
          const text = correctionText(
            changes.map((change) => change.entry),
            catalog,
          );
          await context.reply(
            outcome.unresolved.length > 0 ? `${text}\n${unresolvedText(outcome.unresolved)}` : text,
            "notice",
          );
          return;
        }
      }
    },
  };
}
