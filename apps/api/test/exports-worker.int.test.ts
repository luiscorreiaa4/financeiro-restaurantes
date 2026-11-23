import {
  type EntryFilters,
  type ExportContent,
  type ExportFormat,
  entryFiltersSchema,
} from "@app/core/contracts";
import {
  createDatabase,
  createPanelAccessStore,
  type Database,
  exportsRepo,
  uuidv7,
  withTenant,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryExportStore, exportFileKey } from "../src/infra/exports/local-export-store";
import { InMemoryQueue } from "../src/infra/in-memory-queue";
import { createLogger } from "../src/infra/logger";
import { createDeleteExportFile } from "../src/modules/exports/delete-export-file";
import { createFailStuckExport } from "../src/modules/exports/fail-stuck-export";
import { createGenerateExport } from "../src/modules/exports/generate-export";
import { DELETE_EXPORT_FILE_QUEUE } from "../src/modules/exports/queues";

let db: TestDatabase;
let appDb: Database;
const logger = createLogger("silent");
const clock = { now: () => new Date("2026-11-23T12:00:00Z"), today: () => "2026-11-23" };

interface World {
  tenantId: string;
  unitId: string;
  owner: string;
  manager: string; // EXPORTAR_DADOS, sem VER_FOLHA
  managerPayroll: string; // EXPORTAR_DADOS e VER_FOLHA
  accountant: string;
  staff: string;
  payrollCategoryId: string;
  normalCategoryId: string;
  payrollEntryId: string;
}

let w: World;

beforeAll(async () => {
  db = await startTestDatabase();
  appDb = createDatabase(db.app);
});

afterAll(async () => {
  await db?.stop();
});

async function addUser(name: string): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into users (id, name, phone_e164) values ($1, $2, $3)", [
    id,
    name,
    `+5511${String(800000000 + Math.floor(Math.random() * 1e8))}`,
  ]);
  return id;
}

async function addMembership(
  tenantId: string,
  unitId: string,
  userId: string,
  role: string,
  permissions: string[] = [],
  panelAccess = true,
) {
  const id = uuidv7();
  const allUnits = role === "owner" || role === "accountant";
  await db.admin.query(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, permissions)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, tenantId, userId, role, allUnits, panelAccess, JSON.stringify(permissions)],
  );
  if (!allUnits) {
    await db.admin.query(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantId, id, unitId],
    );
  }
  return id;
}

