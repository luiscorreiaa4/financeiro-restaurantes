import type { EntryScope } from "@app/core";
import {
  type EntryListQuery,
  type EntrySort,
  entryDetailSchema,
  entryFiltersSchema,
  entryItemSchema,
  entryListQuerySchema,
  entryOptionsSchema,
  type SortDirection,
  trashQuerySchema,
} from "@app/core/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, createPool, type Database, withTenant } from "../src/client";
import { entryReader, InvalidCursorError } from "../src/entry-reader";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let appPool: ReturnType<typeof createPool>;
let appDb: Database;
/** Fuso padrão das unidades das fixtures. */
const TZ = "America/Sao_Paulo";
let a: TenantFixture;
let b: TenantFixture;

// Cadastros extras da empresa A.
let unit2: string;
let staffId: string;
let payrollCategoryId: string;
let category2: string;
let supplier2: string;
/** Usuário sem vínculo na empresa A: a política de `users` não mostra o nome. */
let outsider: string;

/** Dono: todas as unidades, todos os autores, vê folha. */
const OWNER: EntryScope = { unitIds: "all", ownerUserId: null, includeSensitive: true };
let managerNoPayroll: EntryScope;
let staff: EntryScope;

interface NewEntry {
  tenant: TenantFixture;
  occurredOn: string;
  amountCents: number;
  type?: "expense" | "revenue";
  unitId?: string;
  paidOn?: string;
  description?: string;
  categoryId?: string | null;
  supplierId?: string;
  paymentMethodId?: string;
  salesChannelId?: string;
  createdBy?: string;
  /** Instante com microssegundos, como texto; sem ele vale `now()`. */
  createdAt?: string;
  flags?: string[];
  channel?: string;
  orders?: number;
  deleted?: boolean;
  /** Só com `deleted`: último dia na lixeira; sem ele vale hoje + 30. */
  restorableUntil?: string;
  deleteReason?: string;
  inboundMessageId?: string;
  /** Posição dentro da mensagem de origem. */
  position?: number;
  /** Versão 1 em `entry_versions`: `false` não grava; texto troca a ação (padrão `create`). */
  firstVersion?: false | "create" | "update";
}

async function insertEntry(e: NewEntry): Promise<string> {
  const id = uuidv7();
  const type = e.type ?? "expense";
  const createdBy = e.createdBy ?? e.tenant.userId;
  await db.admin.query(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
       amount_cents, net_cents, category_id, supplier_id, payment_method_id, sales_channel_id,
       created_by, created_at, flags, orders, deleted_at, deleted_by, restorable_until,
       delete_reason, inbound_message_id, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13,
       coalesce($14::timestamptz, now()), $15::text[], $16,
       case when $17 then now() end, case when $17 then $13::uuid end,
       case when $17 then coalesce($18::date, current_date + 30) end,
       $19, $20, $21)`,
    [
      id,
      e.tenant.tenantId,
      e.unitId ?? e.tenant.unitId,
      type,
      e.occurredOn,
      e.paidOn ?? e.occurredOn,
      e.description ?? "Lançamento",
      e.amountCents,
      e.categoryId === undefined ? e.tenant.categoryId : e.categoryId,
      e.supplierId ?? null,
      e.paymentMethodId ?? null,
      e.salesChannelId ?? (type === "revenue" ? e.tenant.salesChannelId : null),
      createdBy,
      e.createdAt ?? null,
      e.flags ?? [],
      e.orders ?? null,
      e.deleted ?? false,
      e.restorableUntil ?? null,
      e.deleteReason ?? null,
      e.inboundMessageId ?? null,
      e.position ?? 0,
    ],
  );
  if (e.firstVersion === false) return id;
  await db.admin.query(
    `insert into entry_versions (id, tenant_id, entry_id, version, action, after, changed_by, channel)
     values ($1, $2, $3, 1, $6, '{}', $4, $5)`,
    [
      uuidv7(),
      e.tenant.tenantId,
      id,
      createdBy,
      e.channel ?? "whatsapp",
      e.firstVersion ?? "create",
    ],
  );
  return id;
}

function queryFor(month: string, overrides: Record<string, unknown> = {}): EntryListQuery {
  const lastDay = month === "2026-10" ? "31" : month === "2026-02" ? "28" : "31";
  return entryListQuerySchema.parse({
    from: `${month}-01`,
    to: `${month}-${lastDay}`,
    ...overrides,
  });
}

function list(tenantId: string, scope: EntryScope, query: EntryListQuery) {
  return withTenant(appDb, tenantId, (tx) => entryReader.list(tx, scope, query));
}

/** Hoje, para a lixeira: os lançamentos excluídos pelo auxiliar vencem em hoje + 30. */
const TODAY = "2026-06-15";

function find(tenantId: string, scope: EntryScope, id: string, today = TODAY) {
  return withTenant(appDb, tenantId, (tx) => entryReader.find(tx, scope, id, today));
}

function versions(tenantId: string, entryId: string) {
  return withTenant(appDb, tenantId, (tx) => entryReader.versions(tx, entryId));
}

function source(tenantId: string, entryId: string) {
  return withTenant(appDb, tenantId, (tx) => entryReader.source(tx, entryId));
}

function options(tenantId: string, scope: EntryScope) {
  return withTenant(appDb, tenantId, (tx) => entryReader.options(tx, scope));
}

interface NewMessage {
  tenant: TenantFixture;
  type: "text" | "audio" | "image";
  userId?: string;
  text?: string;
  transcription?: string;
  mediaKey?: string;
  receivedAt?: string;
}

async function insertMessage(m: NewMessage): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into inbound_messages (id, tenant_id, user_id, wa_message_id, type, text,
       transcription, media_key, raw, status, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, '{}', 'processed', coalesce($9::timestamptz, now()))`,
    [
      id,
      m.tenant.tenantId,
      m.userId ?? m.tenant.userId,
      `wamid.${id}`,
      m.type,
      m.text ?? null,
      m.transcription ?? null,
      m.mediaKey ?? null,
      m.receivedAt ?? null,
    ],
  );
  return id;
}

async function insertVersion(v: {
  tenant: TenantFixture;
  entryId: string;
  version: number;
  action: string;
  channel: string;
  changedBy: string;
  before?: unknown;
  after: unknown;
  changedAt?: string;
}): Promise<void> {
  await db.admin.query(
    `insert into entry_versions (id, tenant_id, entry_id, version, action, before, after,
       changed_by, channel, changed_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, coalesce($10::timestamptz, now()))`,
    [
      uuidv7(),
      v.tenant.tenantId,
      v.entryId,
      v.version,
      v.action,
      v.before === undefined ? null : JSON.stringify(v.before),
      JSON.stringify(v.after),
      v.changedBy,
      v.channel,
      v.changedAt ?? null,
    ],
  );
}

function totals(tenantId: string, scope: EntryScope, query: EntryListQuery) {
  return withTenant(appDb, tenantId, (tx) => entryReader.totals(tx, scope, query));
}

async function listIds(scope: EntryScope, query: EntryListQuery): Promise<string[]> {
  const page = await list(a.tenantId, scope, query);
  expect(page.nextCursor).toBeNull();
  return page.rows.map((row) => row.id).sort();
}

/** Percorre todas as páginas e devolve os ids na ordem em que vieram. */
async function allPages(scope: EntryScope, query: EntryListQuery): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await list(a.tenantId, scope, { ...query, cursor });
    expect(result.rows.length).toBeLessThanOrEqual(query.limit);
    ids.push(...result.rows.map((row) => row.id));
    if (result.nextCursor === null) return ids;
    cursor = result.nextCursor;
  }
  throw new Error("paginação não terminou");
}

const SORT_COLUMN: Record<EntrySort, string> = {
  created_at: "created_at",
  occurred_on: "occurred_on",
  paid_on: "paid_on",
  amount: "amount_cents",
};

/** Ordem esperada, por um SELECT independente do leitor. */
async function expectedOrder(
  month: string,
  sort: EntrySort,
  dir: SortDirection,
): Promise<string[]> {
  const query = queryFor(month);
  const result = await db.admin.query<{ id: string }>(
    `select id from entries
      where tenant_id = $1 and occurred_on between $2 and $3 and deleted_at is null
      order by ${SORT_COLUMN[sort]} ${dir}, id ${dir}`,
    [a.tenantId, query.from, query.to],
  );
  return result.rows.map((row) => row.id);
}

// Meses usados (cada grupo de testes tem o seu, para um não enxergar os dados do outro):
// 2026-01 paginação; 2026-02 inserção entre páginas; 2026-03 filtros, busca e recorte;
// 2026-10 lançamento do fixture (chave de acesso).
const PAGING = "2026-01";
const BETWEEN = "2026-02";
const MAIN = "2026-03";
const FIXTURE = "2026-10";

const main: Record<
  "meat" | "gas" | "sales" | "payroll" | "branch" | "trashed" | "noCategory" | "staffPayroll",
  string
> = {
  meat: "",
  gas: "",
  sales: "",
  payroll: "",
  branch: "",
  trashed: "",
  noCategory: "",
  staffPayroll: "",
};
let tenantBEntry: string;

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = createPool(db.urls.app);
  appDb = createDatabase(appPool);
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");

  unit2 = uuidv7();
  await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Filial')", [
    unit2,
    a.tenantId,
  ]);
  staffId = uuidv7();
  await db.admin.query("insert into users (id, name, email) values ($1, 'Lançadora', $2)", [
    staffId,
    `${staffId}@ex.com`,
  ]);
  await db.admin.query(
    "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, 'staff')",
    [uuidv7(), a.tenantId, staffId],
  );
  payrollCategoryId = uuidv7();
  await db.admin.query(
    `insert into categories (id, tenant_id, name, kind, dre_group, is_sensitive)
     values ($1, $2, 'Folha', 'expense', 'outras', true)`,
    [payrollCategoryId, a.tenantId],
  );
  category2 = uuidv7();
  await db.admin.query(
    `insert into categories (id, tenant_id, name, kind, dre_group)
     values ($1, $2, 'Energia', 'expense', 'outras')`,
    [category2, a.tenantId],
  );
  supplier2 = uuidv7();
  await db.admin.query("insert into suppliers (id, tenant_id, name) values ($1, $2, $3)", [
    supplier2,
    a.tenantId,
    "Atacadão Central",
  ]);

  outsider = uuidv7();
  await db.admin.query("insert into users (id, name, email) values ($1, 'Sem vínculo', $2)", [
    outsider,
    `${outsider}@ex.com`,
  ]);

  managerNoPayroll = { unitIds: [a.unitId], ownerUserId: null, includeSensitive: false };
  staff = { unitIds: [a.unitId], ownerUserId: staffId, includeSensitive: false };

  // --- 2026-01: paginação. Valores, datas e instantes repetidos de propósito.
  const paging: Array<[createdAt: string, amount: number, occurred: string, paid: string]> = [
    // Mesmo milissegundo, microssegundos diferentes (R1).
    ["2026-01-05T10:00:00.000001Z", 1000, "2026-01-02", "2026-01-15"],
    ["2026-01-05T10:00:00.000002Z", 1000, "2026-01-02", "2026-01-15"],
    // Mesmo instante exato: só o id desempata.
    ["2026-01-05T10:00:00.500000Z", 1000, "2026-01-02", "2026-01-02"],
    ["2026-01-05T10:00:00.500000Z", 2000, "2026-01-03", "2026-01-20"],
    ["2026-01-06T08:30:00.123456Z", 2000, "2026-01-03", "2026-01-20"],
    ["2026-01-06T08:30:00.123999Z", 3000, "2026-01-10", "2026-01-20"],
    ["2026-01-07T23:59:59.999999Z", 500, "2026-01-10", "2026-01-10"],
  ];
  for (const [createdAt, amountCents, occurredOn, paidOn] of paging) {
    await insertEntry({ tenant: a, createdAt, amountCents, occurredOn, paidOn });
  }

  // --- 2026-03: filtros, busca e recorte.
  main.meat = await insertEntry({
    tenant: a,
    occurredOn: "2026-03-02",
    amountCents: 45000,
    description: "Compra de carne",
    supplierId: a.supplierId,
  });
  main.gas = await insertEntry({
    tenant: a,
    occurredOn: "2026-03-03",
    amountCents: 12050,
    description: "Gás 100% natural",
    createdBy: staffId,
    channel: "web",
    flags: ["category_to_review"],
    paymentMethodId: a.paymentMethodId,
  });
  main.sales = await insertEntry({
    tenant: a,
    type: "revenue",
    occurredOn: "2026-03-04",
    paidOn: "2026-03-06",
    amountCents: 300000,
    description: "Vendas do salão",
    channel: "import",
    orders: 30,
  });
  main.payroll = await insertEntry({
    tenant: a,
    occurredOn: "2026-03-05",
    amountCents: 500000,
    description: "Salário cozinha",
    categoryId: payrollCategoryId,
  });
  main.branch = await insertEntry({
    tenant: a,
    unitId: unit2,
    occurredOn: "2026-03-06",
    amountCents: 7000,
    description: "Luz da filial",
    categoryId: category2,
    supplierId: supplier2,
  });
  main.trashed = await insertEntry({
    tenant: a,
    occurredOn: "2026-03-07",
    amountCents: 9900,
    description: "Lançamento excluído",
    deleted: true,
  });
  main.noCategory = await insertEntry({
    tenant: a,
    occurredOn: "2026-03-08",
    amountCents: 1500,
    description: "taxa_extra <script>alert(1)</script>",
    categoryId: null,
    createdBy: staffId,
    flags: ["old_date"],
  });
  main.staffPayroll = await insertEntry({
    tenant: a,
    occurredOn: "2026-03-09",
    amountCents: 80000,
    description: "Vale da equipe",
    categoryId: payrollCategoryId,
    createdBy: staffId,
  });

  tenantBEntry = await insertEntry({
    tenant: b,
    occurredOn: "2026-03-02",
    amountCents: 45000,
    description: "Compra de carne",
  });
});

