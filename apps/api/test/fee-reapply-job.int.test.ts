import type { EntryStore } from "@app/core";
import {
  createDatabase,
  createEntryStore,
  createFeeReapplyRepo,
  createPanelAccessStore,
  type Database,
  type FeeReapplyRepo,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/infra/logger";
import {
  createFailStuckFeeReapply,
  createRunFeeReapply,
  type RunFeeReapplyDeps,
} from "../src/modules/fee-reapply/run-fee-reapply";

let db: TestDatabase;
let appDb: Database;
let repo: FeeReapplyRepo;
const logger = createLogger("silent");
const clock = { now: () => new Date("2026-11-23T12:00:00Z"), today: () => "2026-11-23" };

beforeAll(async () => {
  db = await startTestDatabase();
  appDb = createDatabase(db.app);
  repo = createFeeReapplyRepo(appDb);
});
afterAll(async () => {
  await db?.stop();
});

interface World {
  tenantId: string;
  unitId: string;
  ownerId: string;
  salao: string;
  ifood: string;
}

async function world(): Promise<World> {
  const w: World = {
    tenantId: uuidv7(),
    unitId: uuidv7(),
    ownerId: uuidv7(),
    salao: uuidv7(),
    ifood: uuidv7(),
  };
  const q = (sql: string, p: unknown[]) => db.admin.query(sql, p);
  await q("insert into tenants (id, name) values ($1, 'T')", [w.tenantId]);
  await q("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
    w.unitId,
    w.tenantId,
  ]);
  await q("insert into users (id, name, phone_e164) values ($1, 'Dono', $2)", [
    w.ownerId,
    `+5511${String(800000000 + Math.floor(Math.random() * 1e8))}`,
  ]);
  await q(
    "insert into memberships (id, tenant_id, user_id, role, all_units) values ($1, $2, $3, 'owner', true)",
    [uuidv7(), w.tenantId, w.ownerId],
  );
  await q(
    "insert into sales_channels (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, 'Salão', 'dine_in', 0)",
    [w.salao, w.tenantId],
  );
  await q(
    "insert into sales_channels (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, 'iFood', 'app', 1200)",
    [w.ifood, w.tenantId],
  );
  return w;
}

async function addMethod(w: World, name: string, bp: number): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    "insert into payment_methods (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, $3, 'credit', $4)",
    [id, w.tenantId, name, bp],
  );
  return id;
}

/** Receita de R$ 100,00 já gravada com `feeBp` (taxa antiga). */
async function addRevenue(
  w: World,
  methodId: string,
  over: { feeBp?: number; channel?: string; type?: string; deleted?: boolean; on?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const feeBp = over.feeBp ?? 0;
  const fee = Math.round((10000 * feeBp) / 10000);
  await db.admin.query(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents,
       fee_percent_bp, fee_cents, net_cents, payment_method_id, sales_channel_id, created_by, deleted_at)
     values ($1, $2, $3, $4, $5, $5, 'venda', 10000, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      w.tenantId,
      w.unitId,
      over.type ?? "revenue",
      over.on ?? "2026-10-10",
      feeBp,
      fee,
      10000 - fee,
      methodId,
      over.type === "expense" ? null : (over.channel ?? w.salao),
      w.ownerId,
      over.deleted ? new Date("2026-10-20T10:00:00Z") : null,
    ],
  );
  return id;
}

async function request(w: World, kind: "payment_method" | "sales_channel", targetId: string) {
  const result = await repo.create(w.tenantId, {
    id: uuidv7(),
    createdBy: w.ownerId,
    targetKind: kind,
    targetId,
    from: "2026-10-01",
    to: "2026-10-31",
    clientRequestId: uuidv7(),
  });
  if (result.kind !== "created") throw new Error(`esperava created, veio ${result.kind}`);
  return result.record;
}

const entryRow = async (id: string) =>
  (await db.admin.query("select * from entries where id = $1", [id])).rows[0];
const versionRows = async (id: string) =>
  (await db.admin.query("select * from entry_versions where entry_id = $1 order by version", [id]))
    .rows;

function deps(overrides: Partial<RunFeeReapplyDeps> = {}): RunFeeReapplyDeps {
  return {
    repo,
    store: createEntryStore(appDb),
    access: createPanelAccessStore(createDatabase(db.auth)),
    clock,
    logger,
    ...overrides,
  };
}
const payload = (w: World, id: string) => ({ tenantId: w.tenantId, reapplicationId: id });

