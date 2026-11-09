import {
  createFakeCorrectionExtractor,
  createFakeEntryExtractor,
  createFakeTranscriber,
} from "@app/ai";
import {
  type AudioConverter,
  DEFAULT_USAGE_LIMITS,
  type ExtractedEntry,
  type ExtractionResult,
  fail,
  type MediaDownloader,
  type QrCodeReader,
} from "@app/core";
import {
  createChoiceStore,
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
import { buildTextWebhookPayload, parseWebhook } from "@app/whatsapp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemClock } from "../src/infra/clock";
import { createDevMessageSender } from "../src/infra/dev-message-sender";
import { createLogger } from "../src/infra/logger";
import { createInMemoryMediaStore } from "../src/infra/media/local-media-store";
import { createEntryHandlers } from "../src/modules/entries/entry-handlers";
import { createFailureNotifier } from "../src/modules/inbound/notify-failure";
import { createProcessInbound } from "../src/modules/inbound/process-inbound";
import { createRouteInbound, defaultHandlers } from "../src/modules/inbound/route-inbound";
import {
  createPendingAnswerRouter,
  createSwitchHandlers,
} from "../src/modules/inbound/switch-handlers";

/**
 * `trocar unidade`, `trocar empresa` e a empresa citada no texto, de ponta a ponta (RF19.CA03,
 * RF11.R5, DE-25): banco, fila de estados e envio reais; só a IA é roteirizada.
 */
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
  await db.admin.query("update memberships set preferred_at = null");
  await db.admin.query(
    "update memberships set default_unit_id = '0190a000-0000-7000-8000-000000000011' where default_unit_id is not null",
  );
});

const extracted = (overrides: Partial<ExtractedEntry> = {}): ExtractedEntry => ({
  type: "expense",
  description: "Gás",
  occurred_on: null,
  paid_on: null,
  orders: null,
  asset_kind: null,
  asset_decision: null,
  quantity: null,
  quantity_unit: null,
  unit_price_cents: null,
  total_cents: 10000,
  category_hint: null,
  supplier_hint: null,
  payment_method_hint: null,
  sales_channel_hint: null,
  missing_fields: [],
  ...overrides,
});
const register = (unitHint: string | null = null): ExtractionResult => ({
  intent: "register",
  entries: [extracted()],
  question: null,
  unit_hint: unitHint,
});

function world(extractions: Parameters<typeof createFakeEntryExtractor>[0] = []) {
  const logger = createLogger("silent");
  const ingestDb = createDatabase(db.ingest);
  const appDb = createDatabase(db.app);
  const sender = createDevMessageSender({
    repo: createOutboundMessageRepo(ingestDb),
    nodeEnv: "test",
  });
  const clock = createSystemClock();
  const downloader: MediaDownloader = {
    async download() {
      return fail("MediaUnavailable", { detail: "arquivo_ausente" });
    },
  };
  const audioConverter: AudioConverter = {
    async toMp3() {
      return fail("MediaUnavailable", { detail: "sem_audio_neste_teste" });
    },
  };
  const qrReader: QrCodeReader = { read: () => null };
  const entryStore = createEntryStore(appDb);
  const entryHandlers = createEntryHandlers({
    store: entryStore,
    extractor: createFakeEntryExtractor(extractions),
    correctionExtractor: createFakeCorrectionExtractor([]),
    clock,
    media: {
      downloader,
      store: createInMemoryMediaStore(),
      inbound: createInboundMediaRepo(ingestDb),
      audioConverter,
      transcriber: createFakeTranscriber([]),
      qrReader,
      limits: DEFAULT_USAGE_LIMITS,
    },
    newId: uuidv7,
    logger,
  });
  const switchHandlers = createSwitchHandlers({
    choices: createChoiceStore(appDb),
    store: entryStore,
    clock,
    newId: uuidv7,
  });
  const route = createRouteInbound({
    directory: createSenderDirectory(ingestDb),
    senderRepo: createInboundSenderRepo(ingestDb),
    conversation: createTenantConversationRepo(appDb),
    sender,
    clock,
    handlers: {
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
    },
    supportContact: "suporte@exemplo.com.br",
    logger,
    usageGuard: { store: createUsageGuardStore(appDb), limits: DEFAULT_USAGE_LIMITS },
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

  async function say(waId: string, text: string) {
    const waMessageId = `dev.wamid.${uuidv7()}`;
    const [message] = parseWebhook(
      buildTextWebhookPayload({ waId, waMessageId, text, sentAt: new Date() }),
    ).messages;
    if (!message) throw new Error("payload do teste não gerou mensagem");
    const [stored] = await createInboundIngestRepo(ingestDb).saveMessages([message]);
    await processInbound(
      { inboundMessageId: stored?.id ?? "", waMessageId: message.waMessageId },
      { retryCount: 0, retryLimit: 5 },
    );
  }
  return { say };
}

const OWNER = DEV_PHONES.owner.replace("+", "");
const TWO = DEV_PHONES.twoRestaurants.replace("+", "");
const DEMO = "0190a000-0000-7000-8000-000000000001";
const DEMO_2 = "0190a000-0000-7000-8000-000000000002";
const PRAIA = "0190a000-0000-7000-8000-000000000013";
const MATRIZ_ID = "0190a000-0000-7000-8000-000000000011";

const lastReply = async () =>
  (
    await db.admin.query<{ purpose: string; text: string }>(
      "select purpose, text from outbound_messages order by created_at desc, id desc limit 1",
    )
  ).rows[0];
const lastEntry = async () =>
  (
    await db.admin.query<{ tenant_id: string; unit_id: string }>(
      "select tenant_id, unit_id from entries order by created_at desc limit 1",
    )
  ).rows[0];
const aiCalls = async () =>
  Number((await db.admin.query("select count(*) from ai_usage")).rows[0]?.count);

describe("trocar unidade (RF19.CA03)", () => {
  it("lista as unidades, grava a escolha e o próximo lançamento sem citar unidade vai para ela", async () => {
    const w = world([{ result: register() }]);
    await w.say(OWNER, "Trocar unidade");
    const list = await lastReply();
    expect(list?.purpose).toBe("question");
    expect(list?.text).toContain("1. Matriz");
    expect(list?.text).toContain("2. Praia");

    await w.say(OWNER, "2");
    expect((await lastReply())?.text).toBe("Pronto! Seus próximos lançamentos vão para Praia.");
    const saved = await db.admin.query(
      "select default_unit_id from memberships where tenant_id = $1 and user_id = '0190a000-0000-7000-8000-000000000021'",
      [DEMO],
    );
    expect(saved.rows[0]).toEqual({ default_unit_id: PRAIA });
    // Escolher não gasta IA.
    expect(await aiCalls()).toBe(0);

    await w.say(OWNER, "paguei 100 de gás");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: PRAIA });
    expect((await lastReply())?.text).toContain("Registrado (Praia)");
  });

  it("lançamento novo com a lista aberta descarta a lista com aviso e é registrado (DN-09)", async () => {
    const w = world([{ result: register() }]);
    await w.say(OWNER, "trocar unidade");
    await w.say(OWNER, "paguei 100 de gás");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: MATRIZ_ID });
    const status = await db.admin.query("select status from pending_questions");
    expect(status.rows).toEqual([{ status: "cancelled" }]);
    const texts = (
      await db.admin.query("select text from outbound_messages order by created_at, id")
    ).rows.map((row: { text: string }) => row.text);
    expect(texts.some((text) => text.includes("Deixei a troca de lado"))).toBe(true);
  });

  it("número fora da lista repete as opções e não grava nada", async () => {
    const w = world();
    await w.say(OWNER, "trocar unidade");
    await w.say(OWNER, "9");
    expect((await lastReply())?.text).toContain("Responda só com o número");
    expect((await lastReply())?.text).toContain("1. Matriz");
    await w.say(OWNER, "cancelar");
    expect(await aiCalls()).toBe(0);
    const open = await db.admin.query("select status from pending_questions");
    expect(open.rows).toEqual([{ status: "cancelled" }]);
  });
});

