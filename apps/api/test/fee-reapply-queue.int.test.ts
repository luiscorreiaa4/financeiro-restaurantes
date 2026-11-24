import {
  createDatabase,
  createEntryStore,
  createFeeReapplyRepo,
  createPanelAccessStore,
  type FeeReapplyRepo,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureFeeReapplyQueues,
  FEE_REAPPLY_DLQ,
  type FeeReapplyQueueConfig,
} from "../src/infra/fee-reapply-queue";
import { startFeeReapplyWorker } from "../src/infra/fee-reapply-worker";
import { createLogger } from "../src/infra/logger";
import { createPgBossQueue } from "../src/infra/pg-boss-queue";
import { FEE_REAPPLY_QUEUE } from "../src/modules/fee-reapply/queues";
import {
  createFailStuckFeeReapply,
  createRunFeeReapply,
} from "../src/modules/fee-reapply/run-fee-reapply";

const FAST: FeeReapplyQueueConfig = {
  retryLimit: 1,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 30,
};

let db: TestDatabase;
let repo: FeeReapplyRepo;
const logger = createLogger("silent");
const clock = { now: () => new Date("2026-11-23T12:00:00Z"), today: () => "2026-11-23" };
const onError = (e: Error) => {
  throw e;
};

beforeAll(async () => {
  db = await startTestDatabase();
  repo = createFeeReapplyRepo(createDatabase(db.app));
});
afterAll(async () => {
  await db?.stop();
});

async function seed() {
  const tenantId = uuidv7();
  const userId = uuidv7();
  const unitId = uuidv7();
  const channelId = uuidv7();
  const methodId = uuidv7();
  const entryId = uuidv7();
  const q = (sql: string, p: unknown[]) => db.admin.query(sql, p);
  await q("insert into tenants (id, name) values ($1, 'T')", [tenantId]);
  await q("insert into units (id, tenant_id, name) values ($1, $2, 'M')", [unitId, tenantId]);
  await q("insert into users (id, name, phone_e164) values ($1, 'D', $2)", [
    userId,
    `+5511${String(700000000 + Math.floor(Math.random() * 1e8))}`,
  ]);
  await q(
    "insert into memberships (id, tenant_id, user_id, role, all_units) values ($1, $2, $3, 'owner', true)",
    [uuidv7(), tenantId, userId],
  );
  await q(
    "insert into sales_channels (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, 'Salão', 'dine_in', 0)",
    [channelId, tenantId],
  );
  await q(
    "insert into payment_methods (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, 'Crédito', 'credit', 320)",
    [methodId, tenantId],
  );
  await q(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents,
       net_cents, payment_method_id, sales_channel_id, created_by)
     values ($1, $2, $3, 'revenue', '2026-10-10', '2026-10-10', 'v', 10000, 10000, $4, $5, $6)`,
    [entryId, tenantId, unitId, methodId, channelId, userId],
  );
  const created = await repo.create(tenantId, {
    id: uuidv7(),
    createdBy: userId,
    targetKind: "payment_method",
    targetId: methodId,
    from: "2026-10-01",
    to: "2026-10-31",
    clientRequestId: uuidv7(),
  });
  if (created.kind !== "created") throw new Error("seed");
  return { tenantId, entryId, record: created.record };
}

async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe("filas de reaplicação de taxa", () => {
  it("ensureFeeReapplyQueues cria DLQ e fila, é idempotente e liga a DLQ", async () => {
    const boss = new PgBoss({ connectionString: db.urls.admin });
    await boss.start();
    await ensureFeeReapplyQueues(boss);
    await ensureFeeReapplyQueues(boss);
    expect(await boss.getQueue(FEE_REAPPLY_QUEUE)).toMatchObject({ deadLetter: FEE_REAPPLY_DLQ });
    await boss.stop({ graceful: false });
  });

  it("mesma singletonKey enfileirada duas vezes (reenfileirar no replay) vira um job só", async () => {
    const queue = await createPgBossQueue(db.urls.admin, onError);
    const key = uuidv7();
    try {
      await queue.enqueue(
        FEE_REAPPLY_QUEUE,
        { tenantId: uuidv7(), reapplicationId: key },
        { singletonKey: key },
      );
      await queue.enqueue(
        FEE_REAPPLY_QUEUE,
        { tenantId: uuidv7(), reapplicationId: key },
        { singletonKey: key },
      );
      const { rows } = await db.admin.query(
        "select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2",
        [FEE_REAPPLY_QUEUE, key],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await queue.stop();
    }
  });

  it("o worker consome o job, reaplica a taxa e a linha termina done", async () => {
    const { tenantId, entryId, record } = await seed();
    const appDb = createDatabase(db.app);
    const queue = await createPgBossQueue(db.urls.admin, onError);
    const worker = await startFeeReapplyWorker({
      connectionString: db.urls.admin,
      runFeeReapply: createRunFeeReapply({
        repo,
        store: createEntryStore(appDb),
        access: createPanelAccessStore(createDatabase(db.auth)),
        clock,
        logger,
      }),
      failStuck: createFailStuckFeeReapply({ repo, logger }),
      logger,
      onError,
      queueConfig: FAST,
      pollingIntervalSeconds: 0.5,
    });
    try {
      // Reenfileirar o mesmo job não duplica o efeito (singletonKey = id da linha).
      await queue.enqueue(
        FEE_REAPPLY_QUEUE,
        { tenantId, reapplicationId: record.id },
        { singletonKey: record.id },
      );
      await queue.enqueue(
        FEE_REAPPLY_QUEUE,
        { tenantId, reapplicationId: record.id },
        { singletonKey: record.id },
      );
      expect(
        await waitFor(async () => (await repo.get(tenantId, record.id))?.status === "done"),
      ).toBe(true);
      const versions = await db.admin.query("select * from entry_versions where entry_id = $1", [
        entryId,
      ]);
      expect(versions.rows).toHaveLength(1);
    } finally {
      await worker.stop({ graceful: false });
      await queue.stop();
    }
  });

  it("job na DLQ falha a linha presa; payload inválido não derruba o worker", async () => {
    const { tenantId, record } = await seed();
    const queue = await createPgBossQueue(db.urls.admin, onError);
    const worker = await startFeeReapplyWorker({
      connectionString: db.urls.admin,
      runFeeReapply: async () => "skipped",
      failStuck: createFailStuckFeeReapply({ repo, logger }),
      logger,
      onError,
      queueConfig: FAST,
      pollingIntervalSeconds: 0.5,
    });
    try {
      await queue.enqueue(FEE_REAPPLY_QUEUE, { lixo: true });
      await queue.enqueue(FEE_REAPPLY_DLQ, { tenantId, reapplicationId: record.id });
      expect(
        await waitFor(async () => (await repo.get(tenantId, record.id))?.status === "failed"),
      ).toBe(true);
      expect(await repo.get(tenantId, record.id)).toMatchObject({ errorCode: "job_failed" });
    } finally {
      await worker.stop({ graceful: false });
      await queue.stop();
    }
  });
});