describe("job fee-reapply: caminho feliz", () => {
  it("recalcula só receita ativa do alvo, versão com canal web e autor = dono", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const e1 = await addRevenue(w, pm);
    const e2 = await addRevenue(w, pm, { on: "2026-10-31" });
    const expense = await addRevenue(w, pm, { type: "expense" });
    const deleted = await addRevenue(w, pm, { deleted: true });
    const outOfRange = await addRevenue(w, pm, { on: "2026-09-30" });
    const record = await request(w, "payment_method", pm);

    expect(await createRunFeeReapply(deps())(payload(w, record.id))).toBe("done");

    for (const id of [e1, e2]) {
      expect(await entryRow(id)).toMatchObject({ fee_cents: "320", net_cents: "9680", version: 2 });
      const versions = await versionRows(id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ channel: "web", changed_by: w.ownerId, version: 2 });
    }
    for (const id of [expense, deleted, outOfRange]) {
      expect(await entryRow(id)).toMatchObject({ version: 1 });
      expect(await versionRows(id)).toHaveLength(0);
    }
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      matched: 2,
      updated: 2,
      skipped: 0,
    });
  });

  it("percorre vários lotes (tamanho 2)", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(await addRevenue(w, pm));
    const record = await request(w, "payment_method", pm);
    await createRunFeeReapply(deps({ batchSize: 2 }))(payload(w, record.id));
    for (const id of ids) expect(await entryRow(id)).toMatchObject({ version: 2 });
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({ updated: 5, matched: 5 });
  });

  it("canal: aplica a comissão do canal (reaplicação por canal)", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const e = await addRevenue(w, pm, { channel: w.ifood, feeBp: 0 });
    const record = await request(w, "sales_channel", w.ifood);
    await createRunFeeReapply(deps())(payload(w, record.id));
    expect(await entryRow(e)).toMatchObject({ fee_cents: "1200", net_cents: "8800" });
  });

  it("Review Focus 4: forma Crédito sobre receita do iFood com comissão não muda o lançamento", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    // Já na regra do canal (P06): comissão do app substitui a taxa da forma.
    const e = await addRevenue(w, pm, { channel: w.ifood, feeBp: 1200 });
    const record = await request(w, "payment_method", pm);
    await createRunFeeReapply(deps())(payload(w, record.id));
    expect(await entryRow(e)).toMatchObject({ fee_cents: "1200", version: 1 });
    expect(await versionRows(e)).toHaveLength(0);
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      matched: 0,
      updated: 0,
    });
  });
});

