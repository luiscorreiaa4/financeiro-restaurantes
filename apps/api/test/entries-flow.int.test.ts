import {
  createFakeCorrectionExtractor,
  createFakeEntryExtractor,
  createFakeTranscriber,
} from "@app/ai";
import type {
  CorrectionChanges,
  CorrectionResult,
  ExtractedEntry,
  ExtractionResult,
} from "@app/core";
import {
  type AudioConverter,
  DEFAULT_USAGE_LIMITS,
  fail,
  type MediaDownloader,
  ok,
  type QrCodeReader,
  type UsageLimits,
} from "@app/core";
import {
  createDatabase,
  createEntryStore,
  createInboundIngestRepo,
  createInboundMediaRepo,
  createInboundProcessingRepo,
  createInboundSenderRepo,
  createOutboundMessageRepo,
  createSenderDirectory,
  createTenantConversationRepo,
  createUsageGuardStore,
  DEV_PHONES,
  seedDevData,
  seedSystemCategories,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { buildMediaWebhookPayload, buildTextWebhookPayload, parseWebhook } from "@app/whatsapp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { businessDateOf, createSystemClock } from "../src/infra/clock";
import { createDevMessageSender } from "../src/infra/dev-message-sender";
import { createLogger } from "../src/infra/logger";
import { createInMemoryMediaStore } from "../src/infra/media/local-media-store";
import { createEntryHandlers } from "../src/modules/entries/entry-handlers";
import { createFailureNotifier } from "../src/modules/inbound/notify-failure";
import { createProcessInbound } from "../src/modules/inbound/process-inbound";
import { createRouteInbound, defaultHandlers } from "../src/modules/inbound/route-inbound";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
  await seedSystemCategories(createDatabase(db.admin));
  await seedDevData(createDatabase(db.admin), "test");
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.admin.query(
    "truncate outbound_messages, whatsapp_opt_ins, pending_questions, ai_usage, inbound_messages cascade",
  );
  await db.admin.query("delete from entry_versions");
  await db.admin.query("delete from entries");
});

const extracted = (overrides: Partial<ExtractedEntry> = {}): ExtractedEntry => ({
  type: "expense",
  description: "Camarão",
  occurred_on: null,
  quantity: null,
  quantity_unit: null,
  unit_price_cents: null,
  total_cents: 45000,
  category_hint: null,
  supplier_hint: null,
  payment_method_hint: null,
  sales_channel_hint: null,
  missing_fields: [],
  ...overrides,
});
const register = (entries: ExtractedEntry[], question: string | null = null): ExtractionResult => ({
  intent: "register",
  entries,
  question,
});
const noChanges: CorrectionChanges = {
  description: null,
  occurred_on: null,
  quantity: null,
  quantity_unit: null,
  total_cents: null,
  category_hint: null,
  payment_method_hint: null,
  sales_channel_hint: null,
};
const correct = (
  changes: Partial<CorrectionChanges>,
  targets: number[] = [],
): CorrectionResult => ({
  intent: "correct",
  targets,
  changes: { ...noChanges, ...changes },
  question: null,
});

interface Script {
  extractions?: Parameters<typeof createFakeEntryExtractor>[0];
  corrections?: Parameters<typeof createFakeCorrectionExtractor>[0];
  transcripts?: Parameters<typeof createFakeTranscriber>[0];
  /** Mídias que o "WhatsApp" tem para baixar, por id. */
  files?: Record<string, { bytes: Uint8Array; contentType: string }>;
  /** Duração, em segundos, que o conversor devolve (32 kbps: bytes = segundos × 4000). */
  audioSeconds?: number;
  /** Texto que o leitor de QR devolve (nulo = foto sem QR). */
  qr?: string | null;
  limits?: UsageLimits;
  /** Troca o envio (ex.: para espiar o "lida" e o "digitando"). */
  wrapSender?: (
    sender: ReturnType<typeof createDevMessageSender>,
  ) => ReturnType<typeof createDevMessageSender>;
}

