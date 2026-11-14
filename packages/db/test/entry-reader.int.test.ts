import type { EntryScope } from "@app/core";
import {
  type EntryListQuery,
  type EntrySort,
  entryDetailSchema,
  entryItemSchema,
  entryListQuerySchema,
  entryOptionsSchema,
  type SortDirection,
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

  it("o aviso de restritos só aparece quando há sensível dentro dos filtros, da unidade e do período", async () => {
    expect((await totals(a.tenantId, managerNoPayroll, queryFor(MAIN))).hasRestricted).toBe(true);
    // Só receitas: a folha é despesa.
    expect(
      (await totals(a.tenantId, managerNoPayroll, queryFor(MAIN, { type: "revenue" })))
        .hasRestricted,
    ).toBe(false);
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
    });
    expect(result.categories.map((category) => category.id)).toContain(a.categoryId);
    expect(result.suppliers).toEqual([
      { id: supplier2, name: "Atacadão Central" },
      { id: a.supplierId, name: "Fornecedor" },
    ]);
    expect(result.paymentMethods).toEqual([{ id: a.paymentMethodId, name: "Pix" }]);
    expect(result.salesChannels).toEqual([{ id: a.salesChannelId, name: "Salão" }]);
    expect(result.units).toEqual([
      { id: unit2, name: "Filial" },
      { id: a.unitId, name: "Matriz" },
    ]);
    expect(result.members.map((member) => member.name)).toEqual(["Dono", "Gerente", "Lançadora"]);
    expect(result.members).toContainEqual({ id: staffId, name: "Lançadora" });
  });

  it("quem não vê folha não recebe a categoria sensível", async () => {
    const result = await options(a.tenantId, managerNoPayroll);
    expect(result.categories.map((category) => category.id)).not.toContain(payrollCategoryId);
    expect(result.categories.map((category) => category.id)).toContain(a.categoryId);
    expect(JSON.stringify(result)).not.toContain("Folha");
    expect(result.members).toHaveLength(3);
  });

  it("as unidades são só as do recorte, e recorte sem unidade não recebe nenhuma", async () => {
    expect((await options(a.tenantId, managerNoPayroll)).units).toEqual([
      { id: a.unitId, name: "Matriz" },
    ]);
    expect((await options(a.tenantId, { ...OWNER, unitIds: [] })).units).toEqual([]);
    // Unidade da empresa B pedida dentro da empresa A: nada.
    expect((await options(a.tenantId, { ...OWNER, unitIds: [b.unitId] })).units).toEqual([]);
  });

  it("lançador não recebe a lista de membros nem a categoria sensível", async () => {
    const result = await options(a.tenantId, staff);
    expect(result.members).toEqual([]);
    expect(result.categories.map((category) => category.id)).not.toContain(payrollCategoryId);
    expect(result.units).toEqual([{ id: a.unitId, name: "Matriz" }]);
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