afterAll(async () => {
  await appPool?.end();
  await db?.stop();
});

const everyMain = () =>
  [
    main.meat,
    main.gas,
    main.sales,
    main.payroll,
    main.branch,
    main.noCategory,
    main.staffPayroll,
  ].sort();

describe("paginação por cursor (RF22.Obs3, DD-35)", () => {
  const sorts: EntrySort[] = ["created_at", "occurred_on", "paid_on", "amount"];
  const dirs: SortDirection[] = ["desc", "asc"];
  const cases = sorts.flatMap((sort) => dirs.map((dir) => ({ sort, dir })));

  it.each(cases)(
    "ordenado por $sort $dir, as páginas cobrem tudo na ordem certa, sem repetir nem pular (R1, R2)",
    async ({ sort, dir }) => {
      const expected = await expectedOrder(PAGING, sort, dir);
      expect(expected).toHaveLength(7);
      // Com 1 por página toda fronteira cai entre empatados; com 3, no meio dos grupos.
      for (const limit of [1, 2, 3]) {
        const ids = await allPages(OWNER, queryFor(PAGING, { sort, dir, limit }));
        expect(ids).toEqual(expected);
      }
    },
  );

  it("dois lançamentos criados no mesmo milissegundo, na fronteira da página, não se repetem nem somem (R1)", async () => {
    const expected = await expectedOrder(PAGING, "created_at", "asc");
    const first = await list(
      a.tenantId,
      OWNER,
      queryFor(PAGING, { sort: "created_at", dir: "asc", limit: 1 }),
    );
    expect(first.rows.map((row) => row.id)).toEqual([expected[0]]);
    const second = await list(
      a.tenantId,
      OWNER,
      queryFor(PAGING, {
        sort: "created_at",
        dir: "asc",
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    expect(second.rows.map((row) => row.id)).toEqual([expected[1]]);
    // Os dois diferem só nos microssegundos, que o instante ISO devolvido preserva.
    expect(first.rows[0]?.createdAt).toBe("2026-01-05T10:00:00.000001Z");
    expect(second.rows[0]?.createdAt).toBe("2026-01-05T10:00:00.000002Z");
  });

  it("vários lançamentos com o mesmo valor atravessando a página desempatam pelo id (R2)", async () => {
    const page = await list(
      a.tenantId,
      OWNER,
      queryFor(PAGING, { sort: "amount", dir: "asc", limit: 2 }),
    );
    // 500, depois o primeiro dos três de 1000; os outros dois ficam para a página seguinte.
    expect(page.rows.map((row) => row.amountCents)).toEqual([500, 1000]);
    const next = await list(
      a.tenantId,
      OWNER,
      queryFor(PAGING, {
        sort: "amount",
        dir: "asc",
        limit: 2,
        cursor: page.nextCursor ?? undefined,
      }),
    );
    expect(next.rows.map((row) => row.amountCents)).toEqual([1000, 1000]);
    const sameAmount = [page.rows[1]?.id, ...next.rows.map((row) => row.id)];
    expect(new Set(sameAmount).size).toBe(3);
    expect(sameAmount).toEqual([...sameAmount].sort());
  });

  it("a última página não devolve cursor, e a página cheia que acaba junto com os dados também não", async () => {
    const page = await list(a.tenantId, OWNER, queryFor(PAGING, { limit: 7 }));
    expect(page.rows).toHaveLength(7);
    expect(page.nextCursor).toBeNull();
  });

  it("lançamento inserido entre as páginas não repete nem derruba nenhum (RF22.CA04)", async () => {
    const originals: string[] = [];
    for (const second of ["01", "02", "03", "04"]) {
      originals.push(
        await insertEntry({
          tenant: a,
          occurredOn: "2026-02-10",
          amountCents: 100,
          createdAt: `2026-02-10T12:00:${second}.000000Z`,
        }),
      );
    }
    const newestFirst = [...originals].reverse();
    const first = await list(a.tenantId, OWNER, queryFor(BETWEEN, { limit: 2 }));
    expect(first.rows.map((row) => row.id)).toEqual(newestFirst.slice(0, 2));

    // Chega um lançamento novo (o mais recente) antes de o usuário pedir a página 2.
    const late = await insertEntry({ tenant: a, occurredOn: "2026-02-11", amountCents: 100 });

    const second = await list(
      a.tenantId,
      OWNER,
      queryFor(BETWEEN, { limit: 2, cursor: first.nextCursor ?? undefined }),
    );
    expect(second.rows.map((row) => row.id)).toEqual(newestFirst.slice(2));
    expect(second.rows.map((row) => row.id)).not.toContain(late);
  });

  it("cursor ilegível é recusado com InvalidCursorError", async () => {
    const broken = [
      "isto-nao-e-um-cursor",
      Buffer.from("{}").toString("base64url"),
      Buffer.from(
        JSON.stringify({
          s: "created_at",
          d: "desc",
          v: "x'; drop table entries; --",
          id: a.entryId,
        }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          s: "created_at",
          d: "desc",
          v: "2026-13-45T99:00:00.000000Z",
          id: a.entryId,
        }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ s: "created_at", d: "desc", v: "2026-01-05T10:00:00.000001Z", id: "abc" }),
      ).toString("base64url"),
    ];
    for (const cursor of broken) {
      await expect(list(a.tenantId, OWNER, queryFor(PAGING, { cursor }))).rejects.toBeInstanceOf(
        InvalidCursorError,
      );
    }
  });

  it("cursor de outra ordenação ou de outro sentido é recusado com InvalidCursorError", async () => {
    const page = await list(
      a.tenantId,
      OWNER,
      queryFor(PAGING, { sort: "amount", dir: "asc", limit: 2 }),
    );
    const cursor = page.nextCursor ?? undefined;
    expect(cursor).toBeDefined();
    await expect(
      list(a.tenantId, OWNER, queryFor(PAGING, { sort: "amount", dir: "desc", limit: 2, cursor })),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(
      list(a.tenantId, OWNER, queryFor(PAGING, { sort: "paid_on", dir: "asc", limit: 2, cursor })),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe("linha da lista", () => {
  it("traz os campos do contrato, com nomes dos cadastros, origem pela versão 1 e dinheiro em centavos inteiros", async () => {
    const page = await list(a.tenantId, OWNER, queryFor(MAIN, { type: "revenue" }));
    const row = page.rows[0];
    expect(row).toMatchObject({
      id: main.sales,
      version: 1,
      type: "revenue",
      occurredOn: "2026-03-04",
      paidOn: "2026-03-06",
      description: "Vendas do salão",
      quantity: null,
      quantityUnit: null,
      orders: 30,
      amountCents: 300000,
      feeCents: 0,
      netCents: 300000,
      category: { id: a.categoryId, name: "Categoria própria" },
      supplier: null,
      paymentMethod: null,
      salesChannel: { id: a.salesChannelId, name: "Salão" },
      unit: { id: a.unitId, name: "Matriz" },
      createdBy: { id: a.userId, name: "Dono" },
      createdById: a.userId,
      originChannel: "import",
      flags: [],
      categoryIsSensitive: false,
      deletedAt: null,
    });
    expect(Number.isSafeInteger(row?.amountCents)).toBe(true);
    const item = entryItemSchema.safeParse({
      ...row,
      canEdit: true,
      canDelete: true,
      canRestore: false,
    });
    expect(item.success).toBe(true);
  });

  it("lançamento sem categoria aparece com categoria nula e não é sensível; o de folha vem marcado como sensível", async () => {
    const page = await list(a.tenantId, OWNER, queryFor(MAIN));
    const noCategory = page.rows.find((row) => row.id === main.noCategory);
    expect(noCategory?.category).toBeNull();
    expect(noCategory?.categoryIsSensitive).toBe(false);
    expect(noCategory?.flags).toEqual(["old_date"]);
    const payroll = page.rows.find((row) => row.id === main.payroll);
    expect(payroll?.category).toEqual({ id: payrollCategoryId, name: "Folha" });
    expect(payroll?.categoryIsSensitive).toBe(true);
  });
});

describe("filtros (RF22)", () => {
  it("sem filtro, o dono vê todos os lançamentos do período, menos os da lixeira (RF22.Obs5)", async () => {
    const ids = await listIds(OWNER, queryFor(MAIN));
    expect(ids).toEqual(everyMain());
    expect(ids).not.toContain(main.trashed);
  });

  it("o período filtra a data de competência, com os dois extremos incluídos", async () => {
    const query = entryListQuerySchema.parse({ from: "2026-03-03", to: "2026-03-04" });
    expect(await listIds(OWNER, query)).toEqual([main.gas, main.sales].sort());
  });

  it("filtra por tipo", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { type: "revenue" }))).toEqual([main.sales]);
  });

  it("filtra por categorias", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { categoryIds: [category2] }))).toEqual([
      main.branch,
    ]);
    expect(
      await listIds(OWNER, queryFor(MAIN, { categoryIds: [category2, payrollCategoryId] })),
    ).toEqual([main.branch, main.payroll, main.staffPayroll].sort());
  });

  it("filtra por fornecedor", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { supplierId: supplier2 }))).toEqual([main.branch]);
  });

  it("filtra por forma de pagamento", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { paymentMethodId: a.paymentMethodId }))).toEqual([
      main.gas,
    ]);
  });

  it("filtra por canal de venda", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { salesChannelId: a.salesChannelId }))).toEqual([
      main.sales,
    ]);
  });

  it("filtra por quem lançou", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { createdBy: staffId }))).toEqual(
      [main.gas, main.noCategory, main.staffPayroll].sort(),
    );
  });

  it("filtra pelo canal de origem, que é o canal da versão 1", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { originChannel: "web" }))).toEqual([main.gas]);
    expect(await listIds(OWNER, queryFor(MAIN, { originChannel: "import" }))).toEqual([main.sales]);
    expect(await listIds(OWNER, queryFor(MAIN, { originChannel: "email" }))).toEqual([]);
  });

  it("filtra por sinais de revisão: basta ter um dos sinais pedidos (RF22.R4)", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { flags: ["category_to_review"] }))).toEqual([
      main.gas,
    ]);
    expect(
      await listIds(OWNER, queryFor(MAIN, { flags: ["category_to_review", "old_date"] })),
    ).toEqual([main.gas, main.noCategory].sort());
    expect(await listIds(OWNER, queryFor(MAIN, { flags: ["possible_duplicate"] }))).toEqual([]);
  });
});

