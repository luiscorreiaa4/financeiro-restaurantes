import { type EntryDetail, entryDetailSchema } from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

interface Who {
  userId: string;
  email: string;
  session: string;
  ctx: string;
}

let tenantA: string;
let unit1: string;
let unit2: string;
let unitManaus: string;
let unitInactive: string;
let unitB: string;
let categoryA: string;
let payrollA: string;
let categoryB: string;
let supplierA: string;
let owner: Who;
let manager: Who;
let managerNoPayroll: Who;
let staff: Who;
let accountant: Who;
let ownerB: Who;

const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);

async function addTenant(name: string, units: Array<[string, string?, string?]>) {
  const tenantId = uuidv7();
  await admin("insert into tenants (id, name, status) values ($1, $2, 'active')", [tenantId, name]);
  const ids: string[] = [];
  for (const [unitName, timezone, status] of units) {
    const id = uuidv7();
    await admin(
      "insert into units (id, tenant_id, name, timezone, status) values ($1, $2, $3, $4, $5)",
      [id, tenantId, unitName, timezone ?? "America/Sao_Paulo", status ?? "active"],
    );
    ids.push(id);
  }
  return { tenantId, ids };
}

async function addCategory(tenantId: string, name: string, isSensitive = false) {
  const id = uuidv7();
  await admin(
    `insert into categories (id, tenant_id, name, kind, dre_group, is_sensitive)
     values ($1, $2, $3, 'expense', 'outras', $4)`,
    [id, tenantId, name, isSensitive],
  );
  return id;
}

