import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, createPool, type Database, withTenant } from "../src/client";
import { realignSystemCategories } from "../src/realign-system-categories";
import { reportReader } from "../src/report-reader";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let adminDb: Database;
let appPool: ReturnType<typeof createPool>;
let appDb: Database;
let a: TenantFixture;
let b: TenantFixture;

const old = new Map<string, string>();

async function oldCategory(
  name: string,
  kind: string,
  nature: string | null,
  dreGroup: string,
  options: { sensitive?: boolean; parent?: string } = {},
) {
  const id = uuidv7();
  old.set(options.parent ? `${options.parent}/${name}` : name, id);
  await db.admin.query(
    `insert into categories (id, tenant_id, parent_id, name, kind, nature, dre_group, is_sensitive)
     values ($1, null, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      options.parent ? old.get(options.parent) : null,
      name,
      kind,
      nature,
      dreGroup,
      options.sensitive ?? false,
    ],
  );
  return id;
}

async function entryIn(
  tenant: TenantFixture,
  categoryId: string,
  type: "revenue" | "expense",
  cents: number,
  extra: { deleted?: boolean; salesChannelId?: string | null } = {},
) {
  const id = uuidv7();
  await db.admin.query(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
       amount_cents, net_cents, category_id, sales_channel_id, created_by, deleted_at)
     values ($1, $2, $3, $4, '2026-10-10', '2026-10-10', 'teste', $5, $5, $6, $7, $8, $9)`,
    [
      id,
      tenant.tenantId,
      tenant.unitId,
      type,
      cents,
      categoryId,
      type === "revenue" ? (extra.salesChannelId ?? tenant.salesChannelId) : null,
      tenant.userId,
      extra.deleted ? new Date() : null,
    ],
  );
  return id;
}

async function systemId(name: string): Promise<string> {
  const { rows } = await db.admin.query<{ id: string }>(
    "select id from categories where tenant_id is null and parent_id is null and name = $1 and status = 'active'",
    [name],
  );
  if (!rows[0]) throw new Error(`categoria ${name} não encontrada`);
  return rows[0].id;
}

async function snapshot() {
  const cats = await db.admin.query("select * from categories order by id");
  const entries = await db.admin.query("select * from entries order by id");
  const versions = await db.admin.query("select id from entry_versions order by id");
  return JSON.stringify([cats.rows, entries.rows, versions.rows]);
}

let balcaoEntry: string;
let folhaEntry: string;
let insumosDeleted: string;
let carnesOld: string;
let outraEntry: string;
let tenantBEntry: string;
let subId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  adminDb = createDatabase(db.admin);
  appPool = createPool(db.urls.app);
  appDb = createDatabase(appPool);
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");

  await oldCategory("Salão", "revenue", null, "receita_bruta");
  const balcao = await oldCategory("Balcão", "revenue", null, "receita_bruta");
  await oldCategory("Delivery", "revenue", null, "receita_bruta");
  await oldCategory("Outras receitas", "revenue", null, "receita_bruta");
  const insumos = await oldCategory("Insumos", "expense", "variable", "cmv");
  carnesOld = await oldCategory("Carnes", "expense", "variable", "cmv", { parent: "Insumos" });
  const folha = await oldCategory("Folha de pagamento", "expense", "fixed", "pessoal", {
    sensitive: true,
  });
  await oldCategory("Aluguel", "expense", "fixed", "ocupacao");
  await oldCategory("Internet", "expense", "fixed", "utilidades");
  const manutencao = await oldCategory("Manutenção", "expense", "variable", "manutencao");
  const outras = await oldCategory("Outras despesas", "expense", "variable", "outras");

  balcaoEntry = await entryIn(a, balcao, "revenue", 10000, { salesChannelId: a.salesChannelId });
  folhaEntry = await entryIn(a, folha, "expense", 5000);
  insumosDeleted = await entryIn(a, insumos, "expense", 3000, { deleted: true });
  await entryIn(a, carnesOld, "expense", 2000);
  await entryIn(a, manutencao, "expense", 700);
  outraEntry = await entryIn(a, outras, "expense", 300);
  tenantBEntry = await entryIn(b, balcao, "revenue", 7000);

  // Subcategoria da empresa A, pendurada em "Insumos" (categoria antiga).
  subId = uuidv7();
  await db.admin.query(
    `insert into categories (id, tenant_id, parent_id, name, kind, nature, dre_group)
     values ($1, $2, $3, 'Frutos do mar', 'expense', 'variable', 'cmv')`,
    [subId, a.tenantId, insumos],
  );
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await db?.stop();
});