describe("busca livre (RF22.R5)", () => {
  it('"450,00" e "450" acham o lançamento de valor exato R$ 450,00 (RF22.CA05)', async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { q: "450,00" }))).toEqual([main.meat]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "450" }))).toEqual([main.meat]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "451" }))).toEqual([]);
  });

  it("acha por trecho da descrição, sem diferenciar maiúsculas", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { q: "CARNE" }))).toEqual([main.meat]);
  });

  it("acha pelo nome do fornecedor", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { q: "atacadão" }))).toEqual([main.branch]);
  });

  it("acha pela chave de acesso de 44 dígitos da nota da mensagem de origem", async () => {
    expect(await listIds(OWNER, queryFor(FIXTURE, { q: a.accessKey }))).toEqual([a.entryId]);
    // A chave da nota da empresa B não acha nada na empresa A.
    expect(await listIds(OWNER, queryFor(FIXTURE, { q: b.accessKey }))).toEqual([]);
  });

  it("trata %, _ e <script> como texto literal, sem coringa e sem erro (R5)", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { q: "%" }))).toEqual([main.gas]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "100%" }))).toEqual([main.gas]);
    // Como coringa, "100_" casaria com "100%".
    expect(await listIds(OWNER, queryFor(MAIN, { q: "100_" }))).toEqual([]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "_" }))).toEqual([main.noCategory]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "<script>" }))).toEqual([main.noCategory]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "\\" }))).toEqual([]);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "' or 1=1 --" }))).toEqual([]);
  });

  it("a busca não acha lançamento da lixeira nem fora do recorte", async () => {
    expect(await listIds(OWNER, queryFor(MAIN, { q: "excluído" }))).toEqual([]);
    expect(await listIds(managerNoPayroll, queryFor(MAIN, { q: "salário" }))).toEqual([]);
    expect(await listIds(managerNoPayroll, queryFor(MAIN, { q: "5000" }))).toEqual([]);
    expect(await listIds(staff, queryFor(MAIN, { q: "carne" }))).toEqual([]);
  });
});

describe("recorte de visibilidade (RF06.R3, RF06.R5, RF22.R2, RF22.R3)", () => {
  it("unidade fora do recorte não aparece", async () => {
    const onlyUnit1: EntryScope = { ...OWNER, unitIds: [a.unitId] };
    expect(await listIds(onlyUnit1, queryFor(MAIN))).not.toContain(main.branch);
    const onlyUnit2: EntryScope = { ...OWNER, unitIds: [unit2] };
    expect(await listIds(onlyUnit2, queryFor(MAIN))).toEqual([main.branch]);
    const both: EntryScope = { ...OWNER, unitIds: [a.unitId, unit2] };
    expect(await listIds(both, queryFor(MAIN))).toEqual(everyMain());
  });

  it("recorte com lista de unidades vazia não vê nada: zero linhas e totais zerados, sem aviso de restritos", async () => {
    for (const includeSensitive of [true, false]) {
      const none: EntryScope = { unitIds: [], ownerUserId: null, includeSensitive };
      expect(await list(a.tenantId, none, queryFor(MAIN))).toEqual({ rows: [], nextCursor: null });
      expect(await totals(a.tenantId, none, queryFor(MAIN))).toEqual({
        revenueCents: 0,
        expenseCents: 0,
        count: 0,
        hasRestricted: false,
      });
    }
  });

  it("gerente sem VER_FOLHA não vê lançamento de categoria sensível, mas vê o que não tem categoria", async () => {
    expect(await listIds(managerNoPayroll, queryFor(MAIN))).toEqual(
      [main.meat, main.gas, main.sales, main.noCategory].sort(),
    );
  });

  it("gerente sem VER_FOLHA que pede a categoria sensível recebe lista vazia, total zero e o aviso de restritos (R3, RF06.CA02)", async () => {
    const query = queryFor(MAIN, { categoryIds: [payrollCategoryId] });
    expect(await list(a.tenantId, managerNoPayroll, query)).toEqual({
      rows: [],
      nextCursor: null,
    });
    expect(await totals(a.tenantId, managerNoPayroll, query)).toEqual({
      revenueCents: 0,
      expenseCents: 0,
      count: 0,
      hasRestricted: true,
    });
  });

  it("o aviso de restritos olha só período e unidade: busca e demais filtros não o mudam (F3-3, DD-39)", async () => {
    expect((await totals(a.tenantId, managerNoPayroll, queryFor(MAIN))).hasRestricted).toBe(true);
    // Filtrar não revela nada: com ou sem acerto no dado de folha, a resposta é a mesma.
    const noMatch = [
      { type: "revenue" as const },
      { q: "texto-que-nao-existe" },
      { createdBy: staff.ownerUserId ?? undefined },
      { supplierId: "00000000-0000-4000-8000-000000000000" },
    ];
    for (const filter of noMatch) {
      expect(
        (await totals(a.tenantId, managerNoPayroll, queryFor(MAIN, filter))).hasRestricted,
      ).toBe(true);
    }
    // Outra unidade: a folha está na Matriz.
    const branchManager: EntryScope = { ...managerNoPayroll, unitIds: [unit2] };
    expect((await totals(a.tenantId, branchManager, queryFor(MAIN))).hasRestricted).toBe(false);
    // Outro período.
    expect((await totals(a.tenantId, managerNoPayroll, queryFor(PAGING))).hasRestricted).toBe(
      false,
    );
    // Sensível que está na lixeira não conta.
    await insertEntry({
      tenant: a,
      occurredOn: "2026-04-10",
      amountCents: 100,
      categoryId: payrollCategoryId,
      deleted: true,
    });
    expect(
      (
        await totals(
          a.tenantId,
          managerNoPayroll,
          entryListQuerySchema.parse({ from: "2026-04-01", to: "2026-04-30" }),
        )
      ).hasRestricted,
    ).toBe(false);
    // Quem vê folha nunca recebe o aviso.
    expect((await totals(a.tenantId, OWNER, queryFor(MAIN))).hasRestricted).toBe(false);
  });

  it("lançador só vê os próprios lançamentos, nunca os sensíveis, e não recebe o aviso de restritos (RF22.R3)", async () => {
    expect(await listIds(staff, queryFor(MAIN))).toEqual([main.gas, main.noCategory].sort());
    const result = await totals(a.tenantId, staff, queryFor(MAIN));
    expect(result).toEqual({
      revenueCents: 0,
      expenseCents: 12050 + 1500,
      count: 2,
      hasRestricted: false,
    });
  });

  it('o filtro "lançado por" enviado por um lançador é ignorado', async () => {
    expect(await listIds(staff, queryFor(MAIN, { createdBy: a.userId }))).toEqual(
      [main.gas, main.noCategory].sort(),
    );
    expect((await totals(a.tenantId, staff, queryFor(MAIN, { createdBy: a.userId }))).count).toBe(
      2,
    );
  });
});

describe("totais (RF22.Obs2, RF22.Obs7)", () => {
  async function independentSum(extraWhere = "") {
    const query = queryFor(MAIN);
    const result = await db.admin.query<{ revenue: string; expense: string; count: string }>(
      `select coalesce(sum(amount_cents) filter (where type = 'revenue'), 0) as revenue,
              coalesce(sum(amount_cents) filter (where type = 'expense'), 0) as expense,
              count(*) as count
         from entries
        where tenant_id = $1 and occurred_on between $2 and $3 and deleted_at is null ${extraWhere}`,
      [a.tenantId, query.from, query.to],
    );
    const row = result.rows[0];
    return {
      revenueCents: Number(row?.revenue),
      expenseCents: Number(row?.expense),
      count: Number(row?.count),
    };
  }

  it("são iguais a um SELECT sum independente e ignoram a paginação (RF22.CA02)", async () => {
    const expected = await independentSum();
    expect(expected).toEqual({
      revenueCents: 300000,
      expenseCents: 45000 + 12050 + 500000 + 7000 + 1500 + 80000,
      count: 7,
    });
    // `limit` e `cursor` não mudam os totais.
    const page = await list(a.tenantId, OWNER, queryFor(MAIN, { limit: 2 }));
    const result = await totals(
      a.tenantId,
      OWNER,
      queryFor(MAIN, { limit: 2, cursor: page.nextCursor ?? undefined }),
    );
    expect(result).toEqual({ ...expected, hasRestricted: false });
  });

  it("seguem os filtros da lista", async () => {
    expect(await totals(a.tenantId, OWNER, queryFor(MAIN, { q: "450" }))).toEqual({
      revenueCents: 0,
      expenseCents: 45000,
      count: 1,
      hasRestricted: false,
    });
    expect(await totals(a.tenantId, OWNER, queryFor(MAIN, { type: "revenue" }))).toEqual({
      revenueCents: 300000,
      expenseCents: 0,
      count: 1,
      hasRestricted: false,
    });
  });

  it("para quem não vê folha, não somam os sensíveis e avisam que existem (RF22.Obs7)", async () => {
    const expected = await independentSum(
      `and unit_id = '${a.unitId}' and (category_id is null or category_id <> '${payrollCategoryId}')`,
    );
    expect(expected).toEqual({
      revenueCents: 300000,
      expenseCents: 45000 + 12050 + 1500,
      count: 4,
    });
    expect(await totals(a.tenantId, managerNoPayroll, queryFor(MAIN))).toEqual({
      ...expected,
      hasRestricted: true,
    });
  });

  it("período sem lançamento devolve zeros", async () => {
    const empty = entryListQuerySchema.parse({ from: "2025-06-01", to: "2025-06-30" });
    expect(await totals(a.tenantId, OWNER, empty)).toEqual({
      revenueCents: 0,
      expenseCents: 0,
      count: 0,
      hasRestricted: false,
    });
  });
});

describe("paginação dentro do recorte restrito", () => {
  it("gerente sem VER_FOLHA percorre as páginas sem repetir e sem receber sensível", async () => {
    const ids = await allPages(managerNoPayroll, queryFor(MAIN, { limit: 2 }));
    expect(ids).toHaveLength(4);
    expect([...ids].sort()).toEqual([main.meat, main.gas, main.sales, main.noCategory].sort());
    expect(ids).not.toContain(main.payroll);
    expect(ids).not.toContain(main.staffPayroll);
  });

  it("lançador percorre as páginas só com os próprios, sem repetir e sem sensível", async () => {
    for (const sort of ["created_at", "amount"] as const) {
      const ids = await allPages(staff, queryFor(MAIN, { limit: 1, sort, dir: "asc" }));
      expect(ids).toHaveLength(2);
      expect([...ids].sort()).toEqual([main.gas, main.noCategory].sort());
    }
  });
});