/** Um "mundo" por teste: IA e mídia roteirizadas, o resto é real (banco, fila de estados, envio). */
function world(script: Script = {}) {
  const logger = createLogger("silent");
  const ingestDb = createDatabase(db.ingest);
  const baseSender = createDevMessageSender({
    repo: createOutboundMessageRepo(ingestDb),
    nodeEnv: "test",
  });
  const sender = script.wrapSender ? script.wrapSender(baseSender) : baseSender;
  const extractor = createFakeEntryExtractor(script.extractions ?? []);
  const corrector = createFakeCorrectionExtractor(script.corrections ?? []);
  const transcriber = createFakeTranscriber(script.transcripts ?? []);
  const clock = createSystemClock();
  const limits = script.limits ?? DEFAULT_USAGE_LIMITS;
  const mediaStore = createInMemoryMediaStore();
  const downloads: string[] = [];
  const downloader: MediaDownloader = {
    async download(mediaId) {
      downloads.push(mediaId);
      const file = script.files?.[mediaId];
      return file ? ok(file) : fail("MediaUnavailable", { detail: "arquivo_ausente" });
    },
  };
  const audioConverter: AudioConverter = {
    async toMp3() {
      const seconds = script.audioSeconds ?? 20;
      return ok({
        bytes: new Uint8Array(seconds * 4000),
        contentType: "audio/mpeg" as const,
        bitsPerSecond: 32_000,
      });
    },
  };
  const qrReader: QrCodeReader = { read: () => script.qr ?? null };
  const handlers = {
    ...defaultHandlers(logger),
    ...createEntryHandlers({
      store: createEntryStore(createDatabase(db.app)),
      extractor,
      correctionExtractor: corrector,
      clock,
      media: {
        downloader,
        store: mediaStore,
        inbound: createInboundMediaRepo(ingestDb),
        audioConverter,
        transcriber,
        qrReader,
        limits,
      },
      newId: uuidv7,
      logger,
    }),
  };
  const route = createRouteInbound({
    directory: createSenderDirectory(ingestDb),
    senderRepo: createInboundSenderRepo(ingestDb),
    conversation: createTenantConversationRepo(createDatabase(db.app)),
    sender,
    clock,
    handlers,
    supportContact: "suporte@exemplo.com.br",
    logger,
    usageGuard: { store: createUsageGuardStore(createDatabase(db.app)), limits },
  });
  const processInbound = createProcessInbound({
    repo: createInboundProcessingRepo(ingestDb),
    route,
    logger,
    onFinalFailure: createFailureNotifier({
      sender,
      supportContact: "suporte@exemplo.com.br",
      logger,
    }),
  });

  async function receive(payload: unknown, retry: number) {
    const [message] = parseWebhook(payload).messages;
    if (!message) throw new Error("payload do teste não gerou mensagem");
    const [stored] = await createInboundIngestRepo(ingestDb).saveMessages([message]);
    const id = stored?.id ?? "";
    const run = (retryCount: number) =>
      processInbound(
        { inboundMessageId: id, waMessageId: message.waMessageId },
        { retryCount, retryLimit: 5 },
      );
    return { id, waMessageId: message.waMessageId, run, outcome: await run(retry) };
  }

  async function say(waId: string, text: string, replyToWaMessageId?: string, retry = 0) {
    const waMessageId = `dev.wamid.${uuidv7()}`;
    return receive(
      buildTextWebhookPayload({ waId, waMessageId, text, replyToWaMessageId, sentAt: new Date() }),
      retry,
    );
  }

  async function sayMedia(
    waId: string,
    kind: "audio" | "image",
    mediaId: string,
    options: { mimeType?: string; caption?: string; retry?: number } = {},
  ) {
    return receive(
      buildMediaWebhookPayload({
        waId,
        waMessageId: `dev.wamid.${uuidv7()}`,
        kind,
        mediaId,
        mimeType: options.mimeType ?? (kind === "audio" ? "audio/ogg; codecs=opus" : "image/jpeg"),
        ...(options.caption === undefined ? {} : { caption: options.caption }),
        sentAt: new Date(),
      }),
      options.retry ?? 0,
    );
  }
  return { say, sayMedia, extractor, corrector, transcriber, mediaStore, downloads };
}

const OWNER = DEV_PHONES.owner.replace("+", "");
const STAFF = DEV_PHONES.staff.replace("+", "");

const replies = async () =>
  (
    await db.admin.query<{ wa_message_id: string; purpose: string; text: string }>(
      "select wa_message_id, purpose, text from outbound_messages order by created_at, id",
    )
  ).rows;
const lastReply = async () => (await replies()).at(-1);
const entryRows = async () =>
  (
    await db.admin.query<{
      id: string;
      description: string;
      amount_cents: string;
      fee_cents: string;
      net_cents: string;
      version: number;
      deleted_at: Date | null;
      flags: string[];
      inbound_message_id: string;
      confirmation_wa_message_id: string | null;
      category_id: string | null;
    }>(
      `select id, description, amount_cents, fee_cents, net_cents, version, deleted_at, flags,
              inbound_message_id, confirmation_wa_message_id, category_id
         from entries order by created_at, position`,
    )
  ).rows;

