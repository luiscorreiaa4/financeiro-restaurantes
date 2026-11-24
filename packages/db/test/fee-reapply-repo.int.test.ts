import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createFeeReapplyRepo } from "../src/fee-reapply-repo";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
});

afterAll(async () => {
  await db?.stop();
});

const repo = () => createFeeReapplyRepo(createDatabase(db.app));

async function addMethod(f: TenantFixture, name: string, bp = 320, fixed = 0): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into payment_methods (id, tenant_id, name, type, fee_percent_bp, fee_fixed_cents)
     values ($1, $2, $3, 'credit', $4, $5)`,
    [id, f.tenantId, name, bp, fixed],
  );
  return id;
}

const input = (
  targetId: string,
  clientRequestId = uuidv7(),
  over: Record<string, unknown> = {},
) => ({
  id: uuidv7(),
  createdBy: a.userId,
  targetKind: "payment_method" as const,
  targetId,
  from: "2026-10-01",
  to: "2026-10-31",
  clientRequestId,
  ...over,
});

describe("FeeReapplyRepo.create", () => {
  it("grava a linha queued com a taxa vista agora e responde created", async () => {
    const pm = await addMethod(a, "Visa", 320, 10);
    const result = await repo().create(a.tenantId, input(pm));
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.record).toMatchObject({
      status: "queued",
      feePercentBp: 320,
      feeFixedCents: 10,
      targetKind: "payment_method",
      targetId: pm,
    });
  });

  it("mesma chave do mesmo autor: replayed, uma linha só", async () => {
    const pm = await addMethod(a, "Master", 300);
    const key = uuidv7();
    const first = await repo().create(a.tenantId, input(pm, key));
    const again = await repo().create(a.tenantId, input(pm, key));
    expect(first.kind).toBe("created");
    expect(again.kind).toBe("replayed");
    if (first.kind === "unknown_target" || again.kind === "unknown_target") throw new Error("x");
    expect(again.record.id).toBe(first.record.id);
    const rows = await db.admin.query(
      "select count(*)::int as n from fee_reapplications where target_id = $1",
      [pm],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("mesma chave com outro alvo ainda replica o primeiro registro", async () => {
    const pm1 = await addMethod(a, "Elo", 300);
    const pm2 = await addMethod(a, "Hiper", 300);
    const key = uuidv7();
    const first = await repo().create(a.tenantId, input(pm1, key));
    const again = await repo().create(a.tenantId, input(pm2, key));
    expect(again.kind).toBe("replayed");
    if (first.kind !== "created" || again.kind !== "replayed") throw new Error("x");
    expect(again.record.id).toBe(first.record.id);
  });

  it("alvo ativo: in_progress com a linha atual; outro alvo não bloqueia", async () => {
    const pm = await addMethod(a, "Amex", 300);
    const other = await addMethod(a, "Diners", 300);
    const first = await repo().create(a.tenantId, input(pm));
    const blocked = await repo().create(a.tenantId, input(pm));
    expect(blocked.kind).toBe("in_progress");
    if (first.kind !== "created" || blocked.kind !== "in_progress") throw new Error("x");
    expect(blocked.record.id).toBe(first.record.id);
    expect((await repo().create(a.tenantId, input(other))).kind).toBe("created");
  });

  it("depois de done ou failed o alvo volta a aceitar", async () => {
    const pm = await addMethod(a, "Sodexo", 300);
    const first = await repo().create(a.tenantId, input(pm));
    if (first.kind !== "created") throw new Error("x");
    expect(await repo().markFailed(a.tenantId, first.record.id, "rate_changed")).toBe(true);
    expect((await repo().create(a.tenantId, input(pm))).kind).toBe("created");
  });

  it("alvo inexistente, de outra empresa ou de outro tipo: unknown_target e nenhuma linha", async () => {
    const mine = await addMethod(a, "Só da A", 300);
    const theirs = await addMethod(b, "Só da B", 300);
    const before = await db.admin.query("select count(*)::int as n from fee_reapplications");
    expect((await repo().create(a.tenantId, input(uuidv7()))).kind).toBe("unknown_target");
    expect((await repo().create(a.tenantId, input(theirs))).kind).toBe("unknown_target");
    expect(
      (await repo().create(a.tenantId, input(mine, uuidv7(), { targetKind: "sales_channel" })))
        .kind,
    ).toBe("unknown_target");
    const after = await db.admin.query("select count(*)::int as n from fee_reapplications");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("corrida da mesma chave (23505 do índice da chave): relê e responde replayed", async () => {
    const pm = await addMethod(a, "Corrida", 300);
    const other = await addMethod(a, "Corrida 2", 300);
    const key = uuidv7();
    // Linha sem commit numa conexão admin: o INSERT do repositório espera o commit e então colide.
    const client = await db.admin.connect();
    const winner = uuidv7();
    try {
      await client.query("begin");
      await client.query(
        `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date,
           fee_percent_bp, fee_fixed_cents, status, created_by, client_request_id)
         values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 300, 0, 'done', $4, $5)`,
        [winner, a.tenantId, other, a.userId, key],
      );
      const pending = repo().create(a.tenantId, input(pm, key));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("commit");
      const result = await pending;
      expect(result.kind).toBe("replayed");
      if (result.kind !== "replayed") return;
      expect(result.record.id).toBe(winner);
    } finally {
      client.release();
    }
  });

  it("corrida do alvo ativo (23505 do índice de alvo ativo): relê e responde in_progress", async () => {
    const pm = await addMethod(a, "Corrida alvo");
    const winner = uuidv7();
    const client = await db.admin.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date,
           fee_percent_bp, fee_fixed_cents, status, created_by, client_request_id)
         values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 320, 0, 'queued', $4, $5)`,
        [winner, a.tenantId, pm, a.userId, uuidv7()],
      );
      // O INSERT do repositório espera o commit e então colide no índice do alvo.
      const pending = repo().create(a.tenantId, input(pm));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("commit");
      const result = await pending;
      expect(result.kind).toBe("in_progress");
      if (result.kind !== "in_progress") return;
      expect(result.record.id).toBe(winner);
    } finally {
      client.release();
    }
  });

  it("linha queued órfã (mais de 35 min): a nova criação a marca failed/stale e segue", async () => {
    const pm = await addMethod(a, "Órfã");
    const orphan = uuidv7();
    await db.admin.query(
      `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date,
         fee_percent_bp, fee_fixed_cents, status, created_by, client_request_id, created_at)
       values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 320, 0, 'queued', $4, $5,
         now() - interval '2 hours')`,
      [orphan, a.tenantId, pm, a.userId, uuidv7()],
    );
    const result = await repo().create(a.tenantId, input(pm));
    expect(result.kind).toBe("created");
    expect(await repo().get(a.tenantId, orphan)).toMatchObject({
      status: "failed",
      errorCode: "stale",
    });
  });

  it("linha queued recente continua bloqueando o alvo; running antiga não é tocada", async () => {
    const pm = await addMethod(a, "Recente");
    const recent = await repo().create(a.tenantId, input(pm));
    expect((await repo().create(a.tenantId, input(pm))).kind).toBe("in_progress");
    const pm2 = await addMethod(a, "Running antiga");
    const running = uuidv7();
    await db.admin.query(
      `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date,
         fee_percent_bp, fee_fixed_cents, status, created_by, created_at)
       values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 320, 0, 'running', $4,
         now() - interval '2 hours')`,
      [running, a.tenantId, pm2, a.userId],
    );
    expect((await repo().create(a.tenantId, input(pm2))).kind).toBe("in_progress");
    expect(await repo().get(a.tenantId, running)).toMatchObject({ status: "running" });
    expect(recent.kind).toBe("created");
  });

  it("a mesma chave de outro autor ou de outra empresa não colide", async () => {
    const pmA = await addMethod(a, "Isolada A", 300);
    const pmB = await addMethod(b, "Isolada B", 300);
    const key = uuidv7();
    expect((await repo().create(a.tenantId, input(pmA, key))).kind).toBe("created");
    expect((await repo().create(b.tenantId, input(pmB, key, { createdBy: b.userId }))).kind).toBe(
      "created",
    );
  });
});