async function addMember(
  tenantId: string,
  role: string,
  options: { unitIds?: string[]; permissions?: string[] } = {},
): Promise<Who> {
  const user = await h.createUser({ password: PASSWORD });
  await admin("update memberships set status = 'deactivated' where user_id = $1", [user.userId]);
  const id = uuidv7();
  await admin(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, permissions)
     values ($1, $2, $3, $4, $5, true, $6::jsonb)`,
    [
      id,
      tenantId,
      user.userId,
      role,
      options.unitIds === undefined,
      JSON.stringify(options.permissions ?? []),
    ],
  );
  for (const unitId of options.unitIds ?? []) {
    await admin(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantId, id, unitId],
    );
  }
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email: user.email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return {
    userId: user.userId,
    email: user.email,
    session: h.sessionCookie(response),
    ctx: `${tenantId}.${options.unitIds?.[0] ?? "all"}`,
  };
}

/** Sessão nova (o relógio andou e a antiga pode ter vencido). */
async function relogin(who: Who): Promise<Who> {
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email: who.email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return { ...who, session: h.sessionCookie(response) };
}

function post(who: Who, body: unknown, extra: { origin?: string | null } = {}) {
  const origin = extra.origin === undefined ? h.origin : extra.origin;
  return h.app.inject({
    method: "POST",
    url: "/api/entries",
    remoteAddress: nextIp(),
    headers: {
      ...(origin !== null ? { origin } : {}),
      "user-agent": "vitest",
      cookie: `${who.session}; ${CTX}=${who.ctx}`,
      "x-context": who.ctx,
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
}

function get(who: Who, url: string) {
  return h.app.inject({
    method: "GET",
    url,
    remoteAddress: nextIp(),
    headers: {
      origin: h.origin,
      "user-agent": "vitest",
      cookie: `${who.session}; ${CTX}=${who.ctx}`,
      "x-context": who.ctx,
    },
  });
}

/** Corpo mínimo válido: despesa de Insumos na unidade 1, chave nova a cada chamada. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: uuidv7(),
    type: "expense",
    occurredOn: "2026-11-05",
    description: `Compra ${uuidv7()}`,
    amountCents: 45_000,
    categoryId: categoryA,
    unitId: unit1,
    ...overrides,
  };
}

async function created(who: Who, overrides: Record<string, unknown> = {}): Promise<EntryDetail> {
  const response = await post(who, body(overrides));
  expect(response.statusCode, response.body).toBe(201);
  return entryDetailSchema.parse(response.json());
}

async function countEntries(where: string, params: unknown[]): Promise<number> {
  const result = await admin(`select count(*)::int as n from entries where ${where}`, params);
  return result.rows[0].n;
}

beforeAll(async () => {
  h = await startAuthHarness();
  const a = await addTenant("Empresa A", [
    ["Unidade 1"],
    ["Unidade 2"],
    ["Unidade 3"],
    ["Unidade Manaus", "America/Manaus"],
    ["Unidade inativa", undefined, "inactive"],
  ]);
  tenantA = a.tenantId;
  [unit1, unit2, , unitManaus, unitInactive] = a.ids as [string, string, string, string, string];
  categoryA = await addCategory(tenantA, "Insumos");
  payrollA = await addCategory(tenantA, "Folha de pagamento", true);
  supplierA = uuidv7();
  await admin("insert into suppliers (id, tenant_id, name) values ($1, $2, 'Atacadão')", [
    supplierA,
    tenantA,
  ]);
  const b = await addTenant("Empresa B", [["Unidade da B"]]);
  unitB = b.ids[0] as string;
  categoryB = await addCategory(b.tenantId, "Categoria da B");

  owner = await addMember(tenantA, "owner");
  manager = await addMember(tenantA, "manager", {
    unitIds: [unit1, unit2, unitManaus],
    permissions: ["VER_FOLHA"],
  });
  managerNoPayroll = await addMember(tenantA, "manager", { unitIds: [unit1, unit2] });
  staff = await addMember(tenantA, "staff", { unitIds: [unit1] });
  accountant = await addMember(tenantA, "accountant");
  ownerB = await addMember(b.tenantId, "owner");
});

afterAll(async () => {
  await h?.stop();
});

describe("POST /api/entries: criação (RF26)", () => {
  it("cria com 201, versão 1 no canal web e origem sem mensagem", async () => {
    const detail = await created(owner, { description: "Gás da cozinha", amountCents: 45_000 });
    expect(detail).toMatchObject({
      amountCents: 45_000,
      netCents: 45_000,
      description: "Gás da cozinha",
      originChannel: "web",
      unit: { id: unit1 },
    });
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]).toMatchObject({ version: 1, action: "create", channel: "web" });
    const row = await admin(
      "select inbound_message_id, created_by, client_request_id, position from entries where id = $1",
      [detail.id],
    );
    expect(row.rows[0]).toMatchObject({
      inbound_message_id: null,
      created_by: owner.userId,
      position: 0,
    });
    const source = await get(owner, `/api/entries/${detail.id}/source`);
    expect(source.statusCode).toBe(200);
    expect(source.json()).toMatchObject({ kind: "none", channel: "web" });
  });

  it("o filtro originChannel=web da lista acha o lançamento criado", async () => {
    const detail = await created(owner);
    const list = await get(owner, "/api/entries?from=2026-11-01&to=2026-11-30&originChannel=web");
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(detail.id);
  });

  it("duplo envio com a mesma chave grava um só e devolve 200 com o mesmo id", async () => {
    const payload = body();
    const first = await post(owner, payload);
    const second = await post(owner, payload);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(await countEntries("client_request_id = $1", [payload.clientRequestId])).toBe(1);
  });

  it("R3: mesma chave com corpo diferente devolve o primeiro e não grava o segundo", async () => {
    const payload = body({ amountCents: 1_000 });
    const first = await post(owner, payload);
    const second = await post(owner, { ...payload, amountCents: 2_000, description: "Outra" });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().amountCents).toBe(1_000);
    expect(await countEntries("client_request_id = $1", [payload.clientRequestId])).toBe(1);
  });

  it("R5: duas requisições simultâneas com a mesma chave e fornecedor novo gravam um lançamento e um fornecedor (concorrência, sem garantir o ramo do 23505)", async () => {
    const supplierName = `Fornecedor corrida ${uuidv7()}`;
    const payload = body({ supplier: { name: supplierName } });
    const [r1, r2] = await Promise.all([post(owner, payload), post(owner, payload)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
    expect(r1.json().id).toBe(r2.json().id);
    expect(await countEntries("client_request_id = $1", [payload.clientRequestId])).toBe(1);
    const suppliers = await admin("select count(*)::int as n from suppliers where name = $1", [
      supplierName,
    ]);
    expect(suppliers.rows[0].n).toBe(1);
  });

  it("R5: o 23505 da chave, com a linha da corrida ainda sem commit, desfaz o fornecedor novo e responde 200 com o lançamento vencedor", async () => {
    const key = uuidv7();
    const winnerId = uuidv7();
    const supplierName = `Fornecedor 23505 ${uuidv7()}`;
    const client = await h.db.admin.connect();
    let response: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await client.query("begin");
      // A "outra requisição" já gravou, mas ainda não commitou: o replay do POST não a vê e o
      // INSERT dele bloqueia no índice único até o commit.
      await client.query(
        `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
           amount_cents, net_cents, category_id, created_by, client_request_id, position)
         values ($1, $2, $3, 'expense', '2026-11-05', '2026-11-05', 'Vencedora', 100, 100,
           $4, $5, $6, 0)`,
        [winnerId, tenantA, unit1, categoryA, owner.userId, key],
      );
      await client.query(
        `insert into entry_versions (id, tenant_id, entry_id, version, action, before, after,
           changed_by, channel)
         values ($1, $2, $3, 1, 'create', null, '{}'::jsonb, $4, 'web')`,
        [uuidv7(), tenantA, winnerId, owner.userId],
      );
      response = post(owner, body({ clientRequestId: key, supplier: { name: supplierName } }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const result = await response;
    expect(result?.statusCode, result?.body).toBe(200);
    expect(result?.json().id).toBe(winnerId);
    expect(await countEntries("client_request_id = $1", [key])).toBe(1);
    const suppliers = await admin("select count(*)::int as n from suppliers where name = $1", [
      supplierName,
    ]);
    expect(suppliers.rows[0].n).toBe(0);
  });

  it("R8: a mesma chave de outro usuário e de outra empresa não colide nem revela nada", async () => {
    const key = uuidv7();
    const mine = await post(owner, body({ clientRequestId: key }));
    expect(mine.statusCode).toBe(201);
    const colleague = await post(manager, body({ clientRequestId: key }));
    expect(colleague.statusCode).toBe(201);
    expect(colleague.json().id).not.toBe(mine.json().id);
    const other = await post(
      ownerB,
      body({ clientRequestId: key, categoryId: categoryB, unitId: unitB }),
    );
    expect(other.statusCode).toBe(201);
    expect(other.json().id).not.toBe(mine.json().id);
  });

  it("R8: outra empresa não vê o lançamento criado", async () => {
    const detail = await created(owner);
    const response = await get(ownerB, `/api/entries/${detail.id}`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_found" });
  });

  it("repetição de lançamento que o ator não enxerga mais (reclassificado para sensível) responde 409 sem dado", async () => {
    const payload = body({ description: "Hoje invisível" });
    const first = await post(managerNoPayroll, payload);
    expect(first.statusCode).toBe(201);
    await admin("update entries set category_id = $1 where id = $2", [payrollA, first.json().id]);
    const again = await post(managerNoPayroll, payload);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "already_submitted" });
  });

  it("repetição de lançamento cuja unidade saiu do acesso responde 409 sem dado", async () => {
    const payload = body({ description: "Unidade retirada" });
    const first = await post(staff, payload);
    expect(first.statusCode).toBe(201);
    await admin("update entries set unit_id = $1 where id = $2", [unit2, first.json().id]);
    const again = await post(staff, payload);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "already_submitted" });
  });
});

describe("POST /api/entries: permissões e sensível", () => {
  it("gerente sem VER_FOLHA e lançador com categoria sensível recebem 422 indistinguível e nada é gravado", async () => {
    for (const who of [managerNoPayroll, staff]) {
      const description = `Folha ${uuidv7()}`;
      const sensitive = await post(who, body({ categoryId: payrollA, description }));
      const missing = await post(who, body({ categoryId: uuidv7(), description }));
      expect(sensitive.statusCode).toBe(422);
      expect(sensitive.json()).toEqual({
        code: "invalid_entry",
        reason: "UnknownReference",
        field: "categoryId",
      });
      expect(missing.json()).toEqual(sensitive.json());
      expect(await countEntries("description = $1", [description])).toBe(0);
    }
  });

  it("gerente com VER_FOLHA e dono lançam na categoria sensível", async () => {
    expect((await post(manager, body({ categoryId: payrollA }))).statusCode).toBe(201);
    expect((await post(owner, body({ categoryId: payrollA }))).statusCode).toBe(201);
  });

  it("lançador em unidade fora do acesso recebe 403 e nada é gravado", async () => {
    const payload = body({ unitId: unit2 });
    const response = await post(staff, payload);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
    expect(await countEntries("client_request_id = $1", [payload.clientRequestId])).toBe(0);
  });

  it("contador recebe 403", async () => {
    expect((await post(accountant, body())).statusCode).toBe(403);
  });

  it("categoria de outra empresa responde 422 UnknownReference", async () => {
    const response = await post(owner, body({ categoryId: categoryB }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "invalid_entry",
      reason: "UnknownReference",
      field: "categoryId",
    });
  });

  it("unidade de outra empresa ou inexistente responde 422 no campo unitId", async () => {
    const response = await post(owner, body({ unitId: uuidv7() }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ reason: "UnknownReference", field: "unitId" });
  });

  it("unidade inativa responde 422 UnitInactive", async () => {
    const response = await post(owner, body({ unitId: unitInactive }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "invalid_entry",
      reason: "UnitInactive",
      field: "unitId",
    });
  });

  it("sem Origin responde 403 origin_forbidden e nada é gravado", async () => {
    const payload = body();
    const response = await post(owner, payload, { origin: null });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "origin_forbidden" });
    expect(await countEntries("client_request_id = $1", [payload.clientRequestId])).toBe(0);
  });

  it("corpo inválido responde 400 invalid_request", async () => {
    const response = await post(owner, { ...body(), extra: 1 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "invalid_request" });
  });
});

describe("POST /api/entries: entradas de risco (Review Focus)", () => {
  it("R1: descrição só com CPF responde 422 no campo description e nada é gravado", async () => {
    const payload = body({ description: "123.456.789-09" });
    const response = await post(owner, payload);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "invalid_entry",
      reason: "DescriptionEmpty",
      field: "description",
    });
    expect(await countEntries("client_request_id = $1", [payload.clientRequestId])).toBe(0);
  });

  it("descrição com CPF e texto grava sem o CPF", async () => {
    const detail = await created(owner, { description: "Pagamento 123.456.789-09 da Ana" });
    expect(detail.description).not.toContain("123.456.789-09");
    expect(detail.description).toContain("Ana");
  });

  it("R2: 1900-01-01 grava com old_date", async () => {
    const detail = await created(owner, { occurredOn: "1900-01-01" });
    expect(detail.flags).toContain("old_date");
  });

  it("R2: 2026-02-30 responde erro de cliente, nunca 500", async () => {
    const response = await post(owner, body({ occurredOn: "2026-02-30" }));
    expect([400, 422]).toContain(response.statusCode);
  });

  it("R2: valor 9007199254740991 nunca derruba a rota com 500", async () => {
    // Decisão do orquestrador: o teto de dinheiro do sistema inteiro é Number.MAX_SAFE_INTEGER
    // (parse-brl, createEntry), então este valor é aceito (201). Aqui só se prova que não há 500.
    const response = await post(owner, body({ amountCents: 9_007_199_254_740_991 }));
    expect(response.statusCode).toBeLessThan(500);
  });

  it("quantidade com 4 casas decimais responde 422 no campo quantity", async () => {
    const response = await post(owner, body({ quantity: 1.2345, quantityUnit: "KG" }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "invalid_entry", field: "quantity" });
  });

  it("R4: fornecedor novo com nome de um existente, em outra caixa e com espaços, associa o existente", async () => {
    const before = await admin("select count(*)::int as n from suppliers where tenant_id = $1", [
      tenantA,
    ]);
    const detail = await created(owner, { supplier: { name: "  ATACADAO " } });
    expect(detail.supplier).toMatchObject({ id: supplierA });
    const after = await admin("select count(*)::int as n from suppliers where tenant_id = $1", [
      tenantA,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("fornecedor novo digitado cria o cadastro junto do lançamento", async () => {
    const name = `Padaria ${uuidv7()}`;
    const detail = await created(owner, { supplier: { name } });
    expect(detail.supplier?.name).toBe(name);
  });
});

describe("POST /api/entries: duplicidade e datas", () => {
  it("o segundo lançamento igual em 24 h grava com possible_duplicate", async () => {
    const description = `Repetido ${uuidv7()}`;
    const first = await created(owner, { description });
    expect(first.flags).not.toContain("possible_duplicate");
    const second = await created(owner, { description });
    expect(second.flags).toContain("possible_duplicate");
  });

  it("não marca duplicidade quando o igual é de categoria sensível que o ator não vê", async () => {
    const description = `Salário oculto ${uuidv7()}`;
    await created(owner, { description, categoryId: payrollA });
    const mine = await created(managerNoPayroll, { description });
    expect(mine.flags).not.toContain("possible_duplicate");
  });

  it("competência hoje+60 é aceita e +61 responde 422, no fuso da unidade escolhida", async () => {
    // 03:30 UTC de 10/11: em São Paulo já é 10/11 (00:30) e em Manaus ainda é 09/11 (23:30).
    h.clock.advance(Date.parse("2026-11-10T03:30:00Z") - Date.now());
    try {
      const ownerNow = await relogin(owner);
      const managerNow = await relogin(manager);
      const sp = await post(ownerNow, body({ occurredOn: "2027-01-09", unitId: unit1 }));
      expect(sp.statusCode).toBe(201);
      const manausTooFar = await post(
        managerNow,
        body({ occurredOn: "2027-01-09", unitId: unitManaus }),
      );
      expect(manausTooFar.statusCode).toBe(422);
      expect(manausTooFar.json()).toEqual({
        code: "invalid_entry",
        reason: "DateTooFarAhead",
        field: "occurredOn",
      });
      const manausLimit = await post(
        managerNow,
        body({ occurredOn: "2027-01-08", unitId: unitManaus }),
      );
      expect(manausLimit.statusCode).toBe(201);
    } finally {
      h.clock.reset();
    }
  });
});