describe("job fee-reapply: guardas", () => {
  it("taxa mudada entre confirmar e rodar: failed rate_changed e nenhuma versão", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const e = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    await db.admin.query("update payment_methods set fee_percent_bp = 400 where id = $1", [pm]);

    expect(await createRunFeeReapply(deps())(payload(w, record.id))).toBe("done");

    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "failed",
      errorCode: "rate_changed",
    });
    expect(await entryRow(e)).toMatchObject({ version: 1, fee_cents: "0" });
    expect(await versionRows(e)).toHaveLength(0);
  });

  it("rodar duas vezes não gera versão a mais; linha done relida é no-op", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const e = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    const run = createRunFeeReapply(deps());
    expect(await run(payload(w, record.id))).toBe("done");
    expect(await run(payload(w, record.id))).toBe("skipped");
    // Linha de volta a queued (reexecução forçada): o plano não acha mais nada para mudar.
    await db.admin.query(
      "update fee_reapplications set status = 'queued', finished_at = null where id = $1",
      [record.id],
    );
    expect(await run(payload(w, record.id))).toBe("done");
    expect(await versionRows(e)).toHaveLength(1);
    expect(await entryRow(e)).toMatchObject({ version: 2 });
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({ status: "done", updated: 1 });
  });

  it("payload inválido, linha inexistente ou de outra empresa: skipped sem efeito", async () => {
    const w = await world();
    const other = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const record = await request(w, "payment_method", pm);
    const run = createRunFeeReapply(deps());
    expect(await run({ nada: true })).toBe("skipped");
    expect(await run(payload(w, uuidv7()))).toBe("skipped");
    expect(await run({ tenantId: other.tenantId, reapplicationId: record.id })).toBe("skipped");
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({ status: "queued" });
  });

  it("Review Focus 3: edição do painel entre a leitura e a gravação é relida e não é sobrescrita", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const edited = await addRevenue(w, pm);
    const untouched = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    const real = createEntryStore(appDb);
    let bumped = false;
    const store: Pick<EntryStore, "applyChanges"> = {
      async applyChanges(tenantId, changes, extra) {
        if (!bumped) {
          bumped = true;
          // Alguém edita pelo painel depois da leitura do lote (a versão sobe para 2).
          await db.admin.query(
            "update entries set description = 'editado no painel', version = version + 1 where id = $1",
            [edited],
          );
        }
        return real.applyChanges(tenantId, changes, extra);
      },
    };
    await createRunFeeReapply(deps({ store }))(payload(w, record.id));
    // Relido e replanejado sobre a versão nova: a edição fica, a taxa entra em cima dela.
    expect(await entryRow(edited)).toMatchObject({
      description: "editado no painel",
      version: 3,
      fee_cents: "320",
    });
    expect(await entryRow(untouched)).toMatchObject({ version: 2, fee_cents: "320" });
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      updated: 2,
      skipped: 0,
    });
  });

  it("Review Focus 3: edição que continua a atropelar vira pulado, sem sobrescrever", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const contested = await addRevenue(w, pm);
    const other = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    const real = createEntryStore(appDb);
    const store: Pick<EntryStore, "applyChanges"> = {
      async applyChanges(tenantId, changes, extra) {
        // Toda tentativa encontra o lançamento disputado já editado de novo.
        if (changes.some((c) => c.entry.id === contested)) {
          await db.admin.query(
            "update entries set description = 'editado de novo', version = version + 1 where id = $1",
            [contested],
          );
        }
        return real.applyChanges(tenantId, changes, extra);
      },
    };
    await createRunFeeReapply(deps({ store }))(payload(w, record.id));
    expect(await entryRow(contested)).toMatchObject({
      fee_cents: "0",
      description: "editado de novo",
    });
    expect(await versionRows(contested)).toHaveLength(0);
    expect(await entryRow(other)).toMatchObject({ version: 2, fee_cents: "320" });
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      matched: 2,
      updated: 1,
      skipped: 1,
    });
  });
});

describe("job fee-reapply: mudanças durante a execução", () => {
  it("I1: taxa do alvo muda entre dois lotes: failed rate_changed e os lotes seguintes ficam sem versão", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(await addRevenue(w, pm));
    const record = await request(w, "payment_method", pm);
    let calls = 0;
    const racing: FeeReapplyRepo = {
      ...repo,
      async loadBatch(...args) {
        calls += 1;
        if (calls === 2) {
          await db.admin.query("update payment_methods set fee_percent_bp = 500 where id = $1", [
            pm,
          ]);
        }
        return repo.loadBatch(...args);
      },
    };
    await createRunFeeReapply(deps({ repo: racing, batchSize: 2 }))(payload(w, record.id));
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "failed",
      errorCode: "rate_changed",
      updated: 2,
    });
    const versions = await Promise.all(ids.map(async (id) => (await versionRows(id)).length));
    expect(versions.filter((n) => n === 1)).toHaveLength(2);
    expect(versions.filter((n) => n === 0)).toHaveLength(3);
  });

  it("I2: lançamento que trocou de forma entre a leitura e a gravação sai do recorte: skipped, sem versão", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const other = await addMethod(w, "Débito", 100);
    const moved = await addRevenue(w, pm);
    const stays = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    const real = createEntryStore(appDb);
    let bumped = false;
    const store: Pick<EntryStore, "applyChanges"> = {
      async applyChanges(tenantId, changes, extra) {
        if (!bumped) {
          bumped = true;
          await db.admin.query(
            "update entries set payment_method_id = $2, version = version + 1 where id = $1",
            [moved, other],
          );
        }
        return real.applyChanges(tenantId, changes, extra);
      },
    };
    await createRunFeeReapply(deps({ store }))(payload(w, record.id));
    expect(await entryRow(moved)).toMatchObject({ fee_cents: "0", version: 2 });
    expect(await versionRows(moved)).toHaveLength(0);
    expect(await entryRow(stays)).toMatchObject({ fee_cents: "320", version: 2 });
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      updated: 1,
      skipped: 1,
    });
  });

  it("I2: data movida para fora do período, tipo trocado ou excluído também saem do recorte", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const outside = await addRevenue(w, pm);
    const expense = await addRevenue(w, pm);
    const removed = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    const real = createEntryStore(appDb);
    let bumped = false;
    const store: Pick<EntryStore, "applyChanges"> = {
      async applyChanges(tenantId, changes, extra) {
        if (!bumped) {
          bumped = true;
          await db.admin.query(
            "update entries set occurred_on = '2026-09-01', paid_on = '2026-09-01', version = version + 1 where id = $1",
            [outside],
          );
          await db.admin.query(
            "update entries set deleted_at = now(), version = version + 1 where id = $1",
            [removed],
          );
          await db.admin.query(
            `update entries set type = 'expense', sales_channel_id = null, version = version + 1 where id = $1`,
            [expense],
          );
        }
        return real.applyChanges(tenantId, changes, extra);
      },
    };
    await createRunFeeReapply(deps({ store }))(payload(w, record.id));
    for (const id of [outside, expense, removed]) {
      expect(await versionRows(id)).toHaveLength(0);
      expect(await entryRow(id)).toMatchObject({ fee_cents: "0" });
    }
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      updated: 0,
      skipped: 3,
    });
  });

  it("M3: autor deixou de ser dono ativo: failed not_allowed e nada muda", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const e = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    await db.admin.query(
      "update memberships set status = 'deactivated', deactivated_at = now() where user_id = $1",
      [w.ownerId],
    );
    await createRunFeeReapply(deps())(payload(w, record.id));
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "failed",
      errorCode: "not_allowed",
    });
    expect(await versionRows(e)).toHaveLength(0);
  });

  it("M3: conta que não grava (somente leitura): failed not_allowed e nada muda", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const e = await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    await db.admin.query("update tenants set status = 'read_only' where id = $1", [w.tenantId]);
    await createRunFeeReapply(deps())(payload(w, record.id));
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "failed",
      errorCode: "not_allowed",
    });
    expect(await versionRows(e)).toHaveLength(0);
  });
});

