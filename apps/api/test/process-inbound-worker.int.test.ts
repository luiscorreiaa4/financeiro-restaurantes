import { createDatabase, createInboundProcessingRepo, createPool, uuidv7 } from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/infra/logger";
import { createPgBossQueue, type PgBossQueue } from "../src/infra/pg-boss-queue";
import { type ProcessInboundWorker, startProcessInboundWorker } from "../src/infra/pg-boss-worker";
import {
  ensureProcessInboundQueues,
  PROCESS_INBOUND_DLQ,
  PROCESS_INBOUND_QUEUE_CONFIG,
  type ProcessInboundQueueConfig,
} from "../src/infra/process-inbound-queue";
import { PROCESS_INBOUND_QUEUE } from "../src/modules/inbound/ingest-webhook";
import {
  createProcessInbound,
  type ProcessInbound,
  type RouteInbound,
} from "../src/modules/inbound/process-inbound";

/** Retry imediato e expiração de 1 s, para os testes não esperarem minutos. */
const FAST: ProcessInboundQueueConfig = {
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 1,
};

let db: TestDatabase;
let ingestPool: ReturnType<typeof createPool>;
let queue: PgBossQueue;
const workers: ProcessInboundWorker[] = [];
const releases: Array<() => void> = [];

const logger = createLogger("silent");
const onError = (error: Error) => {
  throw error;
};

beforeAll(async () => {
  db = await startTestDatabase();
  ingestPool = createPool(db.urls.ingest);
  // O esquema `pgboss` só nasce no primeiro `start()`; o `beforeEach` precisa dele.
  const boss = new PgBoss({ connectionString: db.urls.admin });
  await boss.start();
  await boss.stop({ graceful: false });
});

afterAll(async () => {
  await ingestPool?.end();
  await db?.stop();
});

beforeEach(async () => {
  await db.admin.query("truncate inbound_messages cascade");
  await db.admin.query("delete from pgboss.job");
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const worker of workers.splice(0)) await worker.stop({ graceful: false });
  await queue?.stop();
});

async function insertMessage(text = "Teste"): Promise<string> {
  const waMessageId = `wamid.${crypto.randomUUID()}`;
  const { rows } = await db.admin.query<{ id: string }>(
    `insert into inbound_messages (id, wa_message_id, wa_id, type, text, raw)
     values ($1, $2, '551187654321', 'text', $3, '{}') returning id`,
    [uuidv7(), waMessageId, text],
  );
  return rows[0]?.id ?? "";
}

async function enqueueMessage(id: string) {
  const { rows } = await db.admin.query<{ wa_message_id: string }>(
    "select wa_message_id from inbound_messages where id = $1",
    [id],
  );
  const waMessageId = rows[0]?.wa_message_id ?? "";
  return queue.enqueue(
    PROCESS_INBOUND_QUEUE,
    { inboundMessageId: id, waMessageId },
    { singletonKey: waMessageId },
  );
}

async function startQueue(config: ProcessInboundQueueConfig) {
  queue = await createPgBossQueue(db.urls.admin, onError, config);
}