async function entryRow(id: string) {
  const { rows } = await db.admin.query(
    "select e.*, c.name as category_name, c.is_sensitive from entries e join categories c on c.id = e.category_id where e.id = $1",
    [id],
  );
  return rows[0];
}

describe("realinhamento das categorias do sistema (RF07.Obs3)", () => {
  it("reclassifica pelo de-para com versão do sistema e sem tocar no canal de venda", async () => {
    await realignSystemCategories(adminDb);

    const balcao = await entryRow(balcaoEntry);
    expect(balcao.category_name).toBe("Vendas");
    expect(balcao.sales_channel_id).toBe(a.salesChannelId);
    expect(balcao.version).toBe(2);

    const { rows: versions } = await db.admin.query(
      "select * from entry_versions where entry_id = $1 and version = 2",
      [balcaoEntry],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ channel: "system", action: "update" });
    expect(versions[0].before.categoryId).toBe(old.get("Balcão"));
    expect(versions[0].after.categoryId).toBe(await systemId("Vendas"));
    expect(versions[0].after.salesChannelId).toBe(a.salesChannelId);
    expect(versions[0].after.version).toBe(2);
    expect(versions[0].after.amountCents).toBe(10000);

    // Excluído também é reclassificado, e continua excluído.
    const deleted = await entryRow(insumosDeleted);
    expect(deleted.category_name).toBe("Mercearia");
    expect(deleted.deleted_at).not.toBeNull();

    // Outra empresa.
    expect((await entryRow(tenantBEntry)).category_name).toBe("Vendas");
  });

  it("Folha de pagamento vira Salários e segue sensível", async () => {
    const folha = await entryRow(folhaEntry);
    expect(folha.category_name).toBe("Salários");
    expect(folha.is_sensitive).toBe(true);
  });

  it("filha antiga de Insumos vira a categoria nova de primeiro nível", async () => {
    const { rows } = await db.admin.query(
      "select c.name, c.parent_id, c.tenant_id from entries e join categories c on c.id = e.category_id where e.category_id <> $1 and e.description = 'teste' and c.name = 'Carnes'",
      [carnesOld],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ parent_id: null, tenant_id: null });
  });

  it("categorias de mesmo nome ganham o grupo novo e as antigas ficam inativas", async () => {
    const { rows } = await db.admin.query<{ name: string; dre_group: string; status: string }>(
      "select name, dre_group, status from categories where tenant_id is null and parent_id is null and status = 'active'",
    );
    const group = (name: string) => rows.find((r) => r.name === name)?.dre_group;
    expect(group("Manutenção")).toBe("operacionais");
    expect(group("Outras despesas")).toBe("operacionais");
    expect((await entryRow(outraEntry)).category_name).toBe("Outras despesas");

    const inactive = await db.admin.query<{ name: string }>(
      "select name from categories where tenant_id is null and status = 'inactive' order by name",
    );
    expect(inactive.rows.map((r) => r.name)).toEqual([
      "Balcão",
      "Carnes",
      "Delivery",
      "Folha de pagamento",
      "Insumos",
      "Internet",
      "Salão",
    ]);
    // Toda a lista nova está ativa.
    expect(rows.map((r) => r.name)).toContain("Pró-labore");
    expect(rows).toHaveLength(32);
  });

  it("subcategoria da empresa muda de pai e herda tipo e grupo", async () => {
    const { rows } = await db.admin.query(
      "select parent_id, kind, dre_group from categories where id = $1",
      [subId],
    );
    expect(rows[0]).toMatchObject({
      parent_id: await systemId("Mercearia"),
      kind: "expense",
      dre_group: "cmv",
    });
  });

  it("rodar de novo não cria categoria nem versão e não muda nada", async () => {
    const before = await snapshot();
    const result = await realignSystemCategories(adminDb);
    expect(await snapshot()).toBe(before);
    expect(result).toMatchObject({ entriesReclassified: 0, categoriesCreated: 0 });
  });

  it("o dashboard agrupa pelos grupos novos", async () => {
    const rows = await withTenant(appDb, a.tenantId, (tx) =>
      reportReader.breakdown(
        tx,
        { unitIds: [a.unitId], canSeePayroll: true },
        { from: "2026-10-01", to: "2026-10-31" },
        "category",
      ),
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.amountCents]));
    expect(byKey).toEqual({
      cmv: 2000, // Carnes; o lançamento excluído de Mercearia não entra
      pessoal: 5000,
      operacionais: 1000,
      outras: 10000, // "Categoria própria" da fixture da empresa, fora do realinhamento
    });
  });
});