describe("job fee-reapply: retry no meio", () => {
  it("queda depois do 1º lote e nova execução: totais reais e uma versão por lançamento", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(await addRevenue(w, pm));
    const record = await request(w, "payment_method", pm);
    const real = createEntryStore(appDb);
    let calls = 0;
    const crashing: Pick<EntryStore, "applyChanges"> = {
      async applyChanges(tenantId, changes, extra) {
        calls += 1;
        if (calls === 2) throw new Error("queda");
        return real.applyChanges(tenantId, changes, extra);
      },
    };
    await expect(
      createRunFeeReapply(deps({ store: crashing, batchSize: 2 }))(payload(w, record.id), {
        retryCount: 0,
        retryLimit: 3,
      }),
    ).rejects.toThrow();
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "running",
      updated: 2,
    });
    // Retry com a linha running: soma ao que já está na linha.
    await createRunFeeReapply(deps({ batchSize: 2 }))(payload(w, record.id));
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "done",
      matched: 5,
      updated: 5,
      skipped: 0,
    });
    for (const id of ids) expect(await versionRows(id)).toHaveLength(1);
  });
});

describe("job fee-reapply: falha e DLQ", () => {
  it("erro inesperado: relança para a fila retentar; na última tentativa vira failed job_failed sem a mensagem", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    await addRevenue(w, pm);
    const record = await request(w, "payment_method", pm);
    const store: Pick<EntryStore, "applyChanges"> = {
      async applyChanges() {
        throw new Error("senha=segredo valor 12345");
      },
    };
    const run = createRunFeeReapply(deps({ store }));
    await expect(run(payload(w, record.id), { retryCount: 0, retryLimit: 3 })).rejects.toThrow();
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({ status: "running" });
    await expect(run(payload(w, record.id), { retryCount: 3, retryLimit: 3 })).rejects.toThrow();
    const row = await repo.get(w.tenantId, record.id);
    expect(row).toMatchObject({ status: "failed", errorCode: "job_failed" });
    expect(JSON.stringify(row)).not.toContain("segredo");
  });

  it("consumidor da DLQ: queued ou running vira failed; terminado não muda", async () => {
    const w = await world();
    const pm = await addMethod(w, "Crédito", 320);
    const record = await request(w, "payment_method", pm);
    const stuck = createFailStuckFeeReapply({ repo, logger });
    expect(await stuck(payload(w, record.id))).toBe("done");
    expect(await repo.get(w.tenantId, record.id)).toMatchObject({
      status: "failed",
      errorCode: "job_failed",
    });
    expect(await stuck(payload(w, record.id))).toBe("skipped");
    expect(await stuck({ lixo: 1 })).toBe("skipped");
  });
});