async function startWorker(route: RouteInbound, config: ProcessInboundQueueConfig = FAST) {
  const repo = createInboundProcessingRepo(createDatabase(ingestPool));
  const processInbound: ProcessInbound = createProcessInbound({ repo, route, logger });
  const worker = await startProcessInboundWorker({
    connectionString: db.urls.admin,
    processInbound,
    logger,
    onError,
    queueConfig: config,
    pollingIntervalSeconds: 0.5,
  });
  workers.push(worker);
  return worker;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value)) {
    if (Date.now() > deadline) {
      throw new Error(`tempo esgotado esperando condição; último valor: ${JSON.stringify(value)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

const statusOf = async (id: string) =>
  (
    await db.admin.query<{ status: string; error: string | null }>(
      "select status, error from inbound_messages where id = $1",
      [id],
    )
  ).rows[0];

const jobStates = async (name: string) =>
  (
    await db.admin.query<{ state: string }>(
      "select state from pgboss.job where name = $1 order by created_on",
      [name],
    )
  ).rows.map((row) => row.state);

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  releases.push(resolve);
  return { promise, resolve };
}

describe("configuração da fila process-inbound", () => {
  it("converge uma fila criada pela E3 (só policy exclusive) para retry, backoff e DLQ", async () => {
    const boss = new PgBoss({ connectionString: db.urls.admin });
    await boss.start();
    await boss.createQueue(PROCESS_INBOUND_QUEUE, { policy: "exclusive" });
    await ensureProcessInboundQueues(boss);
    await ensureProcessInboundQueues(boss); // idempotente

    const configured = await boss.getQueue(PROCESS_INBOUND_QUEUE);
    expect(configured).toMatchObject({
      policy: "exclusive",
      deadLetter: PROCESS_INBOUND_DLQ,
      retryLimit: PROCESS_INBOUND_QUEUE_CONFIG.retryLimit,
      retryDelay: PROCESS_INBOUND_QUEUE_CONFIG.retryDelay,
      retryBackoff: true,
      expireInSeconds: PROCESS_INBOUND_QUEUE_CONFIG.expireInSeconds,
    });
    expect(await boss.getQueue(PROCESS_INBOUND_DLQ)).not.toBeNull();
    await boss.stop({ graceful: false });
  });
});

describe("worker process-inbound com Postgres e pg-boss reais", () => {
  it("mensagem enfileirada é processada uma vez e o job termina completed", async () => {
    await startQueue(FAST);
    const calls: string[] = [];
    await startWorker(async (message) => {
      calls.push(message.id);
    });
    const id = await insertMessage();
    await enqueueMessage(id);

    await waitFor(
      () => statusOf(id),
      (row) => row?.status === "processed",
    );
    expect(calls).toEqual([id]);
    await waitFor(
      () => jobStates(PROCESS_INBOUND_QUEUE),
      (states) => states.join() === "completed",
    );
  });

  it("erro transitório é retentado e a mensagem termina processed sem duplicar", async () => {
    await startQueue(FAST);
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
      if (calls === 1) throw new Error("falha transitória");
    });
    const id = await insertMessage();
    await enqueueMessage(id);

    await waitFor(
      () => statusOf(id),
      (row) => row?.status === "processed",
    );
    expect(calls).toBe(2);
    expect(await jobStates(PROCESS_INBOUND_DLQ)).toEqual([]);
  });

  it("esgotar as tentativas marca failed com código curto e leva o job à DLQ", async () => {
    await startQueue(FAST);
    let calls = 0;
    await startWorker(async (message) => {
      calls += 1;
      throw new Error(`não consegui ler: ${message.text}`);
    });
    const id = await insertMessage("texto sigiloso do cliente");
    await enqueueMessage(id);

    await waitFor(
      () => statusOf(id),
      (row) => row?.status === "failed",
    );
    expect(calls).toBe(FAST.retryLimit + 1);
    expect(await statusOf(id)).toEqual({ status: "failed", error: "Error" });
    await waitFor(
      () => jobStates(PROCESS_INBOUND_DLQ),
      (states) => states.length === 1,
    );
    const dlq = await db.admin.query("select data from pgboss.job where name = $1", [
      PROCESS_INBOUND_DLQ,
    ]);
    expect(JSON.stringify(dlq.rows)).not.toContain("sigiloso");
  });

  it("job com payload inválido vai direto para a DLQ, sem retentar", async () => {
    await startQueue(FAST);
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
    });
    await queue.enqueue(PROCESS_INBOUND_QUEUE, { lixo: true }, { singletonKey: "invalido" });

    await waitFor(
      () => jobStates(PROCESS_INBOUND_DLQ),
      (states) => states.length === 1,
    );
    expect(calls).toBe(0);
  });

  it("reenfileirar uma mensagem já processada não repete o processamento", async () => {
    await startQueue(FAST);
    let calls = 0;
    await startWorker(async () => {
      calls += 1;
    });
    const id = await insertMessage();
    await enqueueMessage(id);
    await waitFor(
      () => jobStates(PROCESS_INBOUND_QUEUE),
      (states) => states.join() === "completed",
    );

    await enqueueMessage(id);
    await waitFor(
      () => jobStates(PROCESS_INBOUND_QUEUE),
      (states) => states.length === 2 && states.every((state) => state === "completed"),
    );
    expect(calls).toBe(1);
    expect((await statusOf(id))?.status).toBe("processed");
  });

  it("dois workers nunca processam a mesma mensagem", async () => {
    await startQueue(FAST);
    const seen = new Map<string, number>();
    const route: RouteInbound = async (message) => {
      seen.set(message.id, (seen.get(message.id) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    await startWorker(route);
    await startWorker(route);

    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) ids.push(await insertMessage(`m${i}`));
    await Promise.all(ids.map((id) => enqueueMessage(id)));

    await waitFor(
      async () => (await db.admin.query("select status from inbound_messages")).rows,
      (rows) => rows.every((row) => row.status === "processed"),
    );
    expect(seen.size).toBe(20);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it("encerramento limpo no meio de um job espera ele terminar", async () => {
    await startQueue(FAST);
    const started = deferred();
    const finish = deferred();
    const worker = await startWorker(
      async () => {
        started.resolve();
        await finish.promise;
      },
      { ...FAST, expireInSeconds: 60 },
    );
    const id = await insertMessage();
    await enqueueMessage(id);
    await started.promise;

    let stopped = false;
    const stopping = worker.stop({ graceful: true, timeout: 10_000 }).then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(stopped).toBe(false); // ainda esperando o job em andamento
    expect((await statusOf(id))?.status).toBe("processing");

    finish.resolve();
    await stopping;
    expect((await statusOf(id))?.status).toBe("processed");
    expect(await jobStates(PROCESS_INBOUND_QUEUE)).toEqual(["completed"]);
  });

  it("worker derrubado no meio: outro worker conclui a mensagem sem duplicar nem perder", async () => {
    await startQueue(FAST);
    const started = deferred();
    const hang = deferred();
    const workerA = await startWorker(async () => {
      started.resolve();
      await hang.promise; // nunca termina: simula o processo morrendo no meio
    });
    const id = await insertMessage();
    await enqueueMessage(id);
    await started.promise;
    expect((await statusOf(id))?.status).toBe("processing");
    await workerA.stop({ graceful: false });

    const calls: string[] = [];
    await startWorker(async (message) => {
      calls.push(message.id);
    });
    // O job do worker caído expira (1 s) e a supervisão o devolve à fila.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const ops = new PgBoss({ connectionString: db.urls.admin });
    await ops.start();
    await ops.supervise(PROCESS_INBOUND_QUEUE);
    await ops.stop({ graceful: false });

    await waitFor(
      () => statusOf(id),
      (row) => row?.status === "processed",
    );
    expect(calls).toEqual([id]);

    hang.resolve(); // o worker "morto" acordar não pode desfazer nem repetir nada
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await statusOf(id))?.status).toBe("processed");
    expect(calls).toEqual([id]);
  });
});