describe("lançamento por mensagem de texto (E7)", () => {
  it("grava o lançamento com origem, versão, uso de IA, e confirma com o formato padrão", async () => {
    const w = world({
      extractions: [
        {
          result: register([
            extracted({
              quantity: 5,
              quantity_unit: "kg",
              payment_method_hint: "pix",
              category_hint: "Insumos",
            }),
          ]),
        },
      ],
    });
    const { id } = await w.say(OWNER, "camarão 5kg 450 no pix");

    const [entry] = await entryRows();
    expect(entry).toMatchObject({
      description: "Camarão",
      amount_cents: "45000",
      net_cents: "45000",
      version: 1,
      inbound_message_id: id,
    });
    const versions = await db.admin.query("select action, channel from entry_versions");
    expect(versions.rows).toEqual([{ action: "create", channel: "whatsapp" }]);
    const usage = await db.admin.query("select inbound_message_id from ai_usage");
    expect(usage.rows).toEqual([{ inbound_message_id: id }]);

    const confirmation = await lastReply();
    expect(confirmation?.purpose).toBe("confirmation");
    expect(confirmation?.text).toContain("✅ Registrado (Matriz):");
    expect(confirmation?.text).toContain("Camarão, 5 kg: R$ 450,00");
    expect(confirmation?.text).toContain("Pix");
    expect(confirmation?.text).toContain("responda esta mensagem");
    expect(entry?.confirmation_wa_message_id).toBe(confirmation?.wa_message_id);
  });

  it("reprocessar a mesma mensagem não duplica lançamento nem confirmação", async () => {
    const w = world({ extractions: [{ result: register([extracted()]) }] });
    const first = await w.say(OWNER, "camarão 450");
    // Mensagem volta à fila (queda depois de gravar): o job roda de novo.
    await db.admin.query("update inbound_messages set status = 'processing' where id = $1", [
      first.id,
    ]);
    await first.run(1);

    expect(await entryRows()).toHaveLength(1);
    expect((await replies()).filter((reply) => reply.purpose === "confirmation")).toHaveLength(1);
    expect(w.extractor.calls).toHaveLength(1);
  });

  it("queda depois de gravar e antes de confirmar: o retry confirma sem nova chamada de IA", async () => {
    const w = world({ extractions: [{ result: register([extracted()]) }] });
    const first = await w.say(OWNER, "camarão 450");
    await db.admin.query("delete from outbound_messages");
    await db.admin.query("update inbound_messages set status = 'processing' where id = $1", [
      first.id,
    ]);
    await first.run(1);

    expect(await entryRows()).toHaveLength(1);
    expect((await lastReply())?.text).toContain("✅ Registrado");
    expect(w.extractor.calls).toHaveLength(1);
  });

  it("vários lançamentos viram uma confirmação só, na mesma ordem", async () => {
    const w = world({
      extractions: [
        {
          result: register([
            extracted({ description: "Óleo", total_cents: 18000 }),
            extracted({ description: "Gás", total_cents: 8000 }),
          ]),
        },
      ],
    });
    await w.say(OWNER, "óleo 180, gás 80");
    expect((await entryRows()).map((row) => row.description)).toEqual(["Óleo", "Gás"]);
    const confirmations = (await replies()).filter((reply) => reply.purpose === "confirmation");
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.text.indexOf("Óleo")).toBeLessThan(
      confirmations[0]?.text.indexOf("Gás") ?? 0,
    );
  });

  it("categoria desconhecida cai em 'Outras despesas' e avisa para revisar, sem perguntar", async () => {
    const w = world({
      extractions: [{ result: register([extracted({ category_hint: "coisa estranha" })]) }],
    });
    await w.say(OWNER, "camarão 450");
    const [entry] = await entryRows();
    expect(entry?.flags).toEqual(["category_to_review"]);
    expect((await lastReply())?.text).toContain("⚠️ Categoria a revisar: Camarão");
    expect((await replies()).filter((reply) => reply.purpose === "question")).toHaveLength(0);
  });

  it("repetir 'gás 80' em seguida recebe o sinal de possível duplicidade (CA08)", async () => {
    const w = world({
      extractions: [
        { result: register([extracted({ description: "Gás", total_cents: 8000 })]) },
        { result: register([extracted({ description: "Gás", total_cents: 8000 })]) },
      ],
    });
    await w.say(OWNER, "gás 80");
    await w.say(OWNER, "gás 80");
    const rows = await entryRows();
    expect(rows[1]?.flags).toContain("possible_duplicate");
    expect((await lastReply())?.text).toContain("⚠️ Possível duplicidade: Gás");
  });

  it("receita no iFood: a comissão do canal é a taxa e o líquido é calculado pelo sistema (CA01 do RF09)", async () => {
    const w = world({
      extractions: [
        {
          result: register([
            extracted({
              type: "revenue",
              description: "Vendas iFood",
              total_cents: 20000,
              sales_channel_hint: "ifood",
              payment_method_hint: "crédito",
            }),
          ]),
        },
      ],
    });
    await w.say(OWNER, "vendi 200 no ifood");
    const [entry] = await entryRows();
    expect(entry).toMatchObject({ fee_cents: "4600", net_cents: "15400" });
    expect((await lastReply())?.text).toContain("líquido R$ 154,00");
  });

  it("despesa paga no crédito não recebe taxa", async () => {
    const w = world({
      extractions: [{ result: register([extracted({ payment_method_hint: "cartão" })]) }],
    });
    await w.say(OWNER, "paguei 450 no cartão");
    expect((await entryRows())[0]).toMatchObject({ fee_cents: "0", net_cents: "45000" });
  });

  it("intenção fora do escopo recusa sem gravar nada, mas registra o custo", async () => {
    const w = world({
      extractions: [{ result: { intent: "out_of_scope", entries: [], question: null } }],
    });
    await w.say(OWNER, "qual a capital da França?");
    expect(await entryRows()).toEqual([]);
    expect((await lastReply())?.text).toContain("Eu só ajudo a registrar");
    expect((await db.admin.query("select 1 from ai_usage")).rows).toHaveLength(1);
  });

  it("IA com saída inválida duas vezes: nada é gravado e o usuário é avisado (CA09)", async () => {
    const w = world({ extractions: [{ error: "ExtractionInvalid" }] });
    await w.say(OWNER, "ahsdkjhas");
    expect(await entryRows()).toEqual([]);
    expect((await lastReply())?.text).toContain("Não consegui entender");
  });

  it("data futura: nada é gravado e a pergunta pede a data (CA07)", async () => {
    const tomorrow = businessDateOf(new Date(Date.now() + 36 * 3600_000));
    const w = world({
      extractions: [
        { result: register([extracted({ description: "Conta de luz", occurred_on: tomorrow })]) },
      ],
    });
    await w.say(OWNER, "paguei a luz amanhã 450");
    expect(await entryRows()).toEqual([]);
    const question = await lastReply();
    expect(question?.purpose).toBe("question");
    expect(question?.text).toContain("não aceito data futura");
  });
});

