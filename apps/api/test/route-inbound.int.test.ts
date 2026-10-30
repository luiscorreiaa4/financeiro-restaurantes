import {
  createDatabase,
  createInboundIngestRepo,
  createInboundProcessingRepo,
  createInboundSenderRepo,
  createOutboundMessageRepo,
  createSenderDirectory,
  createTenantConversationRepo,
  DEV_PHONES,
  seedDevData,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { buildTextWebhookPayload, parseWebhook } from "@app/whatsapp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDevMessageSender } from "../src/infra/dev-message-sender";
import { createLogger } from "../src/infra/logger";
import { createProcessInbound } from "../src/modules/inbound/process-inbound";
import {
  createRouteInbound,
  defaultHandlers,
  type RouteHandlers,
} from "../src/modules/inbound/route-inbound";

let db: TestDatabase;
const handlerCalls: string[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  await seedDevData(createDatabase(db.admin), "test");
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  handlerCalls.length = 0;
  await db.admin.query("truncate outbound_messages, whatsapp_opt_ins, inbound_messages cascade");
});

function buildProcessInbound() {
  const logger = createLogger("silent");
  const ingestDb = createDatabase(db.ingest);
  const handlers: RouteHandlers = {
    ...defaultHandlers(logger),
    correction: async (_ctx, target) => {
      handlerCalls.push(`correction:${target.outboundMessageId}`);
    },
    pendingAnswer: async () => {
      handlerCalls.push("pending_answer");
    },
    extract: async () => {
      handlerCalls.push("extract");
    },
  };
  const route = createRouteInbound({
    directory: createSenderDirectory(ingestDb),
    senderRepo: createInboundSenderRepo(ingestDb),
    conversation: createTenantConversationRepo(createDatabase(db.app)),
    sender: createDevMessageSender({
      repo: createOutboundMessageRepo(ingestDb),
      nodeEnv: "test",
    }),
    clock: { now: () => new Date() },
    handlers,
    supportContact: "suporte@exemplo.com.br",
    logger,
  });
  return createProcessInbound({
    repo: createInboundProcessingRepo(ingestDb),
    route,
    logger,
  });
}

/** Recebe como o webhook faz (payload da Cloud API → parser → ingestão) e processa. */
async function converse(waId: string, text: string, replyToWaMessageId?: string) {
  const waMessageId = `dev.wamid.${uuidv7()}`;
  const payload = buildTextWebhookPayload({
    waId,
    waMessageId,
    text,
    replyToWaMessageId,
    sentAt: new Date(),
  });
  const [message] = parseWebhook(payload).messages;
  if (!message) throw new Error("payload do teste não gerou mensagem");
  const [stored] = await createInboundIngestRepo(createDatabase(db.ingest)).saveMessages([message]);
  const id = stored?.id ?? "";
  const outcome = await buildProcessInbound()(
    { inboundMessageId: id, waMessageId },
    { retryCount: 0, retryLimit: 5 },
  );
  return { id, waMessageId, outcome };
}

const inboundRow = async (id: string) =>
  (
    await db.admin.query<{ status: string; tenant_id: string | null; user_id: string | null }>(
      "select status, tenant_id, user_id from inbound_messages where id = $1",
      [id],
    )
  ).rows[0];

const outboundRows = async () =>
  (
    await db.admin.query<{
      wa_message_id: string;
      to_wa_id: string;
      text: string;
      purpose: string;
      tenant_id: string | null;
      inbound_message_id: string;
      replied_to_wa_message_id: string;
    }>("select * from outbound_messages order by created_at, id")
  ).rows;

const digits = (phone: string) => phone.replace("+", "");