describe("trocar empresa (RF19, RF11.R5)", () => {
  it("a escolha vale para os próximos lançamentos, que passam a ir para a outra empresa", async () => {
    const w = world([{ result: register() }]);
    await w.say(TWO, "trocar empresa");
    const list = await lastReply();
    expect(list?.text).toContain("1. Restaurante Demo\n2. Restaurante Demo 2");

    await w.say(TWO, "2");
    expect((await lastReply())?.text).toBe(
      "Pronto! Seus próximos lançamentos vão para Restaurante Demo 2.",
    );

    await w.say(TWO, "paguei 100 de gás");
    expect((await lastEntry())?.tenant_id).toBe(DEMO_2);
    expect((await lastReply())?.text).toContain("Restaurante Demo 2 – Filial");
  });

  it("quem só tem uma empresa é avisado e nada é aberto", async () => {
    const w = world();
    await w.say(OWNER, "trocar empresa");
    expect((await lastReply())?.text).toContain("só tem acesso a um restaurante");
    const open = await db.admin.query("select 1 from pending_questions");
    expect(open.rows).toHaveLength(0);
  });
});

describe("empresa e unidade citadas no texto (RF11.R5)", () => {
  it("citar a outra empresa leva a mensagem e o lançamento para ela, sem trocar a padrão", async () => {
    const w = world([{ result: register() }]);
    await w.say(TWO, "gastei 100 de gás no restaurante demo 2");
    expect((await lastEntry())?.tenant_id).toBe(DEMO_2);
    const message = await db.admin.query("select tenant_id from inbound_messages");
    expect(message.rows).toEqual([{ tenant_id: DEMO_2 }]);
    const preferred = await db.admin.query(
      "select count(*) from memberships where preferred_at is not null",
    );
    expect(Number(preferred.rows[0]?.count)).toBe(0);
  });

  it("citar a unidade da empresa padrão pelo apelido grava nela", async () => {
    const w = world([{ result: register() }]);
    await w.say(TWO, "gastei 100 de gás no litoral");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: PRAIA });
  });
});

describe("unidade do lançamento (DE-25)", () => {
  const STAFF = DEV_PHONES.staff.replace("+", "");
  const MATRIZ = "0190a000-0000-7000-8000-000000000011";

  it("a unidade que a IA reconhece vale quando a mensagem a cita", async () => {
    const w = world([{ result: register("Praia") }]);
    await w.say(OWNER, "gastei 100 de gás lá na praia");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: PRAIA });
    expect((await lastReply())?.text).toContain("Registrado (Praia)");
  });

  it("a unidade casada no texto vale mais que a dica da IA", async () => {
    const w = world([{ result: register("Matriz") }]);
    await w.say(TWO, "gastei 100 de gás no litoral");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: PRAIA });
  });

  it("dica que não casa com nenhuma unidade usa a padrão", async () => {
    const w = world([{ result: register("Cozinha") }]);
    await w.say(OWNER, "gastei 100 de gás na cozinha");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: MATRIZ });
  });

  it("dica de unidade fora do acesso do colaborador usa a padrão dele", async () => {
    const w = world([{ result: register("Praia") }]);
    await w.say(STAFF, "gastei 100 de gás na praia");
    expect(await lastEntry()).toEqual({ tenant_id: DEMO, unit_id: MATRIZ });
  });
});
