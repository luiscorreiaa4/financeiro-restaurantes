import { unitSettingsSchema } from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";
import { PERSONAS, type Persona, SETTINGS_ROUTE_MATRIX } from "./support/route-matrix";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

interface Who {
  userId: string;
  session: string;
  /** Valor do `fr_ctx` e do `X-Context`; a sessão restrita não tem. */
  ctx?: string;
}

let who: Record<Persona, Who>;
let soloOwner: Who;
let ownerB: Who;
/** Gerente da A e dono da B (contexto troca de empresa). */
let managerA_ownerB: { who: Who; ctxA: string; ctxB: string };
let tenantA: string;
let tenantB: string;
let tenantSolo: string;
let unit1: string;
let unit2: string;
let unitB: string;
let channelA: string;
let channelB: string;

const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);

async function addTenant(name: string, unitNames: string[], status = "active") {
  const tenantId = uuidv7();
  await admin("insert into tenants (id, name, status) values ($1, $2, $3)", [
    tenantId,
    name,
    status,
  ]);
  const unitIds: string[] = [];
  for (const unitName of unitNames) {
    const id = uuidv7();
    await admin(
      "insert into units (id, tenant_id, name, city, uf) values ($1, $2, $3, 'Maceió', 'AL')",
      [id, tenantId, unitName],
    );
    unitIds.push(id);
  }
  return { tenantId, unitIds };
}

async function addChannel(tenantId: string, name: string, status = "active") {
  const id = uuidv7();
  await admin(
    "insert into sales_channels (id, tenant_id, name, type, status) values ($1, $2, $3, 'other', $4)",
    [id, tenantId, name, status],
  );
  return id;
}

async function addUser(): Promise<{ userId: string; email: string }> {
  const user = await h.createUser({ password: PASSWORD });
  await admin("update memberships set status = 'deactivated' where user_id = $1", [user.userId]);
  return user;
}