describe("pergunta de volta (RF15)", () => {
  const partial = () =>
    register(
      [
        extracted({ description: "Óleo", total_cents: 18000 }),
        extracted({ description: "Camarão", total_cents: null, missing_fields: ["amount"] }),
      ],
      "Qual foi o valor do camarão?",
    );

  it("grava o completo e pergunta só sobre o incompleto (CA04)", async () => {
    const w = world({ extractions: [{ result: partial() }] });
    await w.say(OWNER, "óleo 180, camarão");
    expect((await entryRows()).map((row) => row.description)).toEqual(["Óleo"]);
    const sent = await replies();
    expect(sent.map((reply) => reply.purpose)).toEqual(["confirmation", "question"]);
    expect(sent[1]?.text).toContain("Qual foi o valor do camarão?");
    const open = await db.admin.query("select status from pending_questions");
    expect(open.rows).toEqual([{ status: "open" }]);
  });

  it("a resposta completa o lançamento e fecha a pergunta", async () => {
    const w = world({
      extractions: [
        { result: partial() },
        { result: register([extracted({ description: "Camarão", total_cents: 45000 })]) },
      ],
    });
    await w.say(OWNER, "óleo 180, camarão");
    await w.say(OWNER, "450");
    expect((await entryRows()).map((row) => row.description)).toEqual(["Óleo", "Camarão"]);
    const status = await db.admin.query("select status from pending_questions");
    expect(status.rows).toEqual([{ status: "answered" }]);
    expect(w.extractor.calls[1]?.text).toContain("Resposta do usuário: 450");
  });

  it("lançamento novo no lugar da resposta cancela a pergunta com aviso (RF15.R6)", async () => {
    const w = world({
      extractions: [
        { result: partial() },
        { result: register([extracted({ description: "Gás", total_cents: 8000 })]) },
      ],
    });
    await w.say(OWNER, "óleo 180, camarão");
    await w.say(OWNER, "gás 80");
    const notices = (await replies()).filter((reply) => reply.text.startsWith("Deixei de lado"));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toContain("Camarão");
    expect((await db.admin.query("select status from pending_questions")).rows).toEqual([
      { status: "cancelled" },
    ]);
    expect((await entryRows()).map((row) => row.description)).toEqual(["Óleo", "Gás"]);
  });

  it("'cancelar' descarta o rascunho sem gravar (RF15.R7)", async () => {
    const w = world({ extractions: [{ result: partial() }] });
    await w.say(OWNER, "óleo 180, camarão");
    await w.say(OWNER, "cancelar");
    expect((await lastReply())?.text).toContain("descartei");
    expect((await db.admin.query("select status from pending_questions")).rows).toEqual([
      { status: "cancelled" },
    ]);
    expect((await entryRows()).map((row) => row.description)).toEqual(["Óleo"]);
  });

  it("pergunta expirada (24 h) não vale mais: a mensagem seguinte é um lançamento novo (RF15.R3)", async () => {
    const w = world({
      extractions: [
        { result: partial() },
        { result: register([extracted({ description: "Gás", total_cents: 8000 })]) },
      ],
    });
    await w.say(OWNER, "óleo 180, camarão");
    await db.admin.query("update pending_questions set expires_at = now() - interval '1 minute'");
    await w.say(OWNER, "gás 80");
    expect((await entryRows()).map((row) => row.description)).toEqual(["Óleo", "Gás"]);
    expect(w.extractor.calls[1]?.text).toBe("gás 80");
  });
});