describe("FeeReapplyRepo: estado e leitura", () => {
  it("queued -> running -> done; guarda no estado de origem; failed só de queued ou running", async () => {
    const pm = await addMethod(a, "Estado", 300);
    const created = await repo().create(a.tenantId, input(pm));
    if (created.kind !== "created") throw new Error("x");
    const id = created.record.id;
    // Contadores só andam com a linha running.
    expect(await repo().addProgress(a.tenantId, id, { matched: 1, updated: 1, skipped: 0 })).toBe(
      false,
    );
    expect(await repo().markDone(a.tenantId, id)).toBe(false);
    expect(await repo().markRunning(a.tenantId, id)).toBe(true);
    expect(await repo().markRunning(a.tenantId, id)).toBe(false);
    expect(await repo().addProgress(a.tenantId, id, { matched: 2, updated: 1, skipped: 1 })).toBe(
      true,
    );
    // Retry soma ao que já está na linha.
    expect(await repo().addProgress(a.tenantId, id, { matched: 1, updated: 1, skipped: 0 })).toBe(
      true,
    );
    expect(await repo().markDone(a.tenantId, id)).toBe(true);
    expect(await repo().markDone(a.tenantId, id)).toBe(false);
    expect(await repo().addProgress(a.tenantId, id, { matched: 9, updated: 9, skipped: 9 })).toBe(
      false,
    );
    expect(await repo().markFailed(a.tenantId, id, "x_code")).toBe(false);
    const row = await repo().get(a.tenantId, id);
    expect(row).toMatchObject({ status: "done", matched: 3, updated: 2, skipped: 1 });
    expect(row?.finishedAt).not.toBeNull();
  });

  it("get e latest respeitam a empresa", async () => {
    const pm = await addMethod(a, "Latest", 300);
    const created = await repo().create(a.tenantId, input(pm));
    if (created.kind !== "created") throw new Error("x");
    expect((await repo().latest(a.tenantId, "payment_method", pm))?.id).toBe(created.record.id);
    expect(await repo().latest(b.tenantId, "payment_method", pm)).toBeNull();
    expect(await repo().get(b.tenantId, created.record.id)).toBeNull();
  });

  it("loadBatch: só receita não excluída do alvo e do período, em ordem de id, com cursor", async () => {
    const pm = await addMethod(a, "Lote", 300);
    const otherPm = await addMethod(a, "Lote outro", 300);
    const insertEntry = async (over: {
      type?: string;
      on?: string;
      pm?: string;
      deleted?: boolean;
    }) => {
      const id = uuidv7();
      await db.admin.query(
        `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents,
           net_cents, payment_method_id, sales_channel_id, created_by, deleted_at)
         values ($1, $2, $3, $4, $5, $5, 'x', 10000, 10000, $6, $9, $7, $8)`,
        [
          id,
          a.tenantId,
          a.unitId,
          over.type ?? "revenue",
          over.on ?? "2026-10-10",
          over.pm ?? pm,
          a.userId,
          over.deleted ? new Date() : null,
          a.salesChannelId,
        ],
      );
      return id;
    };
    const e1 = await insertEntry({});
    const e2 = await insertEntry({ on: "2026-10-31" });
    await insertEntry({ type: "expense" });
    await insertEntry({ on: "2026-09-30" });
    await insertEntry({ on: "2026-11-01" });
    await insertEntry({ deleted: true });
    await insertEntry({ pm: otherPm });
    const scope = {
      targetKind: "payment_method" as const,
      targetId: pm,
      from: "2026-10-01",
      to: "2026-10-31",
    };
    const first = await repo().loadBatch(a.tenantId, scope, null, 1);
    expect(first.entries).toHaveLength(1);
    const second = await repo().loadBatch(a.tenantId, scope, first.entries[0]?.id ?? null, 10);
    const ids = [...first.entries, ...second.entries].map((e) => e.id);
    expect(ids).toEqual([e1, e2].sort());
    expect(first.catalog.paymentMethods.get(pm)).toEqual({ feePercentBp: 300, feeFixedCents: 0 });
    // Outra empresa não vê nada.
    expect((await repo().loadBatch(b.tenantId, scope, null, 10)).entries).toHaveLength(0);
    const reloaded = await repo().loadEntries(a.tenantId, scope, [e1]);
    expect(reloaded.entries.map((e) => e.id)).toEqual([e1]);
  });
});