describe("dado incompleto falha fechado", () => {
  // 2026-05: lançamentos que o canal não produz, gravados direto no banco.
  const EDGE = "2026-05";
  let foreignCategory: string;
  let noVersion: string;
  let wrongFirstVersion: string;
  let orphanAuthor: string;
  let outsiderId: string;

  beforeAll(async () => {
    // O gatilho `entries_category_scope` só confere a categoria ao gravar o lançamento. Uma
    // categoria que muda de empresa depois (aqui, pelo administrador) fica escondida pelo RLS
    // na junção, e o lançamento continua apontando para ela.
    const hiddenCategory = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group)
       values ($1, $2, 'Categoria que vai sumir', 'expense', 'outras')`,
      [hiddenCategory, a.tenantId],
    );
    foreignCategory = await insertEntry({
      tenant: a,
      occurredOn: "2026-05-02",
      amountCents: 700,
      description: "Categoria que a junção não resolve",
      categoryId: hiddenCategory,
    });
    await db.admin.query("update categories set tenant_id = $2 where id = $1", [
      hiddenCategory,
      b.tenantId,
    ]);
    noVersion = await insertEntry({
      tenant: a,
      occurredOn: "2026-05-03",
      amountCents: 900,
      firstVersion: false,
    });
    wrongFirstVersion = await insertEntry({
      tenant: a,
      occurredOn: "2026-05-04",
      amountCents: 1000,
      firstVersion: "update",
      channel: "email",
    });
    // Autor sem vínculo na empresa: a política de `users` não o mostra.
    outsiderId = uuidv7();
    await db.admin.query("insert into users (id, name, email) values ($1, 'De fora', $2)", [
      outsiderId,
      `${outsiderId}@ex.com`,
    ]);
    orphanAuthor = await insertEntry({
      tenant: a,
      occurredOn: "2026-05-05",
      amountCents: 1100,
      createdBy: outsiderId,
      channel: "web",
    });
  });

  it("lançamento com categoria que não vem na junção é tratado como sensível: some para quem não vê folha e vira aviso de restritos", async () => {
    const ids = await listIds(managerNoPayroll, queryFor(EDGE));
    expect(ids).toEqual([noVersion, wrongFirstVersion, orphanAuthor].sort());
    expect(await totals(a.tenantId, managerNoPayroll, queryFor(EDGE))).toEqual({
      revenueCents: 0,
      expenseCents: 900 + 1000 + 1100,
      count: 3,
      hasRestricted: true,
    });
    expect(await listIds(managerNoPayroll, queryFor(EDGE, { q: "junção" }))).toEqual([]);
  });

  it("quem vê folha recebe esse lançamento marcado como sensível e sem categoria", async () => {
    const page = await list(a.tenantId, OWNER, queryFor(EDGE));
    const row = page.rows.find((candidate) => candidate.id === foreignCategory);
    expect(row?.category).toBeNull();
    expect(row?.categoryIsSensitive).toBe(true);
    expect((await totals(a.tenantId, OWNER, queryFor(EDGE))).count).toBe(4);
  });

  it("lançamento sem versão 1 de criação aparece com origem system e é achado pelo filtro de origem system", async () => {
    const page = await list(a.tenantId, OWNER, queryFor(EDGE));
    const origin = (id: string) => page.rows.find((row) => row.id === id)?.originChannel;
    expect(origin(noVersion)).toBe("system");
    // Versão 1 que não é a criação não dá a origem.
    expect(origin(wrongFirstVersion)).toBe("system");
    expect(await listIds(OWNER, queryFor(EDGE, { originChannel: "system" }))).toEqual(
      [noVersion, wrongFirstVersion].sort(),
    );
    expect(await listIds(OWNER, queryFor(EDGE, { originChannel: "email" }))).toEqual([]);
    expect(
      (await totals(a.tenantId, OWNER, queryFor(EDGE, { originChannel: "system" }))).count,
    ).toBe(2);
  });

  it("o detalhe desse lançamento não existe para quem não vê folha, e vem sensível para o dono", async () => {
    expect(await find(a.tenantId, managerNoPayroll, foreignCategory)).toBeNull();
    const detail = await find(a.tenantId, OWNER, foreignCategory);
    expect(detail?.category).toBeNull();
    expect(detail?.categoryIsSensitive).toBe(true);
  });

  it("lançamento de autor sem vínculo na empresa aparece com o nome vazio", async () => {
    const page = await list(a.tenantId, OWNER, queryFor(EDGE, { originChannel: "web" }));
    expect(page.rows.map((row) => row.id)).toEqual([orphanAuthor]);
    expect(page.rows[0]?.createdBy).toEqual({ id: outsiderId, name: "" });
    expect(page.rows[0]?.createdById).toBe(outsiderId);
  });
});

describe("isolamento entre empresas (RNF02)", () => {
  it("a empresa B é invisível para a empresa A, na lista, na busca e nos totais", async () => {
    const ids = await listIds(OWNER, queryFor(MAIN));
    expect(ids).not.toContain(tenantBEntry);
    expect(await listIds(OWNER, queryFor(MAIN, { q: "Compra de carne" }))).toEqual([main.meat]);
    expect(await listIds(OWNER, queryFor(FIXTURE))).toEqual([a.entryId]);
  });

  it("a empresa B só vê o que é dela", async () => {
    const page = await list(b.tenantId, OWNER, queryFor(MAIN));
    expect(page.rows.map((row) => row.id)).toEqual([tenantBEntry]);
    expect(page.rows[0]?.unit.id).toBe(b.unitId);
    expect(await totals(b.tenantId, OWNER, queryFor(MAIN))).toEqual({
      revenueCents: 0,
      expenseCents: 45000,
      count: 1,
      hasRestricted: false,
    });
    // Recorte com unidade da empresa A, dentro da empresa B: nada.
    const foreign: EntryScope = { ...OWNER, unitIds: [a.unitId] };
    expect((await list(b.tenantId, foreign, queryFor(MAIN))).rows).toEqual([]);
  });
});

describe("detalhe do lançamento (1.6 e 1.7 do desenho, RF24.R2)", () => {
  let trashed: string;
  let staffTrashed: string;

  beforeAll(async () => {
    trashed = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-02",
      amountCents: 4200,
      description: "Excluído, ainda restaurável",
      deleted: true,
      restorableUntil: "2026-06-30",
      deleteReason: "Lançado em dobro",
    });
    staffTrashed = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-03",
      amountCents: 4300,
      createdBy: staffId,
      deleted: true,
      restorableUntil: "2026-06-30",
    });
  });

  it("traz a linha da lista mais as taxas copiadas e a última alteração, no formato do contrato", async () => {
    const detail = await find(a.tenantId, OWNER, main.sales);
    expect(detail).toMatchObject({
      id: main.sales,
      type: "revenue",
      occurredOn: "2026-03-04",
      paidOn: "2026-03-06",
      amountCents: 300000,
      netCents: 300000,
      salesChannel: { id: a.salesChannelId, name: "Salão" },
      unit: { id: a.unitId, name: "Matriz" },
      createdBy: { id: a.userId, name: "Dono" },
      originChannel: "import",
      categoryIsSensitive: false,
      feePercentBp: 0,
      feeFixedCents: 0,
      deletedAt: null,
      deleted: null,
    });
    const parsed = entryDetailSchema.safeParse({
      ...detail,
      canEdit: true,
      canDelete: true,
      canRestore: false,
      versions: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("devolve nulo para lançamento de unidade fora do recorte", async () => {
    expect(await find(a.tenantId, managerNoPayroll, main.branch)).toBeNull();
    expect((await find(a.tenantId, { ...OWNER, unitIds: [unit2] }, main.branch))?.id).toBe(
      main.branch,
    );
    expect(await find(a.tenantId, { ...OWNER, unitIds: [unit2] }, main.meat)).toBeNull();
  });

  it("devolve nulo para recorte sem unidade nenhuma, mesmo para quem vê folha", async () => {
    for (const includeSensitive of [true, false]) {
      const none: EntryScope = { unitIds: [], ownerUserId: null, includeSensitive };
      expect(await find(a.tenantId, none, main.meat)).toBeNull();
    }
  });

  it("devolve nulo para lançamento sensível quando o ator não vê folha, e o dono o recebe", async () => {
    expect(await find(a.tenantId, managerNoPayroll, main.payroll)).toBeNull();
    const detail = await find(a.tenantId, OWNER, main.payroll);
    expect(detail?.categoryIsSensitive).toBe(true);
    expect(detail?.category).toEqual({ id: payrollCategoryId, name: "Folha" });
  });

  it("lançador só abre o próprio lançamento, e nem o próprio quando é sensível", async () => {
    expect((await find(a.tenantId, staff, main.gas))?.id).toBe(main.gas);
    expect(await find(a.tenantId, staff, main.meat)).toBeNull();
    expect(await find(a.tenantId, staff, main.staffPayroll)).toBeNull();
  });

  it("lançamento na lixeira aparece até o último dia restaurável, com quem excluiu, quando e o motivo", async () => {
    const detail = await find(a.tenantId, OWNER, trashed, "2026-06-30");
    expect(detail?.deleted).toMatchObject({
      by: { id: a.userId, name: "Dono" },
      reason: "Lançado em dobro",
      restorableUntil: "2026-06-30",
    });
    expect(detail?.deleted?.at).toBe(detail?.deletedAt);
    expect(detail?.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const parsed = entryDetailSchema.safeParse({
      ...detail,
      canEdit: false,
      canDelete: false,
      canRestore: true,
      versions: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("devolve nulo para lançamento na lixeira vencida (RF24.R2)", async () => {
    expect(await find(a.tenantId, OWNER, trashed, "2026-07-01")).toBeNull();
  });

  it("a lixeira respeita o mesmo recorte: lançador não abre o excluído de outro", async () => {
    expect(await find(a.tenantId, staff, trashed)).toBeNull();
    expect((await find(a.tenantId, staff, staffTrashed))?.id).toBe(staffTrashed);
    expect(await find(a.tenantId, { ...OWNER, unitIds: [unit2] }, trashed)).toBeNull();
  });

  it("devolve nulo para lançamento de outra empresa, id inexistente e id malformado", async () => {
    expect(await find(a.tenantId, OWNER, tenantBEntry)).toBeNull();
    expect(await find(a.tenantId, OWNER, b.entryId)).toBeNull();
    expect(await find(a.tenantId, OWNER, uuidv7())).toBeNull();
    expect(await find(a.tenantId, OWNER, "x' or 1=1 --")).toBeNull();
    expect((await find(b.tenantId, OWNER, tenantBEntry))?.id).toBe(tenantBEntry);
  });

  it("recusa a data de hoje malformada em vez de consultar", async () => {
    await expect(find(a.tenantId, OWNER, main.meat, "30/06/2026")).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});

describe("histórico de versões (RF25.R4)", () => {
  let corrected: string;

  beforeAll(async () => {
    corrected = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-05",
      amountCents: 25000,
      createdBy: staffId,
      channel: "whatsapp",
    });
    // Gravadas fora de ordem: quem ordena é o leitor.
    await insertVersion({
      tenant: a,
      entryId: corrected,
      version: 3,
      action: "delete",
      channel: "web",
      changedBy: outsider,
      before: { deletedAt: null },
      after: { deleteReason: "<b>erro</b>" },
      changedAt: "2026-06-07T09:00:00.000003Z",
    });
    await insertVersion({
      tenant: a,
      entryId: corrected,
      version: 2,
      action: "update",
      channel: "web",
      changedBy: a.userId,
      before: { amountCents: 20000, categoryId: a.categoryId },
      after: { amountCents: 25000, categoryId: a.categoryId },
      changedAt: "2026-06-06T12:30:00.123456Z",
    });
  });

  it("vêm em ordem crescente: criação pelo WhatsApp, depois alteração pelo painel, com antes e depois crus (RF25.CA01)", async () => {
    const history = await versions(a.tenantId, corrected);
    expect(history.map((version) => version.version)).toEqual([1, 2, 3]);
    expect(history[0]).toMatchObject({
      version: 1,
      action: "create",
      channel: "whatsapp",
      changedBy: { id: staffId, name: "Lançadora" },
      before: null,
      after: {},
    });
    expect(history[1]).toEqual({
      version: 2,
      action: "update",
      channel: "web",
      changedBy: { id: a.userId, name: "Dono" },
      changedAt: "2026-06-06T12:30:00.123456Z",
      before: { amountCents: 20000, categoryId: a.categoryId },
      after: { amountCents: 25000, categoryId: a.categoryId },
    });
  });

  it("autor de versão sem vínculo na empresa aparece com o nome vazio", async () => {
    const history = await versions(a.tenantId, corrected);
    expect(history[2]?.changedBy).toEqual({ id: outsider, name: "" });
    expect(history[2]?.after).toEqual({ deleteReason: "<b>erro</b>" });
  });

  it("lançamento sem versão gravada devolve lista vazia, e id malformado também", async () => {
    const bare = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-05",
      amountCents: 100,
      firstVersion: false,
    });
    expect(await versions(a.tenantId, bare)).toEqual([]);
    expect(await versions(a.tenantId, "nao-e-uuid")).toEqual([]);
  });

  it("as versões da empresa B são invisíveis para a empresa A (RNF02)", async () => {
    expect(await versions(a.tenantId, b.entryId)).toEqual([]);
    expect(await versions(a.tenantId, tenantBEntry)).toEqual([]);
    expect((await versions(b.tenantId, b.entryId)).map((version) => version.version)).toEqual([1]);
  });
});

describe("origem do lançamento (RF25, RF25.Obs1)", () => {
  const IMAGE_KEY = "35261012345678000190550010000004561000004567";
  let fromText: string;
  let fromAudio: string;
  let fromImage: string;
  let manual: string;
  let mixedPlain: string;
  let mixedPayroll: string;
  let twoPlain: string;
  let withTrashedPayroll: string;
  let withUnresolvedCategory: string;

  beforeAll(async () => {
    const textMessage = await insertMessage({
      tenant: a,
      type: "text",
      userId: staffId,
      text: "gastei 50 de gás <script>alert(1)</script>",
      receivedAt: "2026-06-10T14:00:00.654321Z",
    });
    fromText = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-10",
      amountCents: 5000,
      createdBy: staffId,
      inboundMessageId: textMessage,
    });

    const audioMessage = await insertMessage({
      tenant: a,
      type: "audio",
      transcription: "paguei duzentos de luz",
      mediaKey: "tenants/a/audio.ogg",
    });
    fromAudio = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-10",
      amountCents: 20000,
      inboundMessageId: audioMessage,
    });

    const imageMessage = await insertMessage({
      tenant: a,
      type: "image",
      mediaKey: "tenants/a/nota.jpg",
    });
    await db.admin.query(
      `insert into fiscal_documents (id, tenant_id, access_key, inbound_message_id, source, created_by)
       values ($1, $2, $3, $4, 'qrcode_sefaz', $5)`,
      [uuidv7(), a.tenantId, IMAGE_KEY, imageMessage, a.userId],
    );
    fromImage = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-10",
      amountCents: 31000,
      inboundMessageId: imageMessage,
    });

    manual = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-10",
      amountCents: 800,
      channel: "web",
    });

    const mixedMessage = await insertMessage({
      tenant: a,
      type: "text",
      text: "mercado 100 e salário do João 3000",
    });
    mixedPlain = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 10000,
      inboundMessageId: mixedMessage,
      position: 0,
    });
    mixedPayroll = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 300000,
      categoryId: payrollCategoryId,
      inboundMessageId: mixedMessage,
      position: 1,
    });

    const plainMessage = await insertMessage({ tenant: a, type: "text", text: "gás 50 e luz 70" });
    twoPlain = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 5000,
      inboundMessageId: plainMessage,
      position: 0,
    });
    await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 7000,
      categoryId: null,
      inboundMessageId: plainMessage,
      position: 1,
    });

    const trashedMessage = await insertMessage({
      tenant: a,
      type: "text",
      text: "pão 20 e vale da Maria 500",
    });
    withTrashedPayroll = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 2000,
      inboundMessageId: trashedMessage,
      position: 0,
    });
    await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 50000,
      categoryId: payrollCategoryId,
      inboundMessageId: trashedMessage,
      position: 1,
      deleted: true,
      restorableUntil: "2020-01-01",
    });

    // Irmão cuja categoria a junção não resolve (mesmo artifício de "dado incompleto").
    const hiddenCategory = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group)
       values ($1, $2, 'Outra que vai sumir', 'expense', 'outras')`,
      [hiddenCategory, a.tenantId],
    );
    const unresolvedMessage = await insertMessage({ tenant: a, type: "text", text: "dois itens" });
    withUnresolvedCategory = await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 100,
      inboundMessageId: unresolvedMessage,
      position: 0,
    });
    await insertEntry({
      tenant: a,
      occurredOn: "2026-06-11",
      amountCents: 200,
      categoryId: hiddenCategory,
      inboundMessageId: unresolvedMessage,
      position: 1,
    });
    await db.admin.query("update categories set tenant_id = $2 where id = $1", [
      hiddenCategory,
      b.tenantId,
    ]);
  });

  it("de texto: traz o texto original como veio, quem enviou e quando", async () => {
    expect(await source(a.tenantId, fromText)).toEqual({
      channel: "whatsapp",
      kind: "text",
      text: "gastei 50 de gás <script>alert(1)</script>",
      transcription: null,
      accessKey: null,
      sentBy: { id: staffId, name: "Lançadora" },
      sentAt: "2026-06-10T14:00:00.654321Z",
      siblingsSensitive: false,
    });
  });

  it("de áudio: traz a transcrição", async () => {
    expect(await source(a.tenantId, fromAudio)).toMatchObject({
      channel: "whatsapp",
      kind: "audio",
      text: null,
      transcription: "paguei duzentos de luz",
      accessKey: null,
      sentBy: { id: a.userId, name: "Dono" },
      siblingsSensitive: false,
    });
  });

  it("de imagem: traz a chave de acesso da nota, e nunca o local do arquivo", async () => {
    const result = await source(a.tenantId, fromImage);
    expect(result).toMatchObject({ kind: "image", accessKey: IMAGE_KEY, text: null });
    expect(JSON.stringify(result)).not.toContain("nota.jpg");
  });

  it("lançamento sem mensagem de origem: tipo none, sem remetente e sem data", async () => {
    expect(await source(a.tenantId, manual)).toEqual({
      channel: "web",
      kind: "none",
      text: null,
      transcription: null,
      accessKey: null,
      sentBy: null,
      sentAt: null,
      siblingsSensitive: false,
    });
  });

  it("avisa quando a mesma mensagem gerou outro lançamento de categoria sensível (RF25.Obs1)", async () => {
    expect((await source(a.tenantId, mixedPlain))?.siblingsSensitive).toBe(true);
    // O irmão do lançamento de folha é o comum.
    expect((await source(a.tenantId, mixedPayroll))?.siblingsSensitive).toBe(false);
    expect((await source(a.tenantId, twoPlain))?.siblingsSensitive).toBe(false);
  });

  it("o aviso vale mesmo com o irmão sensível na lixeira vencida: o texto da mensagem continua citando a folha", async () => {
    expect((await source(a.tenantId, withTrashedPayroll))?.siblingsSensitive).toBe(true);
  });

  it("irmão com categoria que a junção não resolve conta como sensível (falha fechado)", async () => {
    expect((await source(a.tenantId, withUnresolvedCategory))?.siblingsSensitive).toBe(true);
  });

  it("a origem e a nota fiscal da empresa B são invisíveis para a empresa A (RNF02)", async () => {
    expect(await source(a.tenantId, b.entryId)).toBeNull();
    expect(await source(a.tenantId, uuidv7())).toBeNull();
    expect(await source(a.tenantId, "nao-e-uuid")).toBeNull();
    expect((await source(a.tenantId, a.entryId))?.accessKey).toBe(a.accessKey);
    expect(await source(b.tenantId, b.entryId)).toMatchObject({
      kind: "text",
      text: "gastei 100 no mercado",
      accessKey: b.accessKey,
    });
  });
});