async function addMembership(
  userId: string,
  tenantId: string,
  options: { role: string; unitIds?: string[]; permissions?: string[] },
): Promise<void> {
  const id = uuidv7();
  await admin(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, permissions)
     values ($1, $2, $3, $4, $5, true, $6::jsonb)`,
    [
      id,
      tenantId,
      userId,
      options.role,
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
}

async function login(email: string): Promise<string> {
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return h.sessionCookie(response);
}

async function member(
  tenantId: string,
  options: { role: string; unitIds?: string[]; permissions?: string[] },
  ctx: string,
): Promise<Who> {
  const user = await addUser();
  await addMembership(user.userId, tenantId, options);
  return { userId: user.userId, session: await login(user.email), ctx };
}

function call(
  user: Who,
  method: "GET" | "POST" | "PATCH",
  url: string,
  extra: { ctx?: string; xContext?: string | null; body?: unknown } = {},
) {
  const ctx = extra.ctx ?? user.ctx;
  const xContext = extra.xContext === undefined ? ctx : extra.xContext;
  const cookie = [user.session, ctx !== undefined ? `${CTX}=${ctx}` : ""]
    .filter(Boolean)
    .join("; ");
  return h.app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      origin: h.origin,
      "user-agent": "vitest",
      cookie,
      ...(xContext != null ? { "x-context": xContext } : {}),
      ...(extra.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(extra.body !== undefined ? { payload: JSON.stringify(extra.body) } : {}),
  });
}

const unitBody = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  aliases: [],
  cnpj: null,
  uf: "AL",
  city: "Maceió",
  timezone: "America/Sao_Paulo",
  status: "active",
  defaultSalesChannelId: null,
  ...overrides,
});

const createUnit = (user: Who, name: string, overrides: Record<string, unknown> = {}) =>
  call(user, "POST", "/api/settings/units", { body: unitBody(name, overrides) });

const listOf = async (user: Who) => {
  const response = await call(user, "GET", "/api/settings/units");
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { items: Array<{ id: string; name: string }> }).items;
};

beforeAll(async () => {
  h = await startAuthHarness();
  const a = await addTenant("Empresa A", ["Unidade 1", "Unidade 2"]);
  tenantA = a.tenantId;
  [unit1, unit2] = a.unitIds as [string, string];
  const b = await addTenant("Empresa B", ["Unidade da B"]);
  tenantB = b.tenantId;
  unitB = b.unitIds[0] as string;
  const c = await addTenant("Empresa C", ["Matriz"], "read_only");
  const solo = await addTenant("Empresa Solo", ["Única"]);
  tenantSolo = solo.tenantId;
  channelA = await addChannel(tenantA, "iFood");
  channelB = await addChannel(tenantB, "Rappi");

  const all = `${tenantA}.all`;
  const at1 = `${tenantA}.${unit1}`;
  const restrictedUser = await h.createUser({ membership: "deactivated", password: PASSWORD });
  const staffNoPanelUser = await addUser();
  await addMembership(staffNoPanelUser.userId, tenantA, { role: "staff", unitIds: [unit1] });
  const staffNoPanelWho = {
    userId: staffNoPanelUser.userId,
    session: await login(staffNoPanelUser.email),
    ctx: at1,
  };
  await admin("update memberships set panel_access = false where user_id = $1", [
    staffNoPanelUser.userId,
  ]);

  who = {
    owner: await member(tenantA, { role: "owner" }, all),
    manager: await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2], permissions: ["VER_FOLHA"] },
      at1,
    ),
    managerNoPayroll: await member(tenantA, { role: "manager", unitIds: [unit1, unit2] }, at1),
    staff: await member(tenantA, { role: "staff", unitIds: [unit1] }, at1),
    accountant: await member(tenantA, { role: "accountant" }, all),
    restricted: { userId: restrictedUser.userId, session: await login(restrictedUser.email) },
    readOnly: await member(c.tenantId, { role: "owner" }, `${c.tenantId}.all`),
    staffNoPanel: staffNoPanelWho,
  };
  soloOwner = await member(tenantSolo, { role: "owner" }, `${tenantSolo}.all`);
  ownerB = await member(tenantB, { role: "owner" }, `${tenantB}.all`);

  const crossUser = await addUser();
  await addMembership(crossUser.userId, tenantA, { role: "manager", unitIds: [unit1] });
  await addMembership(crossUser.userId, tenantB, { role: "owner" });
  managerA_ownerB = {
    who: { userId: crossUser.userId, session: await login(crossUser.email) },
    ctxA: at1,
    ctxB: `${tenantB}.all`,
  };
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("matriz papel × rota das unidades (RF04.CA05, RF06.CA06)", () => {
  for (const route of SETTINGS_ROUTE_MATRIX) {
    for (const persona of PERSONAS) {
      const status = route.expected[persona];
      it(`${route.name}: ${persona} recebe ${status}`, async () => {
        const response = await call(who[persona], route.method, route.url(), {
          body: route.body?.(),
        });
        expect(response.statusCode, response.body).toBe(status);
        if (status >= 400) {
          // Recusa não leva dado de unidade nenhum: só `code` (e `field`/`reason` da validação).
          expect(response.json()).toHaveProperty("code");
          expect(JSON.stringify(response.json())).not.toContain("Unidade 1");
        }
      });
    }
  }

  it("sem X-Context: 409 context_changed em todas as rotas", async () => {
    for (const route of SETTINGS_ROUTE_MATRIX) {
      const response = await call(who.owner, route.method, route.url(), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });

  it("cookie de contexto forjado para a empresa B: 403 context_invalid", async () => {
    const response = await call(who.owner, "GET", "/api/settings/units", {
      ctx: `${tenantB}.all`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "context_invalid" });
  });
});

describe("criar unidade (RF04.CA01)", () => {
  it("cria com apelidos e CNPJ, responde pelo contrato e aparece na lista", async () => {
    const response = await createUnit(who.owner, "Praia", {
      aliases: ["litoral", "loja 3"],
      cnpj: "11.222.333/0001-81",
      defaultSalesChannelId: channelA,
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = unitSettingsSchema.parse(response.json());
    expect(created).toMatchObject({
      name: "Praia",
      aliases: ["litoral", "loja 3"],
      cnpj: "11222333000181",
      defaultSalesChannelId: channelA,
      onlyUnitMemberCount: 0,
    });
    expect((await listOf(who.owner)).map((u) => u.name)).toContain("Praia");
    // O contador e o gerente leem o mesmo cadastro.
    expect((await listOf(who.accountant)).map((u) => u.id)).toContain(created.id);
    expect((await listOf(who.manager)).map((u) => u.id)).toContain(created.id);
  });

  it("nome repetido e apelido igual a nome de outra unidade: 409 name_taken", async () => {
    expect((await createUnit(who.owner, "Duplicável")).statusCode).toBe(201);
    const sameName = await createUnit(who.owner, "duplicavel");
    expect(sameName.statusCode).toBe(409);
    expect(sameName.json()).toEqual({ code: "name_taken" });
    const aliasAsName = await createUnit(who.owner, "Outra qualquer", { aliases: ["Duplicável"] });
    expect(aliasAsName.statusCode).toBe(409);
    expect(aliasAsName.json()).toEqual({ code: "name_taken" });
  });

  it("dado inválido: 422 validation com field e reason em snake_case", async () => {
    const city = await createUnit(who.owner, "Cidade ruim", { city: "Cidade Inexistente" });
    expect(city.statusCode).toBe(422);
    expect(city.json()).toEqual({ code: "validation", field: "city", reason: "invalid" });
    const cnpj = await createUnit(who.owner, "Cnpj ruim", { cnpj: "11.222.333/0001-82" });
    expect(cnpj.json()).toEqual({ code: "validation", field: "cnpj", reason: "invalid" });
    const zone = await createUnit(who.owner, "Fuso ruim", { timezone: "Marte/Olympus" });
    expect(zone.json()).toEqual({ code: "validation", field: "timezone", reason: "invalid" });
  });

  it("cinco apelidos (o limite) são aceitos; seis ficam fora do contrato (400)", async () => {
    const five = await createUnit(who.owner, "Cinco apelidos", {
      aliases: ["a1", "a2", "a3", "a4", "a5"],
    });
    expect(five.statusCode).toBe(201);
    const six = await createUnit(who.owner, "Seis apelidos", {
      aliases: ["a1", "a2", "a3", "a4", "a5", "a6"],
    });
    expect(six.statusCode).toBe(400);
    expect(six.json()).toEqual({ code: "invalid_request" });
  });

  it("corpo fora do contrato: 400 invalid_request (campo a mais, UF fora da lista)", async () => {
    const extra = await call(who.owner, "POST", "/api/settings/units", {
      body: { ...unitBody("Extra"), tenantId: tenantB },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual({ code: "invalid_request" });
    expect((await createUnit(who.owner, "UF ruim", { uf: "ZZ" })).statusCode).toBe(400);
  });

  it("canal padrão de outra empresa: 422 unknown_reference e nada é gravado", async () => {
    const response = await createUnit(who.owner, "Canal alheio", {
      defaultSalesChannelId: channelB,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "unknown_reference" });
    expect((await listOf(who.owner)).map((u) => u.name)).not.toContain("Canal alheio");
  });
});

describe("editar unidade", () => {
  it("PATCH parcial muda só o que veio e responde pelo contrato", async () => {
    const created = unitSettingsSchema.parse((await createUnit(who.owner, "Para editar")).json());
    const response = await call(who.owner, "PATCH", `/api/settings/units/${created.id}`, {
      body: { aliases: ["edit"], timezone: "America/Manaus" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(unitSettingsSchema.parse(response.json())).toMatchObject({
      name: "Para editar",
      aliases: ["edit"],
      timezone: "America/Manaus",
    });
  });

  it("trocar o fuso não muda a data dos lançamentos existentes", async () => {
    const t = unitSettingsSchema.parse((await createUnit(who.owner, "Com lançamento")).json());
    const entryId = uuidv7();
    await admin(
      `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents, net_cents, created_by)
       values ($1, $2, $3, 'expense', '2026-11-05', '2026-11-05', 'fuso', 1000, 1000, $4)`,
      [entryId, tenantA, t.id, who.owner.userId],
    );
    const before = await admin("select occurred_on::text as d from entries where id = $1", [
      entryId,
    ]);
    const response = await call(who.owner, "PATCH", `/api/settings/units/${t.id}`, {
      body: { timezone: "America/Noronha" },
    });
    expect(response.statusCode).toBe(200);
    const after = await admin("select occurred_on::text as d from entries where id = $1", [
      entryId,
    ]);
    expect(after.rows).toEqual(before.rows);
  });

  it("PATCH em unidade de outra empresa: 404 not_found, sem revelar nada, e nada muda", async () => {
    const response = await call(who.owner, "PATCH", `/api/settings/units/${unitB}`, {
      body: { name: "Invadida" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_found" });
    const row = await admin("select name from units where id = $1", [unitB]);
    expect(row.rows[0].name).toBe("Unidade da B");
    const off = await call(who.owner, "POST", `/api/settings/units/${unitB}/deactivate`);
    expect(off.statusCode).toBe(404);
    const noUuid = await call(who.owner, "PATCH", "/api/settings/units/nao-e-uuid", {
      body: { name: "Xx" },
    });
    expect(noUuid.statusCode).toBe(404);
  });

  it("a lista de uma empresa não traz a unidade da outra", async () => {
    expect((await listOf(who.owner)).map((u) => u.id)).not.toContain(unitB);
    expect((await listOf(ownerB)).map((u) => u.id)).not.toContain(unit1);
  });
});

describe("unidade antiga sem cidade e UF (anterior à E11)", () => {
  it("a lista responde 200 com null nesses campos, em vez de 500", async () => {
    const tenant = await addTenant("Empresa Legada", []);
    const legacyId = uuidv7();
    await admin("insert into units (id, tenant_id, name) values ($1, $2, 'Antiga')", [
      legacyId,
      tenant.tenantId,
    ]);
    const owner = await member(tenant.tenantId, { role: "owner" }, `${tenant.tenantId}.all`);
    const response = await call(owner, "GET", "/api/settings/units");
    expect(response.statusCode, response.body).toBe(200);
    const [legacy] = (response.json() as { items: Array<Record<string, unknown>> }).items;
    expect(legacy).toMatchObject({ id: legacyId, name: "Antiga", city: null, uf: null });
  });
});

describe("inativar e reativar (RF04.R5, CA02)", () => {
  it("PATCH com status inactive na última ativa também é recusado: 409 last_active_unit", async () => {
    const tenant = await addTenant("Empresa Patch", ["Só uma"]);
    const owner = await member(tenant.tenantId, { role: "owner" }, `${tenant.tenantId}.all`);
    const response = await call(owner, "PATCH", `/api/settings/units/${tenant.unitIds[0]}`, {
      body: { status: "inactive" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "last_active_unit" });
    const row = await admin("select status from units where id = $1", [tenant.unitIds[0]]);
    expect(row.rows[0].status).toBe("active");
  });

  it("PATCH vazio ou com o status que a unidade já tem responde 200 sem alterar nada", async () => {
    const created = unitSettingsSchema.parse((await createUnit(who.owner, "Sem mudança")).json());
    const url = `/api/settings/units/${created.id}`;
    const empty = await call(who.owner, "PATCH", url, { body: {} });
    expect(empty.statusCode, empty.body).toBe(200);
    expect(unitSettingsSchema.parse(empty.json())).toEqual(created);
    const same = await call(who.owner, "PATCH", url, { body: { status: "active" } });
    expect(same.statusCode, same.body).toBe(200);
    expect(unitSettingsSchema.parse(same.json())).toEqual(created);
    const audits = await admin(
      "select 1 from audit_log where target = $1 and action <> 'unit.create'",
      [created.id],
    );
    expect(audits.rows).toHaveLength(0);
  });

  it("reativar unidade de outra empresa: 404 not_found e nada muda", async () => {
    const response = await call(who.owner, "POST", `/api/settings/units/${unitB}/reactivate`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_found" });
  });

  it("a última unidade ativa não é inativada: 409 last_active_unit", async () => {
    const [only] = await listOf(soloOwner);
    const response = await call(soloOwner, "POST", `/api/settings/units/${only?.id}/deactivate`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "last_active_unit" });
    const row = await admin("select status from units where id = $1", [only?.id]);
    expect(row.rows[0].status).toBe("active");
  });

  it("inativa quando há outra ativa e reativa depois", async () => {
    const created = unitSettingsSchema.parse((await createUnit(soloOwner, "Segunda")).json());
    const off = await call(soloOwner, "POST", `/api/settings/units/${created.id}/deactivate`);
    expect(off.statusCode, off.body).toBe(200);
    expect(unitSettingsSchema.parse(off.json()).status).toBe("inactive");
    const on = await call(soloOwner, "POST", `/api/settings/units/${created.id}/reactivate`);
    expect(on.statusCode).toBe(200);
    expect(unitSettingsSchema.parse(on.json()).status).toBe("active");
  });

  it("duas inativações paralelas das duas últimas ativas: uma é recusada", async () => {
    const tenant = await addTenant("Empresa Paralela", ["P1", "P2"]);
    const owner = await member(tenant.tenantId, { role: "owner" }, `${tenant.tenantId}.all`);
    const responses = await Promise.all(
      tenant.unitIds.map((id) => call(owner, "POST", `/api/settings/units/${id}/deactivate`)),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const active = await admin("select 1 from units where tenant_id = $1 and status = 'active'", [
      tenant.tenantId,
    ]);
    expect(active.rows).toHaveLength(1);
  });
});

describe("contexto de outra empresa", () => {
  it("gerente da A que é dono da B grava só na empresa do contexto", async () => {
    const { who: user, ctxA, ctxB } = managerA_ownerB;
    const denied = await call(user, "POST", "/api/settings/units", {
      ctx: ctxA,
      body: unitBody("Do gerente"),
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await call(user, "POST", "/api/settings/units", {
      ctx: ctxB,
      body: unitBody("Do dono da B"),
    });
    expect(allowed.statusCode, allowed.body).toBe(201);
    const rows = await admin("select tenant_id from units where name = 'Do dono da B'");
    expect(rows.rows).toEqual([{ tenant_id: tenantB }]);
    const none = await admin("select 1 from units where name = 'Do gerente'");
    expect(none.rows).toHaveLength(0);
  });
});