describe("desfazer (RF18)", () => {
  it("desfaz a última mensagem e, repetindo, a anterior; depois não há mais nada", async () => {
    const w = world({
      extractions: [
        { result: register([extracted({ description: "Óleo", total_cents: 18000 })]) },
        {
          result: register([
            extracted({ description: "Gás", total_cents: 8000 }),
            extracted({ description: "Água", total_cents: 3000 }),
          ]),
        },
      ],
    });
    await w.say(OWNER, "óleo 180");
    await w.say(OWNER, "gás 80, água 30");

    await w.say(OWNER, "desfazer");
    expect((await lastReply())?.text).toContain("↩️ Desfeito:");
    expect((await lastReply())?.text).toContain("Gás");
    expect((await entryRows()).filter((row) => row.deleted_at === null)).toHaveLength(1);

    await w.say(OWNER, "Desfazer!");
    expect((await lastReply())?.text).toContain("Óleo");
    expect((await entryRows()).every((row) => row.deleted_at !== null)).toBe(true);

    await w.say(OWNER, "desfazer");
    expect((await lastReply())?.text).toContain(
      "Não encontrei lançamento seu nas últimas 24 horas",
    );

    const versions = await db.admin.query(
      "select action, channel from entry_versions where action = 'delete'",
    );
    expect(versions.rows).toHaveLength(3);
    expect(versions.rows.every((row) => row.channel === "whatsapp")).toBe(true);
  });

  it("como resposta a uma confirmação antiga, desfaz aquela, mesmo fora das 24 h (RF18.R2)", async () => {
    const w = world({
      extractions: [
        { result: register([extracted({ description: "Óleo", total_cents: 18000 })]) },
        { result: register([extracted({ description: "Gás", total_cents: 8000 })]) },
      ],
    });
    await w.say(OWNER, "óleo 180");
    const oldConfirmation = await lastReply();
    await w.say(OWNER, "gás 80");
    await db.admin.query("update entries set created_at = now() - interval '3 days'");

    await w.say(OWNER, "desfazer", oldConfirmation?.wa_message_id);
    const rows = await entryRows();
    expect(rows.find((row) => row.description === "Óleo")?.deleted_at).not.toBeNull();
    expect(rows.find((row) => row.description === "Gás")?.deleted_at).toBeNull();
  });

  it("não desfaz lançamento com mais de 24 h quando não há reply", async () => {
    const w = world({ extractions: [{ result: register([extracted()]) }] });
    await w.say(OWNER, "camarão 450");
    await db.admin.query("update entries set created_at = now() - interval '25 hours'");
    await w.say(OWNER, "desfazer");
    expect((await lastReply())?.text).toContain("últimas 24 horas");
    expect((await entryRows())[0]?.deleted_at).toBeNull();
  });

  it("o atendente não desfaz o lançamento de outra pessoa pela confirmação dela", async () => {
    const w = world({ extractions: [{ result: register([extracted()]) }] });
    await w.say(OWNER, "camarão 450");
    const ownerConfirmation = await lastReply();
    await w.say(STAFF, "desfazer", ownerConfirmation?.wa_message_id);
    expect((await lastReply())?.text).toContain("só pode mexer nos lançamentos que você mesmo fez");
    expect((await entryRows())[0]?.deleted_at).toBeNull();
  });
});

describe("correção por resposta (RF17)", () => {
  it("corrige o valor, gera versão 2 e confirma com '✏️ Corrigido'", async () => {
    const w = world({
      extractions: [{ result: register([extracted()]) }],
      corrections: [correct({ total_cents: 40000 })],
    });
    await w.say(OWNER, "camarão 450");
    const confirmation = await lastReply();
    await w.say(OWNER, "foi 400", confirmation?.wa_message_id);

    expect((await entryRows())[0]).toMatchObject({ amount_cents: "40000", version: 2 });
    expect((await lastReply())?.text).toContain("✏️ Corrigido:");
    expect((await lastReply())?.text).toContain("R$ 400,00");
    const versions = await db.admin.query(
      "select action, version from entry_versions order by version",
    );
    expect(versions.rows).toEqual([
      { action: "create", version: 1 },
      { action: "update", version: 2 },
    ]);
    expect(w.corrector.calls[0]?.entries[0]?.summary).toContain("R$ 450,00");
  });

  it("corrige um lançamento antigo pela confirmação dele, não pela última", async () => {
    const w = world({
      extractions: [
        { result: register([extracted({ description: "Óleo", total_cents: 18000 })]) },
        { result: register([extracted({ description: "Gás", total_cents: 8000 })]) },
      ],
      corrections: [correct({ total_cents: 19000 })],
    });
    await w.say(OWNER, "óleo 180");
    const oil = await lastReply();
    await w.say(OWNER, "gás 80");
    await w.say(OWNER, "foi 190", oil?.wa_message_id);
    const rows = await entryRows();
    expect(rows.find((row) => row.description === "Óleo")?.amount_cents).toBe("19000");
    expect(rows.find((row) => row.description === "Gás")?.amount_cents).toBe("8000");
  });

  it("com vários itens e nenhum citado, pergunta qual e não altera nada", async () => {
    const w = world({
      extractions: [
        {
          result: register([
            extracted({ description: "Óleo", total_cents: 18000 }),
            extracted({ description: "Gás", total_cents: 8000 }),
          ]),
        },
      ],
      corrections: [correct({ total_cents: 40000 })],
    });
    await w.say(OWNER, "óleo 180, gás 80");
    await w.say(OWNER, "foi 400", (await lastReply())?.wa_message_id);
    expect((await lastReply())?.text).toContain("Qual lançamento");
    expect((await entryRows()).map((row) => row.amount_cents)).toEqual(["18000", "8000"]);
  });

  it("o atendente que responde à confirmação de outra pessoa é recusado sem alterar nada (CA04)", async () => {
    const w = world({
      extractions: [{ result: register([extracted()]) }],
      corrections: [correct({ total_cents: 40000 })],
    });
    await w.say(OWNER, "camarão 450");
    await w.say(STAFF, "foi 400", (await lastReply())?.wa_message_id);
    expect((await lastReply())?.text).toContain("só pode mexer nos lançamentos que você mesmo fez");
    expect((await entryRows())[0]).toMatchObject({ amount_cents: "45000", version: 1 });
    expect(w.corrector.calls).toHaveLength(0);
  });

  it("não corrige lançamento que está na lixeira", async () => {
    const w = world({ extractions: [{ result: register([extracted()]) }] });
    await w.say(OWNER, "camarão 450");
    const confirmation = await lastReply();
    await w.say(OWNER, "desfazer");
    await w.say(OWNER, "foi 400", confirmation?.wa_message_id);
    expect((await lastReply())?.text).toContain("já foi desfeito");
  });
});