describe("opções de filtro e nomes dos cadastros (1.7 do desenho)", () => {
  it("dono recebe categorias (inclusive a sensível), fornecedores, formas, canais, unidades e membros da empresa, no formato do contrato", async () => {
    const result = await options(a.tenantId, OWNER);
    expect(entryOptionsSchema.safeParse(result).success).toBe(true);
    expect(result.categories).toContainEqual({
      id: payrollCategoryId,
      name: "Folha",
      kind: "expense",
      parentId: null,
      requiresQuantity: false,
      active: true,
    });
    expect(result.categories.map((category) => category.id)).toContain(a.categoryId);
    expect(result.suppliers).toEqual([
      { id: supplier2, name: "Atacadão Central" },
      { id: a.supplierId, name: "Fornecedor" },
    ]);
    expect(result.paymentMethods).toEqual([{ id: a.paymentMethodId, name: "Pix", active: true }]);
    expect(result.salesChannels).toEqual([{ id: a.salesChannelId, name: "Salão", active: true }]);
    expect(result.units).toEqual([
      { id: unit2, name: "Filial", active: true, defaultSalesChannelId: null, timezone: TZ },
      { id: a.unitId, name: "Matriz", active: true, defaultSalesChannelId: null, timezone: TZ },
    ]);
    expect(result.members.map((member) => member.name)).toEqual(["Dono", "Lançadora"]);
    expect(result.members).toContainEqual({ id: staffId, name: "Lançadora" });
  });

  it("quem não vê folha não recebe a categoria sensível", async () => {
    const result = await options(a.tenantId, managerNoPayroll);
    expect(result.categories.map((category) => category.id)).not.toContain(payrollCategoryId);
    expect(result.categories.map((category) => category.id)).toContain(a.categoryId);
    expect(JSON.stringify(result)).not.toContain("Folha");
    expect(result.members).toHaveLength(2);
  });

  it('"lançado por" lista só autores com lançamento no recorte (F3-4, DD-39)', async () => {
    const c = await createTenant(db.admin, "Autores do filtro");
    const addAuthor = async (name: string, role: string) => {
      const id = uuidv7();
      await db.admin.query("insert into users (id, name, email) values ($1, $2, $3)", [
        id,
        name,
        `${id}@ex.com`,
      ]);
      await db.admin.query(
        "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, $4)",
        [uuidv7(), c.tenantId, id, role],
      );
      return id;
    };
    const payrollOnly = await addAuthor("Só folha", "manager");
    const otherUnit = await addAuthor("Outra unidade", "staff");
    await addAuthor("Contadora sem lançamento", "accountant");
    const regular = await addAuthor("Com lançamento", "staff");
    const unit = uuidv7();
    await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Outra')", [
      unit,
      c.tenantId,
    ]);
    const payroll = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group, is_sensitive)
       values ($1, $2, 'Folha C', 'expense', 'outras', true)`,
      [payroll, c.tenantId],
    );
    await insertEntry({
      tenant: c,
      occurredOn: "2026-04-10",
      amountCents: 100,
      createdBy: regular,
    });
    await insertEntry({
      tenant: c,
      occurredOn: "2026-04-10",
      amountCents: 100,
      createdBy: payrollOnly,
      categoryId: payroll,
    });
    await insertEntry({
      tenant: c,
      occurredOn: "2026-04-10",
      amountCents: 100,
      createdBy: otherUnit,
      unitId: unit,
    });

    const names = async (scope: EntryScope) =>
      (await options(c.tenantId, scope)).members.map((member) => member.name);
    const all = { unitIds: "all" as const, ownerUserId: null };
    // O "Dono" vem do lançamento que a fixture `createTenant` já cria na unidade principal.
    // Vê todo autor que lançou, nunca quem não lançou nada.
    expect(await names({ ...all, includeSensitive: true })).toEqual([
      "Com lançamento",
      "Dono",
      "Outra unidade",
      "Só folha",
    ]);
    // Gerente sem VER_FOLHA: sem o autor que só lançou folha.
    expect(await names({ ...all, includeSensitive: false })).toEqual([
      "Com lançamento",
      "Dono",
      "Outra unidade",
    ]);
    // Só a unidade de acesso: sem o autor de outra unidade.
    expect(
      await names({ unitIds: [c.unitId], ownerUserId: null, includeSensitive: false }),
    ).toEqual(["Com lançamento", "Dono"]);
  });

  it("as unidades são só as do recorte, e recorte sem unidade não recebe nenhuma", async () => {
    expect((await options(a.tenantId, managerNoPayroll)).units.map((unit) => unit.id)).toEqual([
      a.unitId,
    ]);
    expect((await options(a.tenantId, { ...OWNER, unitIds: [] })).units).toEqual([]);
    // Unidade da empresa B pedida dentro da empresa A: nada.
    expect((await options(a.tenantId, { ...OWNER, unitIds: [b.unitId] })).units).toEqual([]);
  });

  it("lançador não recebe a lista de membros nem a categoria sensível", async () => {
    const result = await options(a.tenantId, staff);
    expect(result.members).toEqual([]);
    expect(result.categories.map((category) => category.id)).not.toContain(payrollCategoryId);
    expect(result.units.map((unit) => unit.id)).toEqual([a.unitId]);
  });

  it("traz cadastro inativo marcado, o canal padrão e o fuso da unidade (F3c-2)", async () => {
    const c = await createTenant(db.admin, "Opções do formulário");
    await db.admin.query(
      "update units set status = 'inactive', timezone = $2, default_sales_channel_id = $3 where id = $1",
      [c.unitId, "America/Manaus", c.salesChannelId],
    );
    await db.admin.query("update payment_methods set status = 'inactive' where id = $1", [
      c.paymentMethodId,
    ]);
    await db.admin.query("update sales_channels set status = 'inactive' where id = $1", [
      c.salesChannelId,
    ]);
    await db.admin.query("update categories set status = 'inactive' where id = $1", [c.categoryId]);
    const result = await options(c.tenantId, OWNER);
    expect(entryOptionsSchema.safeParse(result).success).toBe(true);
    expect(result.units).toEqual([
      {
        id: c.unitId,
        name: expect.any(String),
        active: false,
        defaultSalesChannelId: c.salesChannelId,
        timezone: "America/Manaus",
      },
    ]);
    expect(result.paymentMethods.map((item) => item.active)).toEqual([false]);
    expect(result.salesChannels.map((item) => item.active)).toEqual([false]);
    expect(result.categories.find((item) => item.id === c.categoryId)?.active).toBe(false);
  });

  it("nada da empresa B aparece nas opções da empresa A (RNF02)", async () => {
    const result = await options(a.tenantId, OWNER);
    const ids = [
      ...result.categories,
      ...result.suppliers,
      ...result.paymentMethods,
      ...result.salesChannels,
      ...result.units,
      ...result.members,
    ].map((item) => item.id);
    for (const foreign of [
      b.categoryId,
      b.supplierId,
      b.paymentMethodId,
      b.salesChannelId,
      b.unitId,
      b.userId,
      outsider,
    ]) {
      expect(ids).not.toContain(foreign);
    }
  });

  it("os nomes dos cadastros vêm por id, com a marca de sensível, só os da empresa", async () => {
    const names = await withTenant(appDb, a.tenantId, (tx) => entryReader.names(tx));
    expect(names.categories.get(payrollCategoryId)).toEqual({ name: "Folha", isSensitive: true });
    expect(names.categories.get(a.categoryId)).toEqual({
      name: "Categoria própria",
      isSensitive: false,
    });
    expect(names.suppliers.get(supplier2)).toBe("Atacadão Central");
    expect(names.paymentMethods.get(a.paymentMethodId)).toBe("Pix");
    expect(names.salesChannels.get(a.salesChannelId)).toBe("Salão");
    expect(names.units.get(unit2)).toBe("Filial");
    expect(names.categories.has(b.categoryId)).toBe(false);
    expect(names.suppliers.has(b.supplierId)).toBe(false);
    expect(names.paymentMethods.has(b.paymentMethodId)).toBe(false);
    expect(names.salesChannels.has(b.salesChannelId)).toBe(false);
    expect(names.units.has(b.unitId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// F3b: carga para escrita, lixeira e soma do lote (RF23, RF24)
// ---------------------------------------------------------------------------------------

function load(tenantId: string, scope: EntryScope, ids: readonly string[], today = TODAY) {
  return withTenant(appDb, tenantId, (tx) => entryReader.load(tx, scope, ids, today));
}

function trash(tenantId: string, scope: EntryScope, overrides: Record<string, unknown> = {}) {
  const query = trashQuerySchema.parse({
    deletedFrom: "2026-05-01",
    deletedTo: "2026-05-31",
    ...overrides,
  });
  return withTenant(appDb, tenantId, (tx) => entryReader.trash(tx, scope, query, TODAY));
}

/** Insere um excluído e fixa o instante da exclusão (o auxiliar usa `now()`). */
async function insertTrashed(
  e: Omit<NewEntry, "deleted">,
  deletedAt: string,
  deletedBy?: string,
): Promise<string> {
  const id = await insertEntry({ ...e, deleted: true });
  await db.admin.query(
    `update entries set deleted_at = $2::timestamptz, deleted_by = coalesce($3::uuid, deleted_by)
      where id = $1`,
    [id, deletedAt, deletedBy ?? null],
  );
  return id;
}

describe("carga de lançamentos para escrita (RF23, RF24.R2)", () => {
  let active: string;
  let otherUnit: string;
  let payroll: string;
  let staffOwn: string;
  let staffOthers: string;
  let trashedOk: string;
  let trashedExpired: string;
  let noCategory: string;
  let orphanCategory: string;

  beforeAll(async () => {
    active = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-02",
      amountCents: 1500,
      description: "Ativo",
      supplierId: supplier2,
    });
    otherUnit = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-02",
      amountCents: 1600,
      unitId: unit2,
    });
    payroll = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-03",
      amountCents: 900000,
      categoryId: payrollCategoryId,
    });
    staffOwn = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-04",
      amountCents: 700,
      createdBy: staffId,
    });
    staffOthers = await insertEntry({ tenant: a, occurredOn: "2026-07-04", amountCents: 800 });
    trashedOk = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-05",
      amountCents: 1100,
      deleted: true,
      restorableUntil: "2026-06-15",
    });
    trashedExpired = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-05",
      amountCents: 1200,
      deleted: true,
      restorableUntil: "2026-06-14",
    });
    noCategory = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-06",
      amountCents: 1300,
      categoryId: null,
    });
    // Categoria de outra empresa: a junção não a resolve, então conta como sensível.
    const moved = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group)
       values ($1, $2, 'Categoria que vai sumir 2', 'expense', 'outras')`,
      [moved, a.tenantId],
    );
    orphanCategory = await insertEntry({
      tenant: a,
      occurredOn: "2026-07-06",
      amountCents: 1400,
      categoryId: moved,
    });
    await db.admin.query("update categories set tenant_id = $2 where id = $1", [moved, b.tenantId]);
  });

  it("devolve o lançamento completo (taxas copiadas, versão, fornecedor) e se a categoria é sensível", async () => {
    const [row] = await load(a.tenantId, OWNER, [active]);
    expect(row?.categoryIsSensitive).toBe(false);
    expect(row?.entry).toMatchObject({
      id: active,
      tenantId: a.tenantId,
      unitId: a.unitId,
      type: "expense",
      occurredOn: "2026-07-02",
      amountCents: 1500,
      netCents: 1500,
      feePercentBp: 0,
      feeFixedCents: 0,
      supplierId: supplier2,
      categoryId: a.categoryId,
      version: 1,
      deletedAt: null,
    });
    expect(row?.entry.createdAt).toBeInstanceOf(Date);
  });

  it("omite o que está fora do recorte (unidade, empresa, sensível sem permissão, autor)", async () => {
    const ids = [active, otherUnit, payroll, staffOwn, staffOthers, b.entryId];
    const owner = await load(a.tenantId, OWNER, ids);
    expect(owner.map((r) => r.entry.id).sort()).toEqual(
      [active, otherUnit, payroll, staffOwn, staffOthers].sort(),
    );
    const manager = await load(a.tenantId, managerNoPayroll, ids);
    expect(manager.map((r) => r.entry.id).sort()).toEqual([active, staffOwn, staffOthers].sort());
    const own = await load(a.tenantId, staff, ids);
    expect(own.map((r) => r.entry.id)).toEqual([staffOwn]);
  });

  it("gerente sem VER_FOLHA não carrega o sensível nem o de categoria que a junção não resolve", async () => {
    expect(await load(a.tenantId, managerNoPayroll, [payroll, orphanCategory])).toEqual([]);
    const owner = await load(a.tenantId, OWNER, [payroll, orphanCategory]);
    expect(owner.map((r) => r.categoryIsSensitive)).toEqual([true, true]);
  });

  it("lançamento sem categoria não é sensível", async () => {
    const [row] = await load(a.tenantId, managerNoPayroll, [noCategory]);
    expect(row?.categoryIsSensitive).toBe(false);
  });

  it("inclui a lixeira dentro do prazo (30º dia) e omite a vencida (31º dia)", async () => {
    const rows = await load(a.tenantId, OWNER, [trashedOk, trashedExpired]);
    expect(rows.map((r) => r.entry.id)).toEqual([trashedOk]);
    expect(rows[0]?.entry.deletedAt).toBeInstanceOf(Date);
  });

  it("ids malformados, vazios ou repetidos não derrubam a transação", async () => {
    expect(await load(a.tenantId, OWNER, [])).toEqual([]);
    expect(await load(a.tenantId, OWNER, ["não-é-uuid", active, active])).toHaveLength(1);
  });

  it("a empresa B não carrega lançamento da empresa A (RNF02)", async () => {
    expect(await load(b.tenantId, OWNER, [active])).toEqual([]);
  });
});

