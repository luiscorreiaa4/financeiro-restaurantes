import { entryFiltersSchema } from "@app/core/contracts";
import { createDatabase, createPanelAccessStore, exportsRepo, uuidv7, withTenant } from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInMemoryExportStore } from "../src/infra/exports/local-export-store";
import {
  DELETE_EXPORT_FILE_DLQ,
  type ExportQueuesConfig,
  ensureExportQueues,
  GENERATE_EXPORT_DLQ,
} from "../src/infra/exports-queue";
import { startExportWorker } from "../src/infra/exports-worker";
import { createLogger } from "../src/infra/logger";
import { createPgBossQueue } from "../src/infra/pg-boss-queue";
import { createDeleteExportFile } from "../src/modules/exports/delete-export-file";
import { createFailStuckExport } from "../src/modules/exports/fail-stuck-export";
import { createGenerateExport } from "../src/modules/exports/generate-export";
import { DELETE_EXPORT_FILE_QUEUE, GENERATE_EXPORT_QUEUE } from "../src/modules/exports/queues";

const FAST: ExportQueuesConfig = {
  generate: { retryLimit: 1, retryDelay: 0, retryBackoff: false, expireInSeconds: 30 },
  delete: {
    retryLimit: 1,
    retryDelay: 0,
    retryBackoff: false,
    expireInSeconds: 30,
    retentionSeconds: 8 * 86400,
  },
};

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});
afterAll(async () => {
  await db?.stop();
});

describe("filas de exportação", () => {
  it("ensureExportQueues cria DLQs e filas, é idempotente e converge a retenção", async () => {
    const boss = new PgBoss({ connectionString: db.urls.admin });
    await boss.start();
    await ensureExportQueues(boss);
    await ensureExportQueues(boss);
    const del = await boss.getQueue(DELETE_EXPORT_FILE_QUEUE);
    expect(del).toMatchObject({
      policy: "exclusive",
      deadLetter: DELETE_EXPORT_FILE_DLQ,
      retentionSeconds: 8 * 86400,
    });
    expect(await boss.getQueue(GENERATE_EXPORT_QUEUE)).toMatchObject({
      deadLetter: GENERATE_EXPORT_DLQ,
    });
    await boss.stop({ graceful: false });
  });

  it("o worker gera a exportação e agenda a limpeza para 7 dias", async () => {
    const tenantId = uuidv7();
    const unitId = uuidv7();
    const userId = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, 'T')", [tenantId]);
    await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'M')", [
      unitId,
      tenantId,
    ]);
    await db.admin.query(
      "insert into users (id, name, phone_e164) values ($1, 'D', '+5511977770001')",
      [userId],
    );
    await db.admin.query(
      "insert into memberships (id, tenant_id, user_id, role, all_units) values ($1, $2, $3, 'owner', true)",
      [uuidv7(), tenantId, userId],
    );
    const appDb = createDatabase(db.app);
    const exportId = uuidv7();
    await withTenant(appDb, tenantId, (tx) =>
      exportsRepo.insert(tx, {
        id: exportId,
        tenantId,
        requestedBy: userId,
        unitChoice: "all",
        format: "csv",
        content: "entries",
        filters: entryFiltersSchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
        clientRequestId: uuidv7(),
      }),
    );
    const onError = (e: Error) => {
      throw e;
    };
    const queue = await createPgBossQueue(db.urls.admin, onError);
    const logger = createLogger("silent");
    const store = createInMemoryExportStore();
    const worker = await startExportWorker({
      connectionString: db.urls.admin,
      generateExport: createGenerateExport({
        appDb,
        access: createPanelAccessStore(createDatabase(db.auth)),
        store,
        queue,
        clock: { now: () => new Date(), today: () => "2026-11-23" },
        logger,
      }),
      deleteExportFile: createDeleteExportFile({ appDb, store, logger }),
      failStuckExport: createFailStuckExport({ appDb, store, logger }),
      logger,
      onError,
      queuesConfig: FAST,
      pollingIntervalSeconds: 0.5,
    });
    try {
      await queue.enqueue(GENERATE_EXPORT_QUEUE, { tenantId, exportId });
      const deadline = Date.now() + 20_000;
      let status = "queued";
      while (status !== "ready" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        status =
          (await withTenant(appDb, tenantId, (tx) => exportsRepo.get(tx, exportId)))?.status ?? "";
      }
      expect(status).toBe("ready");
      const { rows } = await db.admin.query<{ seconds: number }>(
        `select extract(epoch from (start_after - now()))::int as seconds
           from pgboss.job where name = $1 and state = 'created'`,
        [DELETE_EXPORT_FILE_QUEUE],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.seconds).toBeGreaterThan(7 * 86400 - 120);
      expect(rows[0]?.seconds).toBeLessThanOrEqual(7 * 86400);
    } finally {
      await worker.stop({ graceful: false });
      await queue.stop();
    }
  });
});

describe("DLQ de generate-export com pg-boss real", () => {
  it("um job na DLQ marca o pedido preso em generating como failed", async () => {
    const tenantId = uuidv7();
    const unitId = uuidv7();
    const userId = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, 'T2')", [tenantId]);
    await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'M')", [
      unitId,
      tenantId,
    ]);
    await db.admin.query(
      "insert into users (id, name, phone_e164) values ($1, 'D', '+5511977770002')",
      [userId],
    );
    const appDb = createDatabase(db.app);
    const exportId = uuidv7();
    await withTenant(appDb, tenantId, async (tx) => {
      await exportsRepo.insert(tx, {
        id: exportId,
        tenantId,
        requestedBy: userId,
        unitChoice: "all",
        format: "xlsx",
        content: "entries",
        filters: entryFiltersSchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
        clientRequestId: uuidv7(),
      });
      await exportsRepo.markGenerating(tx, exportId);
    });
    const onError = (e: Error) => {
      throw e;
    };
    const queue = await createPgBossQueue(db.urls.admin, onError);
    const logger = createLogger("silent");
    const store = createInMemoryExportStore();
    const worker = await startExportWorker({
      connectionString: db.urls.admin,
      generateExport: async () => "skipped",
      deleteExportFile: async () => "skipped",
      failStuckExport: createFailStuckExport({ appDb, store, logger }),
      logger,
      onError,
      queuesConfig: FAST,
      pollingIntervalSeconds: 0.5,
    });
    try {
      await queue.enqueue(GENERATE_EXPORT_DLQ, { tenantId, exportId });
      const deadline = Date.now() + 20_000;
      let status = "generating";
      while (status === "generating" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        status =
          (await withTenant(appDb, tenantId, (tx) => exportsRepo.get(tx, exportId)))?.status ?? "";
      }
      expect(status).toBe("failed");
    } finally {
      await worker.stop({ graceful: false });
      await queue.stop();
    }
  });
});