describe("falha definitiva (RF19.R4)", () => {
  it("na última tentativa avisa que NÃO foi registrado, e a mensagem fica failed", async () => {
    const w = world();
    // Sem resposta roteirizada: o extrator de teste lança, como uma queda da API de IA.
    const message = await w
      .say(OWNER, "camarão 450", undefined, 5)
      .catch((error: unknown) => error);
    expect(message).toBeInstanceOf(Error);
    const reply = await lastReply();
    expect(reply?.text).toContain("NÃO registrei");
    const status = await db.admin.query(
      "select status from inbound_messages order by received_at desc limit 1",
    );
    expect(status.rows[0]?.status).toBe("failed");
    expect(await entryRows()).toEqual([]);
  });

  it("nas tentativas intermediárias não avisa (o job só será retentado)", async () => {
    const w = world();
    await w.say(OWNER, "camarão 450", undefined, 1).catch(() => undefined);
    expect(await replies()).toEqual([]);
  });
});

const KEY = "35261012345678000190650010000001231000001235";
const QR_URL = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|ABCDEF`;
const OGG = { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg; codecs=opus" };
const JPEG = { bytes: new Uint8Array([4, 5, 6]), contentType: "image/jpeg" };

const usageRows = async () =>
  (
    await db.admin.query<{ provider: string; model: string; audio_seconds: number }>(
      "select provider, model, audio_seconds from ai_usage order by created_at, id",
    )
  ).rows;

describe("lançamento por áudio (RF13)", () => {
  it("baixa, guarda, transcreve e registra como texto, mostrando o trecho entendido", async () => {
    const w = world({
      files: { "dev.media.a1": OGG },
      audioSeconds: 20,
      transcripts: [{ text: "camarão cinco quilos quatrocentos e cinquenta no pix" }],
      extractions: [{ result: register([extracted({ payment_method_hint: "pix" })]) }],
    });
    const { id } = await w.sayMedia(OWNER, "audio", "dev.media.a1");

    expect((await entryRows()).map((row) => row.amount_cents)).toEqual(["45000"]);
    const confirmation = await lastReply();
    expect(confirmation?.text).toContain(
      'Entendi: "camarão cinco quilos quatrocentos e cinquenta no pix"',
    );
    expect(confirmation?.text).toContain("✅ Registrado");
    // O extrator recebe o texto transcrito, como se tivesse sido digitado.
    expect(w.extractor.calls[0]?.text).toBe("camarão cinco quilos quatrocentos e cinquenta no pix");

    const inbound = await db.admin.query<{ media_key: string; transcription: string }>(
      "select media_key, transcription from inbound_messages where id = $1",
      [id],
    );
    expect(inbound.rows[0]?.transcription).toContain("camarão");
    expect(inbound.rows[0]?.media_key.startsWith("0190a000-0000-7000-8000-000000000001/")).toBe(
      true,
    );
    expect(w.mediaStore.files.size).toBe(1);

    // Duas linhas de uso: transcrição em segundos e extração em tokens (RF13.Obs3, RNF08).
    const usage = await usageRows();
    expect(usage.map((row) => row.provider).sort()).toEqual(["fake", "openai"]);
    expect(usage.find((row) => row.provider === "openai")?.audio_seconds).toBe(20);
  });

  it("áudio de 200 s não é transcrito e nenhuma IA é chamada (CA02)", async () => {
    const w = world({ files: { "dev.media.a2": OGG }, audioSeconds: 200 });
    await w.sayMedia(OWNER, "audio", "dev.media.a2");
    expect((await lastReply())?.text).toContain("mais de 3 minutos");
    expect(w.transcriber.calls).toHaveLength(0);
    expect(w.extractor.calls).toHaveLength(0);
    expect(await entryRows()).toEqual([]);
  });

  it("áudio de exatamente 180 s ainda é aceito", async () => {
    const w = world({
      files: { "dev.media.a3": OGG },
      audioSeconds: 180,
      transcripts: [{ text: "gás 80" }],
      extractions: [{ result: register([extracted({ description: "Gás", total_cents: 8000 })]) }],
    });
    await w.sayMedia(OWNER, "audio", "dev.media.a3");
    expect(w.transcriber.calls).toHaveLength(1);
    expect(await entryRows()).toHaveLength(1);
  });

  it("transcrição vazia não grava nada e pede para repetir (Obs1)", async () => {
    const w = world({ files: { "dev.media.a4": OGG }, transcripts: [{ text: "" }] });
    await w.sayMedia(OWNER, "audio", "dev.media.a4");
    expect((await lastReply())?.text).toBe(
      "Não consegui entender o áudio. Pode repetir ou mandar por texto?",
    );
    expect(await entryRows()).toEqual([]);
    expect(w.extractor.calls).toHaveLength(0);
  });

  it("retry depois de transcrever não baixa, nem transcreve, nem duplica (custo medido uma vez)", async () => {
    const w = world({
      files: { "dev.media.a5": OGG },
      transcripts: [{ text: "gás 80" }],
      extractions: [{ result: register([extracted({ description: "Gás", total_cents: 8000 })]) }],
    });
    const first = await w.sayMedia(OWNER, "audio", "dev.media.a5");
    await db.admin.query("delete from outbound_messages");
    await db.admin.query("update inbound_messages set status = 'processing' where id = $1", [
      first.id,
    ]);
    await first.run(1);

    expect(w.downloads).toEqual(["dev.media.a5"]);
    expect(w.transcriber.calls).toHaveLength(1);
    expect(await entryRows()).toHaveLength(1);
    expect((await lastReply())?.text).toContain('Entendi: "gás 80"');
    expect((await usageRows()).filter((row) => row.provider === "openai")).toHaveLength(1);
  });

  it("falha de download na última tentativa avisa que NÃO foi registrado", async () => {
    const w = world({ files: {} });
    await w.sayMedia(OWNER, "audio", "dev.media.sumiu", { retry: 5 }).catch(() => undefined);
    expect((await lastReply())?.text).toContain("NÃO registrei");
  });
});

describe("lançamento por foto de nota (RF14)", () => {
  const items = () =>
    register([
      extracted({
        description: "Picanha",
        total_cents: 8000,
        category_hint: "Insumos",
        supplier_hint: "Atacadão",
      }),
      extracted({
        description: "Alcatra",
        total_cents: 6000,
        category_hint: "Insumos",
        supplier_hint: "Atacadão",
      }),
      extracted({
        description: "Botijão",
        total_cents: 12000,
        category_hint: "Gás",
        supplier_hint: "Atacadão",
      }),
    ]);

  it("lê a nota pela IA, agrupa por categoria e guarda a chave do QR para não duplicar", async () => {
    const w = world({
      files: { "dev.media.i1": JPEG },
      qr: QR_URL,
      extractions: [{ result: items() }],
    });
    await w.sayMedia(OWNER, "image", "dev.media.i1", { caption: "nota do mercado" });

    const rows = await entryRows();
    expect(rows.map((row) => [row.description, row.amount_cents])).toEqual([
      ["Atacadão – 2 itens", "14000"],
      ["Botijão", "12000"],
    ]);
    expect(w.extractor.calls[0]?.image).toEqual(JPEG);
    expect(w.extractor.calls[0]?.text).toBe("nota do mercado");

    const fiscal = await db.admin.query(
      "select access_key, source, needs_recheck from fiscal_documents where access_key = $1",
      [KEY],
    );
    expect(fiscal.rows).toEqual([{ access_key: KEY, source: "ai_reading", needs_recheck: true }]);
  });

  it("a mesma nota de novo não gera lançamento nem chama a IA (CA02 do RF14)", async () => {
    const w = world({
      files: { "dev.media.i2": JPEG },
      qr: QR_URL,
      extractions: [{ result: items() }],
    });
    await w.sayMedia(OWNER, "image", "dev.media.i2");
    await w.sayMedia(OWNER, "image", "dev.media.i2");

    expect(await entryRows()).toHaveLength(2);
    expect(w.extractor.calls).toHaveLength(1);
    expect((await lastReply())?.text).toMatch(
      /^Essa nota já foi registrada em \d{2}\/\d{2} por Dono Demo\.$/,
    );
  });

  it("outro restaurante pode registrar a mesma nota: a chave é única por empresa", async () => {
    const w = world({
      files: { "dev.media.i3": JPEG },
      qr: QR_URL,
      extractions: [{ result: items() }, { result: items() }],
    });
    await w.sayMedia(OWNER, "image", "dev.media.i3");
    // Usuária do segundo restaurante (vínculo mais antigo é o Demo; troca o vínculo no banco).
    const other = await db.admin.query<{ id: string }>(
      "select id from tenants where name = 'Restaurante Demo 2'",
    );
    const otherTenant = other.rows[0]?.id ?? "";
    await db.admin.query(
      "update memberships set deactivated_at = now() where user_id = (select id from users where phone_e164 = $1) and tenant_id <> $2",
      [DEV_PHONES.twoRestaurants, otherTenant],
    );
    await w.sayMedia(DEV_PHONES.twoRestaurants.replace("+", ""), "image", "dev.media.i3");

    const fiscal = await db.admin.query(
      "select tenant_id from fiscal_documents where access_key = $1",
      [KEY],
    );
    expect(fiscal.rows).toHaveLength(2);
    await db.admin.query("update memberships set deactivated_at = null");
  });

  it("imagem acima de 5 MB é recusada sem ler nem gravar", async () => {
    const big = { bytes: new Uint8Array(5 * 1024 * 1024 + 1), contentType: "image/jpeg" };
    const w = world({ files: { "dev.media.i4": big } });
    await w.sayMedia(OWNER, "image", "dev.media.i4");
    expect((await lastReply())?.text).toContain("passou de 5 MB");
    expect(w.extractor.calls).toHaveLength(0);
    expect(w.mediaStore.files.size).toBe(0);
  });

  it("valor ilegível: não grava nada e pede uma foto melhor (CA05)", async () => {
    const w = world({
      files: { "dev.media.i5": JPEG },
      qr: QR_URL,
      extractions: [
        {
          result: register(
            [
              extracted({ description: "Picanha", total_cents: 8000 }),
              extracted({
                description: "Item borrado",
                total_cents: null,
                missing_fields: ["amount"],
              }),
            ],
            "Qual o valor do item borrado?",
          ),
        },
      ],
    });
    await w.sayMedia(OWNER, "image", "dev.media.i5");
    expect(await entryRows()).toEqual([]);
    expect((await lastReply())?.text).toContain("Não consegui ler os valores da nota");
    expect(
      (await db.admin.query("select 1 from fiscal_documents where access_key = $1", [KEY])).rows,
    ).toEqual([]);
  });

  it("foto sem QR segue só pela leitura da IA, sem guardar chave", async () => {
    const w = world({
      files: { "dev.media.i6": JPEG },
      qr: null,
      extractions: [
        { result: register([extracted({ description: "Compra", total_cents: 5000 })]) },
      ],
    });
    await w.sayMedia(OWNER, "image", "dev.media.i6");
    expect(await entryRows()).toHaveLength(1);
    expect(
      (await db.admin.query("select 1 from fiscal_documents where access_key = $1", [KEY])).rows,
    ).toEqual([]);
  });

  it("foto que não é documento financeiro cai no fora de escopo", async () => {
    const w = world({
      files: { "dev.media.i7": JPEG },
      extractions: [{ result: { intent: "out_of_scope", entries: [], question: null } }],
    });
    await w.sayMedia(OWNER, "image", "dev.media.i7");
    expect(await entryRows()).toEqual([]);
    expect((await lastReply())?.text).toContain("Eu só ajudo a registrar");
  });
});

describe("limites de uso (RF21)", () => {
  const limits = { ...DEFAULT_USAGE_LIMITS, messagesPerUserPerHour: 3 };

  it("passa do limite por hora: avisa uma vez e não processa o excedente", async () => {
    const w = world({
      limits,
      extractions: [
        { result: register([extracted({ description: "A", total_cents: 100 })]) },
        { result: register([extracted({ description: "B", total_cents: 200 })]) },
        { result: register([extracted({ description: "C", total_cents: 300 })]) },
      ],
    });
    await w.say(OWNER, "a 1");
    await w.say(OWNER, "b 2");
    await w.say(OWNER, "c 3");
    await w.say(OWNER, "d 4");
    await w.say(OWNER, "e 5");

    expect(w.extractor.calls).toHaveLength(3);
    expect((await entryRows()).map((row) => row.description)).toEqual(["A", "B", "C"]);
    const warnings = (await replies()).filter((reply) => reply.text.startsWith("Recebi muitas"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toBe(
      "Recebi muitas mensagens seguidas. Aguarde alguns minutos e tente de novo.",
    );
  });

  it("o limite é por usuário: outra pessoa do mesmo restaurante continua atendida", async () => {
    const w = world({
      limits,
      extractions: [
        ...[1, 2, 3].map((n) => ({
          result: register([extracted({ description: `Do dono ${n}`, total_cents: 100 * n })]),
        })),
        { result: register([extracted({ description: "Do atendente", total_cents: 100 })]) },
      ],
    });
    // O dono passa do limite (4ª mensagem barrada); o atendente não é afetado.
    for (let index = 0; index < 4; index++) await w.say(OWNER, `msg ${index}`);
    await w.say(STAFF, "gás 80");
    expect((await entryRows()).map((row) => row.description)).toContain("Do atendente");
  });

  it("comandos também contam, mas a ajuda segue disponível dentro do limite", async () => {
    const w = world({ limits });
    await w.say(OWNER, "ajuda");
    expect((await lastReply())?.text).toContain("Eu registro as receitas");
  });
});

describe("lida e digitando (RF11.Obs3)", () => {
  it("marca como lida e mostra digitando antes de gastar IA", async () => {
    const events: string[] = [];
    const w = world({
      extractions: [{ result: register([extracted()]) }],
      wrapSender: (sender) => ({
        ...sender,
        async markAsRead(id) {
          events.push(`lida:${id.startsWith("dev.wamid.")}`);
          return sender.markAsRead(id);
        },
        async showTyping(id) {
          events.push(`digitando:${id.startsWith("dev.wamid.")}`);
          return sender.showTyping(id);
        },
      }),
    });
    await w.say(OWNER, "camarão 450");
    expect(events).toEqual(["lida:true", "digitando:true"]);
  });

  it("falha no 'lida' ou no 'digitando' nunca derruba o lançamento", async () => {
    const w = world({
      extractions: [{ result: register([extracted()]) }],
      wrapSender: (sender) => ({
        ...sender,
        async markAsRead() {
          throw new Error("meta fora do ar");
        },
        async showTyping() {
          throw new Error("meta fora do ar");
        },
      }),
    });
    await w.say(OWNER, "camarão 450");
    expect(await entryRows()).toHaveLength(1);
  });

  it("comando não gasta chamada de leitura nem de digitando", async () => {
    const events: string[] = [];
    const w = world({
      wrapSender: (sender) => ({
        ...sender,
        async markAsRead(id) {
          events.push("lida");
          return sender.markAsRead(id);
        },
      }),
    });
    await w.say(OWNER, "ajuda");
    expect(events).toEqual([]);
  });
});