describe("lixeira (RF24.R2, S6)", () => {
  let t30: string;
  let t31: string;
  let tUnit2: string;
  let tStaff: string;
  let tPayroll: string;
  let tEarly: string;
  let tOtherTenant: string;

  beforeAll(async () => {
    // 30º dia: restaurável até hoje (inclusive). 31º dia: venceu ontem.
    t30 = await insertTrashed(
      { tenant: a, occurredOn: "2026-04-10", amountCents: 100, restorableUntil: "2026-06-15" },
      "2026-05-16T12:00:00.000003Z",
    );
    t31 = await insertTrashed(
      { tenant: a, occurredOn: "2026-04-10", amountCents: 110, restorableUntil: "2026-06-14" },
      "2026-05-15T12:00:00.000000Z",
    );
    tUnit2 = await insertTrashed(
      {
        tenant: a,
        occurredOn: "2026-04-11",
        amountCents: 120,
        unitId: unit2,
        restorableUntil: "2026-06-20",
      },
      "2026-05-20T12:00:00.000000Z",
    );
    tStaff = await insertTrashed(
      {
        tenant: a,
        occurredOn: "2026-04-12",
        amountCents: 130,
        createdBy: staffId,
        restorableUntil: "2026-06-20",
      },
      "2026-05-21T12:00:00.000000Z",
      staffId,
    );
    tPayroll = await insertTrashed(
      {
        tenant: a,
        occurredOn: "2026-04-13",
        amountCents: 140,
        categoryId: payrollCategoryId,
        restorableUntil: "2026-06-20",
      },
      "2026-05-22T12:00:00.000000Z",
    );
    tEarly = await insertTrashed(
      { tenant: a, occurredOn: "2026-04-14", amountCents: 150, restorableUntil: "2026-06-20" },
      "2026-04-20T12:00:00.000000Z",
    );
    tOtherTenant = await insertTrashed(
      { tenant: b, occurredOn: "2026-04-10", amountCents: 160, restorableUntil: "2026-06-20" },
      "2026-05-20T12:00:00.000000Z",
    );
  });

  const ids = (page: { rows: Array<{ id: string }> }) => page.rows.map((r) => r.id);

  it("lista só o que está no prazo, mantém o do 30º dia, omite o do 31º e a outra empresa", async () => {
    const page = await trash(a.tenantId, OWNER);
    const got = ids(page);
    expect(got).toContain(t30);
    expect(got).not.toContain(t31);
    expect(got).not.toContain(tOtherTenant);
    expect(got).not.toContain(tEarly);
    expect(page.nextCursor).toBeNull();
  });

  it("devolve a linha no formato do contrato com os dados da exclusão", async () => {
    const page = await trash(a.tenantId, OWNER, {
      unitIds: [a.unitId],
      deletedFrom: "2026-05-16",
      deletedTo: "2026-05-16",
    });
    expect(page.rows).toHaveLength(1);
    const row = page.rows[0];
    expect(
      entryItemSchema.omit({ canEdit: true, canDelete: true, canRestore: true }).safeParse(row)
        .success,
    ).toBe(true);
    expect(row?.deleted).toMatchObject({
      by: { id: a.userId },
      restorableUntil: "2026-06-15",
    });
    expect(row?.deleted.at).toBe("2026-05-16T12:00:00.000003Z");
  });

  it("filtra por período da exclusão (inclusive nas pontas)", async () => {
    const april = await trash(a.tenantId, OWNER, {
      deletedFrom: "2026-04-01",
      deletedTo: "2026-04-30",
    });
    expect(ids(april)).toEqual([tEarly]);
    const day = await trash(a.tenantId, OWNER, {
      deletedFrom: "2026-05-20",
      deletedTo: "2026-05-20",
    });
    expect(ids(day)).toEqual([tUnit2]);
  });

  it("filtra por unidade", async () => {
    const page = await trash(a.tenantId, OWNER, { unitIds: [unit2] });
    expect(ids(page)).toEqual([tUnit2]);
  });

  it("filtra por quem excluiu", async () => {
    const page = await trash(a.tenantId, OWNER, { deletedBy: staffId });
    expect(ids(page)).toEqual([tStaff]);
  });

  it("ordena por exclusão decrescente, com id no empate, e pagina por cursor sem repetir nem pular", async () => {
    const full = ids(await trash(a.tenantId, OWNER));
    expect(full).toEqual([tPayroll, tStaff, tUnit2, t30]);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await trash(a.tenantId, OWNER, { limit: 2, cursor });
      seen.push(...ids(page));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(full);
  });

  it("cursor adulterado é recusado", async () => {
    await expect(trash(a.tenantId, OWNER, { cursor: "xxxx" })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it("gerente sem VER_FOLHA não vê o sensível na lixeira", async () => {
    const page = await trash(a.tenantId, managerNoPayroll);
    expect(ids(page)).toEqual([tStaff, t30]);
  });

  it("lançador só vê os próprios na lixeira", async () => {
    const page = await trash(a.tenantId, staff);
    expect(ids(page)).toEqual([tStaff]);
  });

  it("recorte sem unidade não vê nada", async () => {
    const none: EntryScope = { unitIds: [], ownerUserId: null, includeSensitive: true };
    expect(ids(await trash(a.tenantId, none))).toEqual([]);
  });

  it("omite excluído sem autor da exclusão (falha fechado)", async () => {
    const noAuthor = await insertTrashed(
      { tenant: a, occurredOn: "2026-04-15", amountCents: 170, restorableUntil: "2026-06-20" },
      "2026-05-23T12:00:00.000000Z",
    );
    await db.admin.query("update entries set deleted_by = null where id = $1", [noAuthor]);
    expect(ids(await trash(a.tenantId, OWNER))).not.toContain(noAuthor);
  });

  it("quem excluiu combinado com unidade fora do recorte do lançador não devolve nada", async () => {
    const page = await trash(a.tenantId, staff, { deletedBy: staffId, unitIds: [unit2] });
    expect(ids(page)).toEqual([]);
  });

  it("o período da exclusão usa o fuso da unidade", async () => {
    const nz = uuidv7();
    await db.admin.query(
      "insert into units (id, tenant_id, name, timezone) values ($1, $2, 'Auckland', 'Pacific/Auckland')",
      [nz, a.tenantId],
    );
    // 20h UTC do dia 10 já é 08h do dia 11 em Auckland (e ainda dia 10 em São Paulo).
    const id = await insertTrashed(
      {
        tenant: a,
        occurredOn: "2026-02-10",
        amountCents: 180,
        unitId: nz,
        restorableUntil: "2026-06-20",
      },
      "2026-03-10T20:00:00.000000Z",
    );
    const day10 = await trash(a.tenantId, OWNER, {
      deletedFrom: "2026-03-10",
      deletedTo: "2026-03-10",
    });
    const day11 = await trash(a.tenantId, OWNER, {
      deletedFrom: "2026-03-11",
      deletedTo: "2026-03-11",
    });
    expect(ids(day10)).toEqual([]);
    expect(ids(day11)).toEqual([id]);
  });

  it("a empresa B só vê a lixeira dela (RNF02)", async () => {
    expect(ids(await trash(b.tenantId, OWNER))).toEqual([tOtherTenant]);
  });
});

describe("soma do lote (RF24.Obs3)", () => {
  const sum = (scope: EntryScope, ids: readonly string[], today = TODAY, tenantId = a.tenantId) =>
    withTenant(appDb, tenantId, (tx) => entryReader.sum(tx, scope, ids, today));

  it("quantidade e soma conferem com um SELECT sum independente", async () => {
    const rows = await db.admin.query<{ id: string }>(
      `select e.id from entries e join categories c on c.id = e.category_id
        where e.tenant_id = $1 and e.occurred_on between '2026-03-01' and '2026-03-31'
          and e.deleted_at is null and c.is_sensitive is false and e.unit_id = $2`,
      [a.tenantId, a.unitId],
    );
    const ids = rows.rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(2);
    const expected = await db.admin.query<{ n: number; total: string }>(
      "select count(*)::int as n, sum(amount_cents)::text as total from entries where id = any($1::uuid[])",
      [ids],
    );
    const got = await sum(OWNER, ids);
    expect(got.count).toBe(expected.rows[0]?.n);
    expect(String(got.totalCents)).toBe(expected.rows[0]?.total);
    expect(Number.isSafeInteger(got.totalCents)).toBe(true);
  });

  it("lista vazia soma zero e ids de outra empresa não entram", async () => {
    expect(await sum(OWNER, [])).toEqual({ count: 0, totalCents: 0 });
    expect(await sum(OWNER, [b.entryId])).toEqual({ count: 0, totalCents: 0 });
  });

  describe("só o que o recorte enxerga (falha fechado)", () => {
    let plain: string;
    let payroll: string;
    let orphan: string;
    let otherUnit: string;
    let own: string;
    let others: string;
    let inTrash: string;
    let expired: string;

    beforeAll(async () => {
      const base = { tenant: a, occurredOn: "2026-08-02" } as const;
      plain = await insertEntry({ ...base, amountCents: 1000 });
      payroll = await insertEntry({ ...base, amountCents: 2000, categoryId: payrollCategoryId });
      const moved = uuidv7();
      await db.admin.query(
        "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, $2, 'Some na soma', 'expense', 'outras')",
        [moved, a.tenantId],
      );
      orphan = await insertEntry({ ...base, amountCents: 4000, categoryId: moved });
      await db.admin.query("update categories set tenant_id = $2 where id = $1", [
        moved,
        b.tenantId,
      ]);
      otherUnit = await insertEntry({ ...base, amountCents: 8000, unitId: unit2 });
      own = await insertEntry({ ...base, amountCents: 16000, createdBy: staffId });
      others = await insertEntry({ ...base, amountCents: 32000 });
      inTrash = await insertEntry({
        ...base,
        amountCents: 64000,
        deleted: true,
        restorableUntil: "2026-06-15",
      });
      expired = await insertEntry({
        ...base,
        amountCents: 128000,
        deleted: true,
        restorableUntil: "2026-06-14",
      });
    });

    const all = () => [plain, payroll, orphan, otherUnit, own, others, inTrash, expired];

    it("dono soma tudo no prazo: sensível, categoria órfã, outra unidade e lixeira do 30º dia; não soma o vencido", async () => {
      expect(await sum(OWNER, all())).toEqual({
        count: 7,
        totalCents: 1000 + 2000 + 4000 + 8000 + 16000 + 32000 + 64000,
      });
    });

    it("gerente sem VER_FOLHA não soma o sensível, a categoria órfã nem a outra unidade", async () => {
      expect(await sum(managerNoPayroll, all())).toEqual({
        count: 4,
        totalCents: 1000 + 16000 + 32000 + 64000,
      });
    });

    it("lançador soma só os próprios", async () => {
      expect(await sum(staff, all())).toEqual({ count: 1, totalCents: 16000 });
    });

    it("o excluído vencido não entra, e no 30º dia entra", async () => {
      expect(await sum(OWNER, [expired])).toEqual({ count: 0, totalCents: 0 });
      expect(await sum(OWNER, [inTrash], "2026-06-15")).toEqual({ count: 1, totalCents: 64000 });
      expect(await sum(OWNER, [inTrash], "2026-06-16")).toEqual({ count: 0, totalCents: 0 });
    });
  });
});

describe("candidatos de duplicidade no recorte (RF26.R4)", () => {
  const HOUR = 60 * 60 * 1000;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
  const recent = (scope: EntryScope, tenantId = a.tenantId) =>
    withTenant(appDb, tenantId, (tx) =>
      entryReader.recent(tx, scope, new Date(Date.now() - 24 * HOUR)),
    );
  /** Descrição única: o banco tem lançamentos de outros testes criados agora. */
  const DESC = "Recente C4b";
  let plain: string;
  let payroll: string;
  let orphan: string;
  let otherUnit: string;
  let trashed: string;
  let colleague: string;
  let old25: string;
  let recent23: string;
  let tenantB: string;
  let noCategory: string;

  beforeAll(async () => {
    const base = { tenant: a, occurredOn: "2026-08-03", description: DESC } as const;
    plain = await insertEntry({ ...base, amountCents: 1111 });
    payroll = await insertEntry({ ...base, amountCents: 2222, categoryId: payrollCategoryId });
    const moved = uuidv7();
    await db.admin.query(
      "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, $2, 'Some no recente', 'expense', 'outras')",
      [moved, a.tenantId],
    );
    orphan = await insertEntry({ ...base, amountCents: 3333, categoryId: moved });
    await db.admin.query("update categories set tenant_id = $2 where id = $1", [moved, b.tenantId]);
    otherUnit = await insertEntry({ ...base, amountCents: 4444, unitId: unit2 });
    trashed = await insertEntry({ ...base, amountCents: 5555, deleted: true });
    colleague = await insertEntry({ ...base, amountCents: 6666, createdBy: staffId });
    old25 = await insertEntry({ ...base, amountCents: 7777, createdAt: hoursAgo(25) });
    recent23 = await insertEntry({ ...base, amountCents: 8888, createdAt: hoursAgo(23) });
    tenantB = await insertEntry({
      tenant: b,
      occurredOn: "2026-08-03",
      description: DESC,
      amountCents: 9999,
    });
    noCategory = await insertEntry({ ...base, amountCents: 1212, categoryId: null });
  });

  const mine = (rows: readonly { description: string; amountCents: number }[]) =>
    rows.filter((r) => r.description === DESC).map((r) => r.amountCents);

  it("devolve os campos do RecentEntry", async () => {
    const rows = await recent({ unitIds: [a.unitId], ownerUserId: null, includeSensitive: false });
    const row = rows.find((r) => r.amountCents === 1111);
    expect(row).toEqual({
      inboundMessageId: null,
      amountCents: 1111,
      supplierId: null,
      description: DESC,
      occurredOn: "2026-08-03",
    });
    expect(plain).toBeDefined();
  });

  it("sensível invisível não entra (nem a categoria órfã); com VER_FOLHA entra", async () => {
    const hidden = mine(
      await recent({ unitIds: [a.unitId], ownerUserId: null, includeSensitive: false }),
    );
    expect(hidden).not.toContain(2222);
    expect(hidden).not.toContain(3333);
    const seen = mine(
      await recent({ unitIds: [a.unitId], ownerUserId: null, includeSensitive: true }),
    );
    expect(seen).toContain(2222);
    expect(seen).toContain(3333);
    expect(payroll).toBeDefined();
    expect(orphan).toBeDefined();
  });

  it("outra unidade fica de fora; recorte com as duas unidades traz as duas", async () => {
    const one = mine(
      await recent({ unitIds: [a.unitId], ownerUserId: null, includeSensitive: true }),
    );
    expect(one).not.toContain(4444);
    const both = mine(
      await recent({ unitIds: [a.unitId, unit2], ownerUserId: null, includeSensitive: true }),
    );
    expect(both).toContain(4444);
    expect(otherUnit).toBeDefined();
  });

  it("outra empresa nunca entra, mesmo com recorte 'all'", async () => {
    const rows = mine(await recent(OWNER));
    expect(rows).not.toContain(9999);
    expect(mine(await recent(OWNER, b.tenantId))).toEqual([9999]);
    expect(tenantB).toBeDefined();
  });

  it("lançamento sem categoria não é sensível: entra mesmo sem VER_FOLHA", async () => {
    const rows = await recent({ unitIds: [a.unitId], ownerUserId: null, includeSensitive: false });
    expect(mine(rows)).toContain(1212);
    expect(noCategory).toBeDefined();
  });

  it("lançamento na lixeira não entra", async () => {
    expect(mine(await recent(OWNER))).not.toContain(5555);
    expect(trashed).toBeDefined();
  });

  it("o lançador enxerga também o lançamento do colega na mesma unidade", async () => {
    const rows = mine(await recent({ ...staff, unitIds: [a.unitId] }));
    expect(rows).toContain(1111);
    expect(rows).toContain(6666);
    expect(colleague).toBeDefined();
  });

  it("o teto de linhas devolve só os mais recentes (F3c-4)", async () => {
    const rows = await withTenant(appDb, a.tenantId, (tx) =>
      entryReader.recent(tx, OWNER, new Date(Date.now() - 24 * HOUR), 2),
    );
    expect(rows).toHaveLength(2);
    const all = await recent(OWNER);
    expect(all.length).toBeGreaterThan(2);
    expect(rows).toEqual(all.slice(0, 2));
  });

  it("janela por created_at: 25 h atrás fica de fora e 23 h atrás entra", async () => {
    const rows = mine(await recent(OWNER));
    expect(rows).not.toContain(7777);
    expect(rows).toContain(8888);
    expect(old25).toBeDefined();
    expect(recent23).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------
// F5: leitura para exportação (RF29, CA01)
// ---------------------------------------------------------------------------------------

describe("leitura para exportação (RF29)", () => {
  const EXPORT_MONTH = "2027-03";
  let parentCategoryId: string;
  let childCategoryId: string;
  let supplierWithDocument: string;
  let tenantBExportEntry: string;
  const ids: Record<"child" | "parentOnly" | "deleted" | "versioned" | "deletedPayroll", string> = {
    child: "",
    parentOnly: "",
    deleted: "",
    versioned: "",
    deletedPayroll: "",
  };

  function exportRows(
    tenantId: string,
    scope: EntryScope,
    filters: Record<string, unknown>,
    opts: { includeDeleted?: boolean; limit?: number } = {},
  ) {
    const parsed = entryFiltersSchema.parse(filters);
    return withTenant(appDb, tenantId, (tx) =>
      entryReader.exportRows(tx, scope, parsed, {
        includeDeleted: opts.includeDeleted ?? false,
        limit: opts.limit ?? 1000,
      }),
    );
  }

  beforeAll(async () => {
    parentCategoryId = uuidv7();
    childCategoryId = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group, nature)
       values ($1, $2, 'Insumos', 'expense', 'cmv', 'variable')`,
      [parentCategoryId, a.tenantId],
    );
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group, nature, parent_id)
       values ($1, $2, 'Carnes', 'expense', 'cmv', 'variable', $3)`,
      [childCategoryId, a.tenantId, parentCategoryId],
    );
    supplierWithDocument = uuidv7();
    await db.admin.query(
      "insert into suppliers (id, tenant_id, name, document) values ($1, $2, 'Frigorífico Sul', '12345678000195')",
      [supplierWithDocument, a.tenantId],
    );
    ids.child = await insertEntry({
      tenant: a,
      occurredOn: `${EXPORT_MONTH}-02`,
      amountCents: 10000,
      description: "Picanha",
      categoryId: childCategoryId,
      supplierId: supplierWithDocument,
    });
    ids.parentOnly = await insertEntry({
      tenant: a,
      occurredOn: `${EXPORT_MONTH}-03`,
      amountCents: 5000,
      description: "Só o pai",
      categoryId: parentCategoryId,
    });
    ids.deleted = await insertEntry({
      tenant: a,
      occurredOn: `${EXPORT_MONTH}-04`,
      amountCents: 700,
      description: "Excluído do mês",
      deleted: true,
    });
    ids.versioned = await insertEntry({
      tenant: a,
      occurredOn: `${EXPORT_MONTH}-05`,
      amountCents: 300,
      description: "Com histórico",
    });
    await insertVersion({
      tenant: a,
      entryId: ids.versioned,
      version: 2,
      action: "update",
      channel: "web",
      changedBy: a.userId,
      before: { amountCents: 300 },
      after: { amountCents: 350 },
    });
    // Folha na lixeira, de autoria da lançadora: nem gerente sem folha nem lançador a recebem.
    ids.deletedPayroll = await insertEntry({
      tenant: a,
      occurredOn: `${EXPORT_MONTH}-07`,
      amountCents: 90000,
      description: "Folha excluída",
      categoryId: payrollCategoryId,
      createdBy: staffId,
      deleted: true,
    });
    const bCategory = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, name, kind, dre_group)
       values ($1, $2, 'Exclusiva da empresa B', 'expense', 'outras')`,
      [bCategory, b.tenantId],
    );
    tenantBExportEntry = await insertEntry({
      tenant: b,
      occurredOn: `${EXPORT_MONTH}-02`,
      amountCents: 4200,
      description: "Só da empresa B",
      categoryId: bCategory,
    });
  });

  const MAIN_FILTERS = { from: "2026-03-01", to: "2026-03-31" };

  it("paridade com os totais da lista: contagem e soma por tipo (CA01)", async () => {
    const unitScope: EntryScope = { unitIds: [unit2], ownerUserId: null, includeSensitive: true };
    const cases: Array<[string, EntryScope, Record<string, unknown>]> = [
      ["período", OWNER, MAIN_FILTERS],
      ["período e tipo", OWNER, { ...MAIN_FILTERS, type: "revenue" }],
      ["período e unidade", unitScope, MAIN_FILTERS],
      ["gerente sem folha, período", managerNoPayroll, MAIN_FILTERS],
      ["lançador, período", staff, MAIN_FILTERS],
    ];
    for (const [label, scope, filters] of cases) {
      const rows = await exportRows(a.tenantId, scope, filters);
      const t = await totals(a.tenantId, scope, queryFor("2026-03", filters));
      const sum = (type: string) =>
        rows.filter((r) => r.type === type).reduce((acc, r) => acc + r.amountCents, 0);
      expect(rows.length, label).toBe(t.count);
      expect(sum("revenue"), label).toBe(t.revenueCents);
      expect(sum("expense"), label).toBe(t.expenseCents);
      expect(rows.length, label).toBeGreaterThan(0);
    }
  });

  it("gerente sem VER_FOLHA nunca recebe linha sensível; o contador recebe", async () => {
    const manager = await exportRows(a.tenantId, managerNoPayroll, MAIN_FILTERS);
    const descriptions = manager.map((r) => r.description);
    expect(descriptions).not.toContain("Salário cozinha");
    expect(descriptions).not.toContain("Vale da equipe");
    expect(descriptions).toContain("Compra de carne");

    const accountant = await exportRows(a.tenantId, OWNER, MAIN_FILTERS);
    expect(accountant.map((r) => r.description)).toEqual(
      expect.arrayContaining(["Salário cozinha", "Vale da equipe"]),
    );
  });

  it("o limite vale depois do filtro de sensibilidade", async () => {
    const all = await exportRows(a.tenantId, managerNoPayroll, MAIN_FILTERS);
    const limited = await exportRows(a.tenantId, managerNoPayroll, MAIN_FILTERS, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((r) => r.description)).toEqual(all.slice(0, 2).map((r) => r.description));
  });

  it("lançador só recebe os próprios lançamentos", async () => {
    const rows = await exportRows(a.tenantId, staff, MAIN_FILTERS);
    expect(rows.map((r) => r.description).sort()).toEqual(
      ["Gás 100% natural", "taxa_extra <script>alert(1)</script>"].sort(),
    );
    expect(rows.every((r) => r.createdBy === "Lançadora")).toBe(true);
  });

  it("includeDeleted: false exclui a lixeira; true inclui, com deletedAt", async () => {
    const filters = { from: `${EXPORT_MONTH}-01`, to: `${EXPORT_MONTH}-31` };
    const without = await exportRows(a.tenantId, OWNER, filters);
    expect(without.map((r) => r.description)).not.toContain("Excluído do mês");
    expect(without.every((r) => r.deletedAt === null)).toBe(true);

    const withDeleted = await exportRows(a.tenantId, OWNER, filters, { includeDeleted: true });
    const trashed = withDeleted.find((r) => r.description === "Excluído do mês");
    expect(trashed?.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(withDeleted.find((r) => r.description === "Picanha")?.deletedAt).toBeNull();
    // A lixeira do mês tem dois excluídos: o comum e a folha (o dono vê os dois).
    expect(withDeleted).toHaveLength(without.length + 2);
  });

  it("folha na lixeira com includeDeleted: só dono e contador a recebem, com deletedAt", async () => {
    const filters = { from: `${EXPORT_MONTH}-01`, to: `${EXPORT_MONTH}-31` };
    const withTrash = { includeDeleted: true };
    const owner = await exportRows(a.tenantId, OWNER, filters, withTrash);
    const payroll = owner.find((r) => r.id === ids.deletedPayroll);
    expect(payroll?.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (const scope of [managerNoPayroll, staff]) {
      const rows = await exportRows(a.tenantId, scope, filters, withTrash);
      expect(rows.map((r) => r.id)).not.toContain(ids.deletedPayroll);
      expect(rows.map((r) => r.description)).not.toContain("Folha excluída");
      // A contagem também não os inclui (o limite vale depois do filtro).
      const limited = await exportRows(a.tenantId, scope, filters, { ...withTrash, limit: 1000 });
      expect(limited).toHaveLength(rows.length);
    }
  });

  it("a ordem é competência, criação e id", async () => {
    const rows = await exportRows(a.tenantId, OWNER, {
      from: `${PAGING}-01`,
      to: `${PAGING}-31`,
    });
    const expected = await db.admin.query<{ id: string }>(
      `select id from entries where tenant_id = $1 and occurred_on between $2 and $3
        and deleted_at is null order by occurred_on, created_at, id`,
      [a.tenantId, `${PAGING}-01`, `${PAGING}-31`],
    );
    expect(rows.map((r) => r.id)).toEqual(expected.rows.map((r) => r.id));
  });

  it("subcategoria, pai, grupo do DRE, natureza e documento do fornecedor vêm preenchidos", async () => {
    const rows = await exportRows(a.tenantId, OWNER, {
      from: `${EXPORT_MONTH}-01`,
      to: `${EXPORT_MONTH}-31`,
    });
    const child = rows.find((r) => r.id === ids.child);
    expect(child).toMatchObject({
      category: "Carnes",
      categoryParentName: "Insumos",
      dreGroup: "cmv",
      nature: "variable",
      supplier: "Frigorífico Sul",
      supplierDocument: "12345678000195",
      amountCents: 10000,
      unit: expect.any(String),
    });
    const parentOnly = rows.find((r) => r.id === ids.parentOnly);
    expect(parentOnly).toMatchObject({ category: "Insumos", categoryParentName: null });
  });

  it("dados de outra empresa não vazam (o RLS isola os lançamentos e as junções)", async () => {
    const filters = { from: `${EXPORT_MONTH}-01`, to: `${EXPORT_MONTH}-31` };
    const ownerA = await exportRows(a.tenantId, OWNER, filters);
    expect(ownerA.map((r) => r.id)).not.toContain(tenantBExportEntry);
    expect(JSON.stringify(ownerA)).not.toContain("empresa B");
    const ownerB = await exportRows(b.tenantId, OWNER, filters);
    expect(ownerB.map((r) => r.id)).toEqual([tenantBExportEntry]);
    expect(ownerB[0]?.category).toBe("Exclusiva da empresa B");
    expect(JSON.stringify(ownerB)).not.toContain("Frigorífico");
    expect(JSON.stringify(ownerB)).not.toContain("Insumos");
  });

  it("as versões vêm com o entryId, por lançamento e versão", async () => {
    const result = await withTenant(appDb, a.tenantId, (tx) =>
      entryReader.exportVersions(tx, [ids.versioned, ids.child]),
    );
    expect(result.map((v) => [v.entryId, v.version])).toEqual(
      [
        [ids.child, 1],
        [ids.versioned, 1],
        [ids.versioned, 2],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0])) || Number(x[1]) - Number(y[1])),
    );
    const v2 = result.find((v) => v.version === 2);
    expect(v2).toMatchObject({ action: "update", channel: "web", after: { amountCents: 350 } });
    expect(await withTenant(appDb, a.tenantId, (tx) => entryReader.exportVersions(tx, []))).toEqual(
      [],
    );
  });

  it("os nomes do histórico são os mesmos de names()", async () => {
    const [viaExport, viaNames] = await withTenant(appDb, a.tenantId, async (tx) => [
      await entryReader.exportVersionNames(tx),
      await entryReader.names(tx),
    ]);
    expect(viaExport).toEqual(viaNames);
    expect(viaExport.categories.get(childCategoryId)?.name).toBe("Carnes");
  });
});
