import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "../src/client";
import { EXPORTS_CLIENT_REQUEST_UNIQUE, exportsRepo } from "../src/exports-repo";
import { isUniqueViolation } from "../src/panel-entry-writer";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;
let otherUserId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
  otherUserId = uuidv7();
  await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Outro', $2)", [
    otherUserId,
    `+5511${String(700000000 + Math.floor(Math.random() * 1e6))}`,
  ]);
});

afterAll(async () => {
  await db?.stop();
});

async function newUser(): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'U', $2)", [
    id,
    `+5511${String(600000000 + Math.floor(Math.random() * 1e8))}`,
  ]);
  return id;
}

const appDb = () => createDatabase(db.app);
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(appDb(), a.tenantId, fn);

function input(f: TenantFixture, over: { requestedBy?: string; clientRequestId?: string } = {}) {
  return {
    id: uuidv7(),
    tenantId: f.tenantId,
    requestedBy: over.requestedBy ?? f.userId,
    unitChoice: "all",
    format: "csv" as const,
    content: "entries" as const,
    filters: {} as never,
    clientRequestId: over.clientRequestId ?? uuidv7(),
  };
}

describe("exportsRepo", () => {
  it("insere em queued e relê por id e por chave", async () => {
    const i = input(a);
    const rec = await inA((tx) => exportsRepo.insert(tx, i));
    expect(rec).toMatchObject({ id: i.id, status: "queued", rowCount: null, fileKey: null });
    expect(await inA((tx) => exportsRepo.get(tx, i.id))).toMatchObject({ id: i.id });
    const byKey = await inA((tx) =>
      exportsRepo.findByClientRequest(tx, a.userId, i.clientRequestId),
    );
    expect(byKey?.id).toBe(i.id);
    expect(
      await inA((tx) => exportsRepo.findByClientRequest(tx, otherUserId, i.clientRequestId)),
    ).toBeNull();
  });

  it("chave repetida do mesmo usuário viola o índice único", async () => {
    const i = input(a);
    await inA((tx) => exportsRepo.insert(tx, i));
    let error: unknown;
    try {
      await inA((tx) =>
        exportsRepo.insert(tx, { ...input(a), clientRequestId: i.clientRequestId }),
      );
    } catch (e) {
      error = e;
    }
    expect(isUniqueViolation(error, EXPORTS_CLIENT_REQUEST_UNIQUE)).toBe(true);
  });

  it("transições recusam a situação errada e devolvem false", async () => {
    const rec = await inA((tx) => exportsRepo.insert(tx, input(a)));
    const id = rec.id;
    const ready = {
      fileKey: `exports/${a.tenantId}/${id}.csv`,
      fileSize: 42,
      rowCount: 3,
      includedSensitive: false,
    };
    await inA(async (tx) => {
      expect(await exportsRepo.markReady(tx, id, ready)).toBe(false); // queued
      expect(await exportsRepo.markGenerating(tx, id)).toBe(true);
      expect(await exportsRepo.markGenerating(tx, id)).toBe(false); // já generating
      expect(await exportsRepo.markReady(tx, id, ready)).toBe(true);
      expect(await exportsRepo.markReady(tx, id, ready)).toBe(false); // já ready
      expect(await exportsRepo.markFailed(tx, id, "generation_failed")).toBe(false); // ready
      expect(await exportsRepo.markFileDeleted(tx, id)).toBe(true);
      expect(await exportsRepo.markFileDeleted(tx, id)).toBe(false);
    });
    const done = await inA((tx) => exportsRepo.get(tx, id));
    expect(done).toMatchObject({ status: "ready", fileSize: 42, rowCount: 3 });
    expect(done?.startedAt).not.toBeNull();
    expect(done?.finishedAt).not.toBeNull();
    expect(done?.fileDeletedAt).not.toBeNull();
  });

  it("markReady grava includedSensitive e get/listForUser o devolvem (true e false); o padrão é false", async () => {
    const withPayroll = await inA((tx) => exportsRepo.insert(tx, input(a)));
    const withoutPayroll = await inA((tx) => exportsRepo.insert(tx, input(a)));
    expect(withPayroll.includedSensitive).toBe(false);
    await inA(async (tx) => {
      for (const [record, includedSensitive] of [
        [withPayroll, true],
        [withoutPayroll, false],
      ] as const) {
        await exportsRepo.markGenerating(tx, record.id);
        await exportsRepo.markReady(tx, record.id, {
          fileKey: `exports/${a.tenantId}/${record.id}.csv`,
          fileSize: 1,
          rowCount: 1,
          includedSensitive,
        });
      }
    });
    expect((await inA((tx) => exportsRepo.get(tx, withPayroll.id)))?.includedSensitive).toBe(true);
    expect((await inA((tx) => exportsRepo.get(tx, withoutPayroll.id)))?.includedSensitive).toBe(
      false,
    );
    const listed = await inA((tx) =>
      exportsRepo.listForUser(tx, withPayroll.requestedBy, new Date(0)),
    );
    const flag = (id: string) => listed.find((r) => r.id === id)?.includedSensitive;
    expect(flag(withPayroll.id)).toBe(true);
    expect(flag(withoutPayroll.id)).toBe(false);
  });

  it("markFailed vale de queued e de generating, com o código", async () => {
    const q = await inA((tx) => exportsRepo.insert(tx, input(a)));
    const g = await inA((tx) => exportsRepo.insert(tx, input(a)));
    await inA(async (tx) => {
      expect(await exportsRepo.markFailed(tx, q.id, "forbidden")).toBe(true);
      expect(await exportsRepo.markFailed(tx, q.id, "forbidden")).toBe(false);
      await exportsRepo.markGenerating(tx, g.id);
      expect(await exportsRepo.markFailed(tx, g.id, "too_many_rows")).toBe(true);
    });
    expect(await inA((tx) => exportsRepo.get(tx, q.id))).toMatchObject({
      status: "failed",
      errorCode: "forbidden",
    });
    const gg = await inA((tx) => exportsRepo.get(tx, g.id));
    expect(gg).toMatchObject({ status: "failed", errorCode: "too_many_rows" });
    expect(gg?.finishedAt).not.toBeNull();
  });

  it("listForUser traz só o próprio usuário, desde a data, mais recentes primeiro", async () => {
    const fresh = await createTenant(db.admin, "Lista");
    const w = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(appDb(), fresh.tenantId, fn);
    const me = await newUser();
    const first = await w((tx) => exportsRepo.insert(tx, input(fresh, { requestedBy: me })));
    const second = await w((tx) => exportsRepo.insert(tx, input(fresh, { requestedBy: me })));
    await w((tx) => exportsRepo.insert(tx, input(fresh, { requestedBy: otherUserId })));
    await db.admin.query(
      "update exports set created_at = now() - interval '1 hour' where id = $1",
      [first.id],
    );
    const list = await w((tx) =>
      exportsRepo.listForUser(tx, me, new Date(Date.now() - 7 * 86_400_000)),
    );
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
    const none = await w((tx) => exportsRepo.listForUser(tx, me, new Date(Date.now() + 1000)));
    expect(none).toEqual([]);
  });

  it("countPending conta só queued e generating", async () => {
    const fresh = await createTenant(db.admin, "Pendentes");
    const w = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(appDb(), fresh.tenantId, fn);
    const me = await newUser();
    const ids: string[] = [];
    for (let n = 0; n < 4; n++)
      ids.push((await w((tx) => exportsRepo.insert(tx, input(fresh, { requestedBy: me })))).id);
    await w(async (tx) => {
      await exportsRepo.markGenerating(tx, ids[1] as string);
      await exportsRepo.markGenerating(tx, ids[2] as string);
      await exportsRepo.markReady(tx, ids[2] as string, {
        fileKey: "k",
        fileSize: 1,
        rowCount: 1,
        includedSensitive: false,
      });
      await exportsRepo.markFailed(tx, ids[3] as string, "forbidden");
    });
    expect(await w((tx) => exportsRepo.countPending(tx, me))).toBe(2);
    const stranger = await newUser();
    expect(await w((tx) => exportsRepo.countPending(tx, stranger))).toBe(0);
  });

  it("outro tenant não enxerga o pedido (RLS)", async () => {
    const rec = await inA((tx) => exportsRepo.insert(tx, input(a)));
    const seen = await withTenant(appDb(), b.tenantId, async (tx) => ({
      get: await exportsRepo.get(tx, rec.id),
      key: await exportsRepo.findByClientRequest(tx, a.userId, rec.id),
      list: await exportsRepo.listForUser(tx, a.userId, new Date(0)),
      pending: await exportsRepo.countPending(tx, a.userId),
      moved: await exportsRepo.markGenerating(tx, rec.id),
    }));
    expect(seen).toEqual({ get: null, key: null, list: [], pending: 0, moved: false });
  });

  it("audit grava em audit_log com ação, alvo e metadata", async () => {
    const id = uuidv7();
    await inA((tx) =>
      exportsRepo.audit(tx, {
        tenantId: a.tenantId,
        actorId: a.userId,
        action: "export_requested",
        exportId: id,
        metadata: { format: "csv", content: "entries" },
      }),
    );
    const { rows } = await db.admin.query(
      "select tenant_id, actor_id, action, target, metadata from audit_log where target = $1",
      [id],
    );
    expect(rows).toEqual([
      {
        tenant_id: a.tenantId,
        actor_id: a.userId,
        action: "export_requested",
        target: id,
        metadata: { format: "csv", content: "entries" },
      },
    ]);
  });
});