async function addEntry(
  tenantId: string,
  unitId: string,
  createdBy: string,
  categoryId: string,
  description: string,
  amountCents: number,
  deleted = false,
): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents,
       net_cents, category_id, created_by, deleted_at)
     values ($1, $2, $3, 'expense', '2026-10-15', '2026-10-15', $4, $5, $5, $6, $7, $8)`,
    [
      id,
      tenantId,
      unitId,
      description,
      amountCents,
      categoryId,
      createdBy,
      deleted ? new Date("2026-10-20T10:00:00Z") : null,
    ],
  );
  return id;
}

async function buildWorld(): Promise<World> {
  const tenantId = uuidv7();
  const unitId = uuidv7();
  await db.admin.query("insert into tenants (id, name) values ($1, 'Restaurante T10')", [tenantId]);
  await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
    unitId,
    tenantId,
  ]);
  const owner = await addUser("Dono");
  const manager = await addUser("Gerente");
  const managerPayroll = await addUser("Gerente Folha");
  const accountant = await addUser("Contador");
  const staff = await addUser("Lançador");
  await addMembership(tenantId, unitId, owner, "owner");
  await addMembership(tenantId, unitId, manager, "manager", ["EXPORTAR_DADOS"]);
  await addMembership(tenantId, unitId, managerPayroll, "manager", ["EXPORTAR_DADOS", "VER_FOLHA"]);
  await addMembership(tenantId, unitId, accountant, "accountant");
  await addMembership(tenantId, unitId, staff, "staff");
  const normalCategoryId = uuidv7();
  const payrollCategoryId = uuidv7();
  await db.admin.query(
    `insert into categories (id, tenant_id, name, kind, dre_group) values ($1, $2, 'Mercado', 'expense', 'cmv')`,
    [normalCategoryId, tenantId],
  );
  await db.admin.query(
    `insert into categories (id, tenant_id, name, kind, dre_group, is_sensitive)
     values ($1, $2, 'Salários', 'expense', 'pessoal', true)`,
    [payrollCategoryId, tenantId],
  );
  await addEntry(tenantId, unitId, owner, normalCategoryId, "Compra de arroz", 5000);
  await addEntry(tenantId, unitId, owner, normalCategoryId, "Compra de feijão", 3000);
  await addEntry(tenantId, unitId, owner, normalCategoryId, "Compra apagada", 1000, true);
  const payrollEntryId = await addEntry(
    tenantId,
    unitId,
    owner,
    payrollCategoryId,
    "Salario do Joao",
    123456,
  );
  await db.admin.query(
    `insert into entry_versions (id, tenant_id, entry_id, version, action, before, after, changed_by, channel)
     values ($1, $2, $3, 1, 'create', null, $4::jsonb, $5, 'web'),
            ($6, $2, $3, 2, 'update', $4::jsonb, $7::jsonb, $5, 'web')`,
    [
      uuidv7(),
      tenantId,
      payrollEntryId,
      JSON.stringify({
        description: "Salario",
        amountCents: 123456,
        categoryId: payrollCategoryId,
      }),
      owner,
      uuidv7(),
      JSON.stringify({
        description: "Salario do Joao",
        amountCents: 123456,
        categoryId: payrollCategoryId,
      }),
    ],
  );
  return {
    tenantId,
    unitId,
    owner,
    manager,
    managerPayroll,
    accountant,
    staff,
    payrollCategoryId,
    normalCategoryId,
    payrollEntryId,
  };
}

beforeEach(async () => {
  w = await buildWorld();
});

const FILTERS: EntryFilters = entryFiltersSchema.parse({ from: "2026-10-01", to: "2026-10-31" });

async function request(
  requestedBy: string,
  format: ExportFormat,
  content: ExportContent,
  over: { tenantId?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await withTenant(appDb, over.tenantId ?? w.tenantId, (tx) =>
    exportsRepo.insert(tx, {
      id,
      tenantId: over.tenantId ?? w.tenantId,
      requestedBy,
      unitChoice: requestedBy === w.owner || requestedBy === w.accountant ? "all" : w.unitId,
      format,
      content,
      filters: FILTERS,
      clientRequestId: uuidv7(),
    }),
  );
  return id;
}

function setup(over: { maxRows?: number } = {}) {
  const store = createInMemoryExportStore();
  const puts: string[] = [];
  const countingStore = {
    ...store,
    async put(key: string, bytes: Uint8Array) {
      puts.push(key);
      await store.put(key, bytes);
    },
  };
  const queue = new InMemoryQueue();
  const access = createPanelAccessStore(createDatabase(db.auth));
  const generate = createGenerateExport({
    appDb,
    access,
    store: countingStore,
    queue,
    clock,
    logger,
    ...(over.maxRows === undefined ? {} : { maxRows: over.maxRows }),
  });
  return { store, countingStore, puts, queue, generate };
}

const getRecord = (id: string) =>
  withTenant(appDb, w.tenantId, (tx) => exportsRepo.get(tx, id)).then(
    (r) => r as NonNullable<typeof r>,
  );

const auditActions = async (id: string) =>
  (
    await db.admin.query<{ action: string; metadata: Record<string, unknown> }>(
      "select action, metadata from audit_log where target = $1 order by created_at",
      [id],
    )
  ).rows;

/** Texto de todos os arquivos do pacote (xlsx é um zip de XML). */
function allText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  return Object.values(files)
    .map((f) => strFromU8(f))
    .join("\n");
}

describe("generate-export: caminho feliz", () => {
  it("dono, XLSX de lançamentos: pronto, rowCount 3 (folha inclusa, lixeira fora) e chave .xlsx", async () => {
    const { generate, store, queue } = setup();
    const id = await request(w.owner, "xlsx", "entries");
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    const rec = await getRecord(id);
    expect(rec).toMatchObject({ status: "ready", rowCount: 3 });
    const key = exportFileKey(w.tenantId, id, "xlsx");
    expect(rec.fileKey).toBe(key);
    const bytes = await store.get(key);
    expect(bytes?.length).toBe(rec.fileSize);
    const text = allText(bytes as Uint8Array);
    expect(text).toContain("Compra de arroz");
    expect(text).toContain("Salario do Joao");
    expect(text).not.toContain("Compra apagada");
    const audit = await auditActions(id);
    expect(audit.map((a) => a.action)).toEqual(["export_ready"]);
    expect(audit[0]?.metadata).toEqual({ rowCount: 3 });
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({
      queue: DELETE_EXPORT_FILE_QUEUE,
      payload: { tenantId: w.tenantId, exportId: id },
    });
  });

  it("dono, CSV de lançamentos: BOM e ; e sem a lixeira", async () => {
    const { generate, store } = setup();
    const id = await request(w.owner, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    const bytes = (await store.get(exportFileKey(w.tenantId, id, "csv"))) as Uint8Array;
    const text = strFromU8(bytes);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain(";");
    expect(text).not.toContain("Compra apagada");
    expect((await getRecord(id)).rowCount).toBe(3);
  });

  it("dono, XLSX completo: lixeira, coluna Situação e aba Histórico com a folha completa", async () => {
    const { generate, store } = setup();
    const id = await request(w.owner, "xlsx", "full");
    await generate({ tenantId: w.tenantId, exportId: id });
    const rec = await getRecord(id);
    expect(rec).toMatchObject({ status: "ready", rowCount: 4 });
    const text = allText((await store.get(exportFileKey(w.tenantId, id, "xlsx"))) as Uint8Array);
    expect(text).toContain("Compra apagada");
    expect(text).toContain("Excluído");
    expect(text).toContain("Lançamentos");
    expect(text).toContain("Histórico");
    expect(text).toContain("Salario do Joao");
    expect(text).not.toContain("(restrito)");
  });

  it("dono, CSV completo: zip com lancamentos.csv e historico.csv", async () => {
    const { generate, store } = setup();
    const id = await request(w.owner, "csv", "full");
    await generate({ tenantId: w.tenantId, exportId: id });
    const bytes = (await store.get(exportFileKey(w.tenantId, id, "zip"))) as Uint8Array;
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["historico.csv", "lancamentos.csv"]);
    const lanc = strFromU8(files["lancamentos.csv"] as Uint8Array);
    const hist = strFromU8(files["historico.csv"] as Uint8Array);
    expect(lanc).toContain("Compra apagada");
    expect(hist).toContain("Salario do Joao");
    expect(hist).not.toContain("(restrito)");
    expect((await getRecord(id)).rowCount).toBe(4);
  });

  it("contador exporta os lançamentos com a folha", async () => {
    const { generate, store } = setup();
    const id = await request(w.accountant, "csv", "entries");
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect((await getRecord(id)).rowCount).toBe(3);
    const text = strFromU8((await store.get(exportFileKey(w.tenantId, id, "csv"))) as Uint8Array);
    expect(text).toContain("Salario do Joao");
  });

  it("gerente com VER_FOLHA exporta a folha", async () => {
    const { generate } = setup();
    const id = await request(w.managerPayroll, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    expect((await getRecord(id)).rowCount).toBe(3);
  });
});

describe("generate-export: folha (RF06.R3, falha fechado)", () => {
  it("gerente sem VER_FOLHA: sem linha sensível no arquivo e rowCount não as conta (CSV e XLSX)", async () => {
    const { generate, store } = setup();
    for (const format of ["csv", "xlsx"] as const) {
      const id = await request(w.manager, format, "entries");
      expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
      const rec = await getRecord(id);
      expect(rec).toMatchObject({ status: "ready", rowCount: 2 });
      const bytes = (await store.get(exportFileKey(w.tenantId, id, format))) as Uint8Array;
      const text = format === "csv" ? strFromU8(bytes) : allText(bytes);
      expect(text).toContain("Compra de arroz");
      expect(text).not.toContain("Salario");
      expect(text).not.toContain("Joao");
      expect(text).not.toContain("1234,56");
      expect(text).not.toContain("1234.56");
      expect(text).not.toContain("Salários");
    }
  });

  it("gerente sem VER_FOLHA pedindo o COMPLETO falha com forbidden (só o dono)", async () => {
    const { generate, puts } = setup();
    const id = await request(w.manager, "csv", "full");
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "forbidden" });
    expect(puts).toEqual([]);
  });
});

describe("generate-export: o ator é recalculado na geração", () => {
  it("gerente perde EXPORTAR_DADOS entre o pedido e a geração: forbidden, nenhum put, export_failed", async () => {
    const { generate, puts, queue } = setup();
    const id = await request(w.manager, "csv", "entries");
    await db.admin.query(
      "update memberships set permissions = '[]'::jsonb where user_id = $1 and tenant_id = $2",
      [w.manager, w.tenantId],
    );
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "forbidden" });
    expect(puts).toEqual([]);
    expect(queue.jobs).toEqual([]);
    const audit = await auditActions(id);
    expect(audit.map((a) => a.action)).toEqual(["export_failed"]);
    expect(audit[0]?.metadata).toEqual({ errorCode: "forbidden" });
  });

  it("lançador não exporta", async () => {
    const { generate, puts } = setup();
    const id = await request(w.staff, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "forbidden" });
    expect(puts).toEqual([]);
  });

  it("vínculo desativado depois do pedido: forbidden", async () => {
    const { generate, puts } = setup();
    const id = await request(w.owner, "csv", "entries");
    await db.admin.query("update memberships set status = 'deactivated' where user_id = $1", [
      w.owner,
    ]);
    await generate({ tenantId: w.tenantId, exportId: id });
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "forbidden" });
    expect(puts).toEqual([]);
  });
});

describe("generate-export: idempotência e limites", () => {
  it("job repetido depois de ready devolve skipped, sem segundo put", async () => {
    const { generate, puts, queue } = setup();
    const id = await request(w.owner, "csv", "entries");
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("skipped");
    expect(puts).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it("job repetido depois de failed devolve skipped", async () => {
    const { generate, puts } = setup();
    const id = await request(w.staff, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("skipped");
    expect(puts).toEqual([]);
  });

  it("retry de um pedido já generating continua e termina pronto", async () => {
    const { generate } = setup();
    const id = await request(w.owner, "csv", "entries");
    await withTenant(appDb, w.tenantId, (tx) => exportsRepo.markGenerating(tx, id));
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect((await getRecord(id)).status).toBe("ready");
  });

  it("maxRows injetado: acima do teto vira too_many_rows, sem put", async () => {
    const { generate, puts } = setup({ maxRows: 2 });
    const id = await request(w.owner, "csv", "entries");
    expect(await generate({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "too_many_rows" });
    expect(puts).toEqual([]);
    const audit = await auditActions(id);
    expect(audit.map((a) => a.action)).toEqual(["export_failed"]);
  });

  it("no teto exato (3 linhas, maxRows 3) gera normalmente", async () => {
    const { generate } = setup({ maxRows: 3 });
    const id = await request(w.owner, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    expect((await getRecord(id)).status).toBe("ready");
  });

  it("payload com o tenantId de outra empresa não lê nem escreve nada", async () => {
    const other = await buildWorld();
    const { generate, puts, queue } = setup();
    const id = await request(w.owner, "csv", "entries");
    expect(await generate({ tenantId: other.tenantId, exportId: id })).toBe("skipped");
    expect(puts).toEqual([]);
    expect(queue.jobs).toEqual([]);
    expect((await getRecord(id)).status).toBe("queued");
  });

  it("payload inválido devolve skipped", async () => {
    const { generate, puts } = setup();
    expect(await generate({ tenantId: "x", exportId: "y" } as never)).toBe("skipped");
    expect(puts).toEqual([]);
  });

  it("falha inesperada: sobe o erro; na última tentativa vira failed/generation_failed sem a mensagem", async () => {
    const { generate, queue } = setup();
    const access = createPanelAccessStore(createDatabase(db.auth));
    const boom = createGenerateExport({
      appDb,
      access,
      store: {
        put: async () => {
          throw new Error("SEGREDO: select ... params Salario do Joao");
        },
        get: async () => null,
        delete: async () => {},
      },
      queue,
      clock,
      logger,
    });
    const id = await request(w.owner, "csv", "entries");
    await expect(
      boom({ tenantId: w.tenantId, exportId: id }, { retryCount: 0, retryLimit: 3 }),
    ).rejects.toThrow();
    expect((await getRecord(id)).status).toBe("generating");
    await expect(
      boom({ tenantId: w.tenantId, exportId: id }, { retryCount: 3, retryLimit: 3 }),
    ).rejects.toThrow();
    const rec = await getRecord(id);
    expect(rec).toMatchObject({ status: "failed", errorCode: "generation_failed" });
    const audit = await auditActions(id);
    expect(audit.map((a) => a.action)).toEqual(["export_failed"]);
    expect(JSON.stringify(audit)).not.toContain("SEGREDO");
    void generate;
  });
});

describe("generate-export: arquivo órfão na falha terminal", () => {
  it("put OK e enqueue falhando na última tentativa: failed/generation_failed e o store sem a chave", async () => {
    const { generate, store, queue } = setup();
    const id = await request(w.owner, "csv", "entries");
    queue.failWith = new Error("fila fora do ar");
    await expect(
      generate({ tenantId: w.tenantId, exportId: id }, { retryCount: 3, retryLimit: 3 }),
    ).rejects.toThrow();
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "generation_failed" });
    expect(store.keys()).toEqual([]);
  });

  it("fora da última tentativa o arquivo fica (o retry sobrescreve)", async () => {
    const { generate, store, queue } = setup();
    const id = await request(w.owner, "csv", "entries");
    queue.failWith = new Error("fila fora do ar");
    await expect(
      generate({ tenantId: w.tenantId, exportId: id }, { retryCount: 0, retryLimit: 3 }),
    ).rejects.toThrow();
    expect(store.keys()).toHaveLength(1);
    expect((await getRecord(id)).status).toBe("generating");
  });

  it("o delete do arquivo que falha não mascara o erro original", async () => {
    const { store } = setup();
    const queue = new InMemoryQueue();
    queue.failWith = new Error("fila fora do ar");
    const generate = createGenerateExport({
      appDb,
      access: createPanelAccessStore(createDatabase(db.auth)),
      store: {
        ...store,
        delete: async () => {
          throw new Error("disco cheio");
        },
      },
      queue,
      clock,
      logger,
    });
    const id = await request(w.owner, "csv", "entries");
    await expect(
      generate({ tenantId: w.tenantId, exportId: id }, { retryCount: 3, retryLimit: 3 }),
    ).rejects.toThrow("fila fora do ar");
    expect((await getRecord(id)).status).toBe("failed");
  });
});

describe("fail-stuck-export (consumidor da DLQ de generate-export)", () => {
  it("pedido preso em generating vira failed, audita uma vez e limpa o arquivo", async () => {
    const store = createInMemoryExportStore();
    const fail = createFailStuckExport({ appDb, store, logger });
    const id = await request(w.owner, "csv", "entries");
    await withTenant(appDb, w.tenantId, (tx) => exportsRepo.markGenerating(tx, id));
    const key = exportFileKey(w.tenantId, id, "csv");
    await store.put(key, new Uint8Array([1]));
    expect(await fail({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect(await getRecord(id)).toMatchObject({ status: "failed", errorCode: "generation_failed" });
    expect(store.keys()).toEqual([]);
    expect(await fail({ tenantId: w.tenantId, exportId: id })).toBe("skipped");
    const audit = await auditActions(id);
    expect(audit.map((a) => a.action)).toEqual(["export_failed"]);
    expect(audit[0]?.metadata).toEqual({ errorCode: "generation_failed" });
  });

  it("pedido ainda queued também falha; o COMPLETO em CSV limpa a chave .zip", async () => {
    const store = createInMemoryExportStore();
    const fail = createFailStuckExport({ appDb, store, logger });
    const id = await request(w.owner, "csv", "full");
    const key = exportFileKey(w.tenantId, id, "zip");
    await store.put(key, new Uint8Array([1]));
    expect(await fail({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect((await getRecord(id)).status).toBe("failed");
    expect(store.keys()).toEqual([]);
  });

  it("pedido ready, tenant de outra empresa e payload inválido não mudam nada", async () => {
    const { generate, store } = setup();
    const fail = createFailStuckExport({ appDb, store, logger });
    const id = await request(w.owner, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    expect(await fail({ tenantId: w.tenantId, exportId: id })).toBe("skipped");
    expect((await getRecord(id)).status).toBe("ready");
    expect(store.keys()).toHaveLength(1);
    const other = await buildWorld();
    const id2 = await request(w.owner, "csv", "entries");
    expect(await fail({ tenantId: other.tenantId, exportId: id2 })).toBe("skipped");
    expect((await getRecord(id2)).status).toBe("queued");
    expect(await fail({ tenantId: "x" } as never)).toBe("skipped");
  });
});

describe("delete-export-file", () => {
  it("apaga a chave, marca file_deleted_at e o segundo job devolve skipped", async () => {
    const { generate, store } = setup();
    const id = await request(w.owner, "csv", "entries");
    await generate({ tenantId: w.tenantId, exportId: id });
    const key = exportFileKey(w.tenantId, id, "csv");
    expect(await store.get(key)).not.toBeNull();
    const del = createDeleteExportFile({ appDb, store, logger });
    expect(await del({ tenantId: w.tenantId, exportId: id })).toBe("done");
    expect(await store.get(key)).toBeNull();
    expect((await getRecord(id)).fileDeletedAt).not.toBeNull();
    expect(await del({ tenantId: w.tenantId, exportId: id })).toBe("skipped");
  });

  it("pedido sem arquivo (failed) ou de outra empresa devolve skipped", async () => {
    const { store } = setup();
    const del = createDeleteExportFile({ appDb, store, logger });
    const id = await request(w.owner, "csv", "entries");
    expect(await del({ tenantId: w.tenantId, exportId: id })).toBe("skipped");
    const other = await buildWorld();
    expect(await del({ tenantId: other.tenantId, exportId: id })).toBe("skipped");
  });
});
