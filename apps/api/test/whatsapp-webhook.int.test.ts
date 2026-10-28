import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDatabase, createInboundIngestRepo, createPool } from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { signBody } from "@app/whatsapp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { InMemoryQueue } from "../src/infra/in-memory-queue";
import { createPgBossQueue, type PgBossQueue } from "../src/infra/pg-boss-queue";
import { createIngestWebhook } from "../src/modules/inbound/ingest-webhook";

const SECRET = "app-secret-de-teste";
const TOKEN = "verify-token-de-teste";

let db: TestDatabase;
let ingestPool: ReturnType<typeof createPool>;
let queue: PgBossQueue;
let app: ReturnType<typeof buildApp>;

function fixtureBytes(name: string): Buffer {
  const path = fileURLToPath(
    new URL(`../../../packages/whatsapp/test/fixtures/${name}.json`, import.meta.url),
  );
  return readFileSync(path);
}

function webhookApp(jobQueue: { enqueue: PgBossQueue["enqueue"] }) {
  const repo = createInboundIngestRepo(createDatabase(ingestPool));
  return buildApp(
    { LOG_LEVEL: "silent" },
    {
      whatsapp: {
        appSecret: SECRET,
        verifyToken: TOKEN,
        ingest: createIngestWebhook({ repo, queue: jobQueue }),
      },
    },
  );
}

function send(target: ReturnType<typeof buildApp>, body: Buffer) {
  return target.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signBody(body, SECRET),
    },
    payload: body,
  });
}

const count = async (sql: string) =>
  (await db.admin.query<{ n: number }>(sql)).rows[0]?.n ?? Number.NaN;
const messageRows = () => count("select count(*)::int as n from inbound_messages");
const statusRows = () => count("select count(*)::int as n from whatsapp_status_events");
const jobs = () =>
  count("select count(*)::int as n from pgboss.job where name = 'process-inbound'");

beforeAll(async () => {
  db = await startTestDatabase();
  ingestPool = createPool(db.urls.ingest);
  queue = await createPgBossQueue(db.urls.admin, (error) => {
    throw error;
  });
  app = webhookApp(queue);
});

afterAll(async () => {
  await app?.close();
  await queue?.stop();
  await ingestPool?.end();
  await db?.stop();
});

beforeEach(async () => {
  await db.admin.query("truncate inbound_messages, whatsapp_status_events cascade");
  await db.admin.query("delete from pgboss.job");
});