describe("roteamento ponta a ponta (webhook → fila → banco → resposta)", () => {
  it("número desconhecido recebe a resposta padrão, sem tenant e sem acionar nenhum ramo", async () => {
    const { id, outcome } = await converse("5511900000000", "paguei 350 de carne");
    expect(outcome).toBe("processed");
    expect(await inboundRow(id)).toMatchObject({
      status: "processed",
      tenant_id: null,
      user_id: null,
    });
    const [out] = await outboundRows();
    expect(out).toMatchObject({
      to_wa_id: "5511900000000",
      purpose: "notice",
      tenant_id: null,
      inbound_message_id: id,
    });
    expect(out?.text).toContain("Não encontrei este número cadastrado");
    expect(handlerCalls).toEqual([]);
    const optIns = await db.admin.query("select count(*)::int as n from whatsapp_opt_ins");
    expect(optIns.rows[0].n).toBe(0);
  });

  it("usuário desativado é tratado como desconhecido e não ganha opt-in", async () => {
    const { id } = await converse(digits(DEV_PHONES.deactivated), "ajuda");
    expect((await inboundRow(id))?.tenant_id).toBeNull();
    expect((await outboundRows())[0]?.text).toContain("Não encontrei este número cadastrado");
    const optIns = await db.admin.query("select count(*)::int as n from whatsapp_opt_ins");
    expect(optIns.rows[0].n).toBe(0);
  });

  it("dono cadastrado: mensagem ganha tenant e usuário, e o opt-in é gravado uma única vez", async () => {
    const first = await converse(digits(DEV_PHONES.owner), "ajuda");
    await converse(digits(DEV_PHONES.owner), "ajuda");
    const row = await inboundRow(first.id);
    expect(row?.tenant_id).not.toBeNull();
    expect(row?.user_id).not.toBeNull();
    const optIns = await db.admin.query("select source, inbound_message_id from whatsapp_opt_ins");
    expect(optIns.rows).toEqual([{ source: "first_message", inbound_message_id: first.id }]);
  });

  it("ajuda responde com exemplos e o suporte, sem chamar a IA", async () => {
    await converse(digits(DEV_PHONES.manager), "Ajuda!");
    const [out] = await outboundRows();
    expect(out).toMatchObject({ purpose: "help" });
    expect(out?.text).toContain("desfazer");
    expect(out?.text).toContain("suporte@exemplo.com.br");
    expect(handlerCalls).toEqual([]);
  });

  it("desfazer responde o provisório da E5", async () => {
    await converse(digits(DEV_PHONES.staff), "desfazer");
    expect((await outboundRows())[0]?.text).toBe("Ainda não há nada para desfazer.");
  });

  it("wa_id sem o 9º dígito acha o usuário e a resposta vai para o número com 9", async () => {
    const { id } = await converse("551187650001", "ajuda");
    expect((await inboundRow(id))?.tenant_id).not.toBeNull();
    expect((await outboundRows())[0]?.to_wa_id).toBe("5511987650001");
  });

  it("usuário em dois restaurantes cai no mais antigo", async () => {
    const { id } = await converse(digits(DEV_PHONES.twoRestaurants), "ajuda");
    const { rows } = await db.admin.query(
      "select t.name from inbound_messages m join tenants t on t.id = m.tenant_id where m.id = $1",
      [id],
    );
    expect(rows[0].name).toBe("Restaurante Demo");
  });

  it("figurinha ou texto vazio pedem texto, áudio ou foto", async () => {
    await converse(digits(DEV_PHONES.owner), "   ");
    expect((await outboundRows())[0]?.text).toContain("texto, áudio e foto de nota");
  });

  it("mensagem comum vai para a extração e ainda não gera resposta ao usuário", async () => {
    await converse(digits(DEV_PHONES.owner), "paguei 350 de carne no açougue");
    expect(handlerCalls).toEqual(["extract"]);
    expect(await outboundRows()).toEqual([]);
  });

  it("reply à confirmação certa e a uma antiga aciona a correção da mensagem citada", async () => {
    const tenant = await db.admin.query<{ id: string }>(
      "select id from tenants where name = 'Restaurante Demo'",
    );
    const tenantId = tenant.rows[0]?.id ?? "";
    // Uma mensagem de origem por confirmação: só pode haver uma confirmação por origem.
    const originAntiga = await converse(digits(DEV_PHONES.owner), "ajuda");
    const originAtual = await converse(digits(DEV_PHONES.owner), "ajuda");
    const insertConfirmation = async (waMessageId: string, originId: string) => {
      const id = uuidv7();
      await db.admin.query(
        `insert into outbound_messages (id, tenant_id, inbound_message_id, wa_message_id, to_wa_id, purpose, text)
         values ($1, $2, $3, $4, $5, 'confirmation', 'Registrado')`,
        [id, tenantId, originId, waMessageId, digits(DEV_PHONES.owner)],
      );
      return id;
    };
    const antiga = await insertConfirmation("dev.out.antiga", originAntiga.id);
    const atual = await insertConfirmation("dev.out.atual", originAtual.id);

    await converse(digits(DEV_PHONES.owner), "era 50", "dev.out.atual");
    await converse(digits(DEV_PHONES.owner), "era 60", "dev.out.antiga");
    expect(handlerCalls).toEqual([`correction:${atual}`, `correction:${antiga}`]);
  });

  it("reply a uma confirmação de outro restaurante é tratado como mensagem comum", async () => {
    const other = await db.admin.query<{ id: string }>(
      "select id from tenants where name = 'Restaurante Demo 2'",
    );
    const origin = await converse(digits(DEV_PHONES.twoRestaurants), "ajuda");
    await db.admin.query(
      `insert into inbound_messages (id, tenant_id, wa_message_id, type, raw)
       values ($1, $2, 'dev.wamid.outro', 'text', '{}')`,
      [uuidv7(), other.rows[0]?.id],
    );
    const outroInbound = await db.admin.query<{ id: string }>(
      "select id from inbound_messages where wa_message_id = 'dev.wamid.outro'",
    );
    await db.admin.query(
      `insert into outbound_messages (id, tenant_id, inbound_message_id, wa_message_id, to_wa_id, purpose, text)
       values ($1, $2, $3, 'dev.out.do-outro', '5511900000000', 'confirmation', 'Registrado')`,
      [uuidv7(), other.rows[0]?.id, outroInbound.rows[0]?.id],
    );
    expect(origin.outcome).toBe("processed");
    await converse(digits(DEV_PHONES.twoRestaurants), "era 50", "dev.out.do-outro");
    expect(handlerCalls).toEqual(["extract"]);
  });

  it("reprocessar a mesma mensagem não duplica resposta nem opt-in", async () => {
    const { id, waMessageId, outcome } = await converse(digits(DEV_PHONES.owner), "ajuda");
    expect(outcome).toBe("processed");
    const again = await buildProcessInbound()(
      { inboundMessageId: id, waMessageId },
      { retryCount: 1, retryLimit: 5 },
    );
    expect(again).toBe("skipped");
    expect(await outboundRows()).toHaveLength(1);
    const optIns = await db.admin.query("select count(*)::int as n from whatsapp_opt_ins");
    expect(optIns.rows[0].n).toBe(1);
  });

  it("pergunta pendente do usuário desvia a próxima mensagem para a resposta dela", async () => {
    const origin = await converse(digits(DEV_PHONES.owner), "ajuda");
    const row = await inboundRow(origin.id);
    await db.admin.query(
      `insert into pending_questions (id, tenant_id, user_id, inbound_message_id, draft, question, expires_at)
       values ($1, $2, $3, $4, '{}', 'Qual o valor?', now() + interval '1 hour')`,
      [uuidv7(), row?.tenant_id, row?.user_id, origin.id],
    );
    await converse(digits(DEV_PHONES.owner), "foi no pix");
    expect(handlerCalls).toEqual(["pending_answer"]);
  });
});