describe("webhook do WhatsApp com Postgres e pg-boss reais", () => {
  it("mensagem Teste assinada vira uma linha sem tenant e um job process-inbound", async () => {
    const response = await send(app, fixtureBytes("text-message"));
    expect(response.statusCode).toBe(200);

    const rows = await db.admin.query(
      "select wa_message_id, wa_id, wa_user_id, type, text, status, tenant_id, raw from inbound_messages",
    );
    expect(rows.rows).toMatchObject([
      {
        wa_message_id: "wamid.TEXTO1",
        wa_id: "551187654321",
        wa_user_id: "BR.1234567890123456",
        type: "text",
        text: "Teste",
        status: "received",
        tenant_id: null,
        raw: { message: { id: "wamid.TEXTO1" }, contact: { wa_id: "551187654321" } },
      },
    ]);
    expect(await jobs()).toBe(1);
    const job = await db.admin.query(
      "select data, singleton_key from pgboss.job where name = 'process-inbound'",
    );
    expect(job.rows[0]).toMatchObject({
      singleton_key: "wamid.TEXTO1",
      data: {
        waMessageId: "wamid.TEXTO1",
        inboundMessageId: rows.rows[0]?.id ?? expect.any(String),
      },
    });
  });

  it("o mesmo POST reenviado não duplica a linha nem o job", async () => {
    const body = fixtureBytes("text-message");
    expect((await send(app, body)).statusCode).toBe(200);
    expect((await send(app, body)).statusCode).toBe(200);
    expect(await messageRows()).toBe(1);
    expect(await jobs()).toBe(1);
  });

  it("entregas simultâneas do mesmo POST também geram uma linha e um job", async () => {
    const body = fixtureBytes("text-message");
    const responses = await Promise.all(Array.from({ length: 5 }, () => send(app, body)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(await messageRows()).toBe(1);
    expect(await jobs()).toBe(1);
  });

  it("lote misto grava todas as mensagens e todos os status do mesmo POST", async () => {
    expect((await send(app, fixtureBytes("batch-mixed"))).statusCode).toBe(200);
    expect(await messageRows()).toBe(3);
    expect(await statusRows()).toBe(1);
    expect(await jobs()).toBe(3);
  });

  it("lote reenviado com uma mensagem nova só enfileira a nova", async () => {
    await send(app, fixtureBytes("text-message"));
    await send(app, fixtureBytes("batch-mixed"));
    expect(await messageRows()).toBe(4);
    expect(await jobs()).toBe(4);
  });

  it("status failed 130497 fica gravado com o código e não gera job", async () => {
    expect((await send(app, fixtureBytes("status-failed-130497"))).statusCode).toBe(200);
    const rows = await db.admin.query(
      "select wa_message_id, status, error_code, recipient_id from whatsapp_status_events",
    );
    expect(rows.rows).toEqual([
      {
        wa_message_id: "wamid.SAIDA1",
        status: "failed",
        error_code: 130497,
        recipient_id: "551187654321",
      },
    ]);
    expect(await jobs()).toBe(0);
    expect(await messageRows()).toBe(0);
  });

  it("status reenviado não duplica, mas estados diferentes da mesma mensagem são gravados", async () => {
    await send(app, fixtureBytes("status-delivered"));
    await send(app, fixtureBytes("status-delivered"));
    await send(app, fixtureBytes("status-read"));
    expect(await statusRows()).toBe(2);
  });

  it("evento que não é de mensagens (account_update) responde 200 e não grava nada", async () => {
    expect((await send(app, fixtureBytes("non-message-field"))).statusCode).toBe(200);
    expect(await messageRows()).toBe(0);
    expect(await statusRows()).toBe(0);
    expect(await jobs()).toBe(0);
  });

  it("assinatura inválida não grava nada", async () => {
    const body = fixtureBytes("text-message");
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(await messageRows()).toBe(0);
    expect(await jobs()).toBe(0);
  });

  it("responde 200 em menos de 1 s com banco e fila reais", async () => {
    await send(app, fixtureBytes("status-read")); // aquece o pool e a conexão da fila
    const body = fixtureBytes("batch-mixed");
    const start = performance.now();
    const response = await send(app, body);
    const elapsed = performance.now() - start;
    expect(response.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("falha entre gravar e enfileirar", () => {
  it("fila fora do ar vira 500, e a reentrega da Meta recria o job sem duplicar a linha", async () => {
    const flaky = new InMemoryQueue();
    const flakyApp = webhookApp(flaky);
    const body = fixtureBytes("text-message");

    flaky.failWith = new Error("fila indisponível");
    expect((await send(flakyApp, body)).statusCode).toBe(500);
    expect(await messageRows()).toBe(1);
    expect(flaky.jobs).toHaveLength(0);

    expect((await send(flakyApp, body)).statusCode).toBe(200);
    expect(await messageRows()).toBe(1);
    expect(flaky.jobs).toHaveLength(1);
    await flakyApp.close();
  });

  it("mensagem que já saiu de received não é enfileirada de novo na reentrega", async () => {
    const memory = new InMemoryQueue();
    const memoryApp = webhookApp(memory);
    const body = fixtureBytes("text-message");
    await send(memoryApp, body);
    await db.admin.query("update inbound_messages set status = 'processed'");
    memory.jobs.length = 0; // o worker já consumiu o job

    expect((await send(memoryApp, body)).statusCode).toBe(200);
    expect(memory.jobs).toHaveLength(0);
    await memoryApp.close();
  });
});
