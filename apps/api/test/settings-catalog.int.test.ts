import {
  feePreviewSchema,
  paymentMethodSettingsSchema,
  salesChannelSettingsSchema,
} from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";
import { CATALOG_ROUTE_MATRIX, PERSONAS, type Persona } from "./support/route-matrix";

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
/** Gerente da A e dono da B (contexto troca de empresa). */
let managerA_ownerB: { who: Who; ctxA: string; ctxB: string };
let tenantA: string;
let tenantB: string;
let tenantSolo: string;
let unit1: string;
let unit2: string;

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

beforeAll(async () => {
  h = await startAuthHarness();
  const a = await addTenant("Empresa A", ["Unidade 1", "Unidade 2"]);
  tenantA = a.tenantId;
  [unit1, unit2] = a.unitIds as [string, string];
  const b = await addTenant("Empresa B", ["Unidade da B"]);
  tenantB = b.tenantId;
  const c = await addTenant("Empresa C", ["Matriz"], "read_only");
  const solo = await addTenant("Empresa Solo", ["Única"]);
  tenantSolo = solo.tenantId;

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

const pmBody = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  type: "credit",
  feePercentBp: 320,
  feeFixedCents: 0,
  aliases: [],
  status: "active",
  isDefaultCard: false,
  ...overrides,
});
const chBody = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  type: "app",
  feePercentBp: 1200,
  aliases: [],
  status: "active",
  ...overrides,
});

const PM = "/api/settings/payment-methods";
const CH = "/api/settings/sales-channels";

const createPm = (user: Who, name: string, overrides: Record<string, unknown> = {}) =>
  call(user, "POST", PM, { body: pmBody(name, overrides) });
const createCh = (user: Who, name: string, overrides: Record<string, unknown> = {}) =>
  call(user, "POST", CH, { body: chBody(name, overrides) });

const listNames = async (user: Who, url: string) => {
  const response = await call(user, "GET", url);
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { items: Array<{ id: string; name: string }> }).items;
};

async function insertPm(tenantId: string, name: string, type = "other") {
  const id = uuidv7();
  await admin("insert into payment_methods (id, tenant_id, name, type) values ($1, $2, $3, $4)", [
    id,
    tenantId,
    name,
    type,
  ]);
  return id;
}

describe("matriz papel × rota de formas, canais e prévia (RF08, RF09, RF06.CA06)", () => {
  for (const route of CATALOG_ROUTE_MATRIX) {
    for (const persona of PERSONAS) {
      const status = route.expected[persona];
      it(`${route.name}: ${persona} recebe ${status}`, async () => {
        const response = await call(who[persona], route.method, route.url(), {
          body: route.body?.(),
        });
        expect(response.statusCode, response.body).toBe(status);
        if (status >= 400) {
          expect(response.json()).toHaveProperty("code");
        }
      });
    }
  }

  it("sem X-Context: 409 context_changed em todas as rotas", async () => {
    for (const route of CATALOG_ROUTE_MATRIX) {
      const response = await call(who.owner, route.method, route.url(), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });
});

describe("formas de pagamento", () => {
  it("cria, responde pelo contrato e todos que leem veem o cadastro", async () => {
    const response = await createPm(who.owner, "Vale Refeição", {
      type: "voucher",
      feePercentBp: 450,
      feeFixedCents: 30,
      aliases: ["vr"],
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = paymentMethodSettingsSchema.parse(response.json());
    expect(created).toMatchObject({ name: "Vale Refeição", feePercentBp: 450, protected: false });
    for (const persona of [who.accountant, who.manager]) {
      expect((await listNames(persona, PM)).map((p) => p.id)).toContain(created.id);
    }
  });

  it("filtra a lista por tipo e situação", async () => {
    await createPm(who.owner, "Inativa Filtro", { status: "inactive", type: "other" });
    const inactive = await call(who.owner, "GET", `${PM}?status=inactive`);
    expect(inactive.statusCode).toBe(200);
    const names = (inactive.json() as { items: Array<{ name: string }> }).items.map((i) => i.name);
    expect(names).toContain("Inativa Filtro");
    expect(names).not.toContain("Vale Refeição");
  });

  it("nome repetido: 409 name_taken", async () => {
    expect((await createPm(who.owner, "Repetida")).statusCode).toBe(201);
    const again = await createPm(who.owner, "repetida");
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "name_taken" });
  });

  it("validação do domínio: 422 com field e reason em snake_case", async () => {
    const cases: Array<[Record<string, unknown>, string, string, string]> = [
      [{ name: "   " }, "Nome em branco", "name", "invalid"],
      [{ type: "pix", isDefaultCard: true }, "Padrão pix", "is_default_card", "invalid_type"],
      [
        { status: "inactive", isDefaultCard: true },
        "Padrão inativa",
        "is_default_card",
        "inactive",
      ],
    ];
    for (const [overrides, name, field, reason] of cases) {
      const response = await createPm(who.owner, name, overrides);
      expect(response.statusCode, `${field}/${reason}: ${response.body}`).toBe(422);
      expect(response.json()).toEqual({ code: "validation", field, reason });
    }
  });

  it("PATCH isDefaultCard:false na forma padrão: 422 is_default_card/inactive e continua padrão", async () => {
    const created = await createPm(who.owner, "Padrão desmarcar", { isDefaultCard: true });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const response = await call(who.owner, "PATCH", `${PM}/${id}`, {
      body: { isDefaultCard: false },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toEqual({
      code: "validation",
      field: "is_default_card",
      reason: "inactive",
    });
    const rows = await call(who.owner, "GET", PM);
    const row = (
      rows.json() as { items: Array<{ id: string; isDefaultCard: boolean }> }
    ).items.find((i) => i.id === id);
    expect(row?.isDefaultCard).toBe(true);
  });

  it("cartão padrão em PIX é recusado e nada é gravado", async () => {
    const response = await createPm(who.owner, "Pix padrão", { type: "pix", isDefaultCard: true });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "validation",
      field: "is_default_card",
      reason: "invalid_type",
    });
    expect((await listNames(who.owner, PM)).map((p) => p.name)).not.toContain("Pix padrão");
  });

  it("cadastro do sistema não é criado nem editado: 422 system_read_only", async () => {
    const created = await createPm(who.owner, "Não informada");
    expect(created.statusCode).toBe(422);
    expect(created.json()).toEqual({
      code: "validation",
      field: "name",
      reason: "system_read_only",
    });
    const id = await insertPm(tenantSolo, "Não informada");
    const edit = await call(soloOwner, "PATCH", `${PM}/${id}`, { body: { feePercentBp: 100 } });
    expect(edit.statusCode).toBe(422);
    expect(edit.json()).toEqual({ code: "validation", field: "name", reason: "system_read_only" });
    const row = await admin("select fee_percent_bp from payment_methods where id = $1", [id]);
    expect(row.rows[0].fee_percent_bp).toBe(0);
    const listed = await listNames(soloOwner, PM);
    expect(listed.find((p) => p.id === id)).toMatchObject({ protected: true });
  });

  it("corpo fora do contrato: 400 invalid_request", async () => {
    const extra = await call(who.owner, "POST", PM, {
      body: { ...pmBody("Extra"), tenantId: tenantB },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual({ code: "invalid_request" });
    expect((await createPm(who.owner, "Taxa alta", { feePercentBp: 10001 })).statusCode).toBe(400);
  });

  it("PATCH muda só o que veio e responde pelo contrato", async () => {
    const created = paymentMethodSettingsSchema.parse(
      (await createPm(who.owner, "Para editar")).json(),
    );
    const response = await call(who.owner, "PATCH", `${PM}/${created.id}`, {
      body: { feePercentBp: 199 },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(paymentMethodSettingsSchema.parse(response.json())).toEqual({
      ...created,
      feePercentBp: 199,
    });
  });

  it("outra empresa: não aparece na lista; PATCH em id dela e id não-UUID dão 404", async () => {
    const idB = await insertPm(tenantB, "Só da B");
    expect((await listNames(who.owner, PM)).map((p) => p.id)).not.toContain(idB);
    const patch = await call(who.owner, "PATCH", `${PM}/${idB}`, { body: { name: "Invadida" } });
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual({ code: "not_found" });
    const row = await admin("select name from payment_methods where id = $1", [idB]);
    expect(row.rows[0].name).toBe("Só da B");
    const noUuid = await call(who.owner, "PATCH", `${PM}/nao-e-uuid`, { body: { name: "Xx" } });
    expect(noUuid.statusCode).toBe(404);
  });
});

describe("canais de venda", () => {
  it("cria e edita pelo contrato", async () => {
    const response = await createCh(who.owner, "Rappi Canal");
    expect(response.statusCode, response.body).toBe(201);
    const created = salesChannelSettingsSchema.parse(response.json());
    const patched = await call(who.owner, "PATCH", `${CH}/${created.id}`, {
      body: { feePercentBp: 1500, aliases: ["rappi"] },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(salesChannelSettingsSchema.parse(patched.json())).toMatchObject({
      feePercentBp: 1500,
      aliases: ["rappi"],
    });
    expect((await listNames(who.accountant, CH)).map((c) => c.id)).toContain(created.id);
  });

  it("nome repetido: 409 name_taken; cadastro do sistema: 422 system_read_only", async () => {
    expect((await createCh(who.owner, "Duplicado")).statusCode).toBe(201);
    const again = await createCh(who.owner, "duplicado");
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "name_taken" });
    const sys = await createCh(who.owner, "Não informado");
    expect(sys.statusCode).toBe(422);
    expect(sys.json()).toEqual({ code: "validation", field: "name", reason: "system_read_only" });
  });

  it("canal padrão de uma unidade não é inativado: 409 channel_is_unit_default", async () => {
    const created = salesChannelSettingsSchema.parse(
      (await createCh(who.owner, "Padrão da unidade")).json(),
    );
    await admin("update units set default_sales_channel_id = $1 where id = $2", [
      created.id,
      unit2,
    ]);
    const response = await call(who.owner, "PATCH", `${CH}/${created.id}`, {
      body: { status: "inactive" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "channel_is_unit_default" });
    const row = await admin("select status from sales_channels where id = $1", [created.id]);
    expect(row.rows[0].status).toBe("active");
  });

  it("outra empresa: fora da lista e PATCH em id dela dá 404", async () => {
    const idB = uuidv7();
    await admin("insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Canal da B')", [
      idB,
      tenantB,
    ]);
    expect((await listNames(who.owner, CH)).map((c) => c.id)).not.toContain(idB);
    const patch = await call(who.owner, "PATCH", `${CH}/${idB}`, { body: { name: "Invadido" } });
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual({ code: "not_found" });
  });

  it("corpo com taxa fixa (campo de forma de pagamento): 400", async () => {
    const response = await call(who.owner, "POST", CH, {
      body: { ...chBody("Com fixa"), feeFixedCents: 30 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("prévia de taxa (RF08.CA01)", () => {
  const preview = (user: Who, query: string) =>
    call(user, "GET", `/api/settings/fee-preview?${query}`);

  it("320 pontos-base sobre R$ 100,00: taxa 320 e líquido 9680", async () => {
    const response = await preview(who.manager, "feePercentBp=320&feeFixedCents=0");
    expect(response.statusCode, response.body).toBe(200);
    expect(feePreviewSchema.parse(response.json())).toEqual({
      grossCents: 10000,
      feeCents: 320,
      netCents: 9680,
    });
  });

  it("soma a taxa fixa", async () => {
    const response = await preview(who.owner, "feePercentBp=100&feeFixedCents=50");
    expect(response.json()).toEqual({ grossCents: 10000, feeCents: 150, netCents: 9850 });
  });

  it("parâmetros inválidos: 422 validation", async () => {
    const cases: Array<[string, string]> = [
      ["feePercentBp=10001&feeFixedCents=0", "fee_percent_bp"],
      ["feePercentBp=abc&feeFixedCents=0", "fee_percent_bp"],
      ["feePercentBp=-1&feeFixedCents=0", "fee_percent_bp"],
      ["feePercentBp=100", "fee_fixed_cents"],
      ["feePercentBp=100&feeFixedCents=1.5", "fee_fixed_cents"],
    ];
    for (const [query, field] of cases) {
      const response = await preview(who.owner, query);
      expect(response.statusCode, query).toBe(422);
      expect(response.json(), query).toEqual({ code: "validation", field, reason: "invalid" });
    }
  });

  it("taxa fixa maior que os R$ 100,00: 422 validation", async () => {
    const response = await preview(who.owner, "feePercentBp=0&feeFixedCents=20000");
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "validation", field: "fee_fixed_cents" });
  });
});

describe("contexto de outra empresa (Review Focus 1)", () => {
  it("gerente da A que é dono da B grava só na empresa do contexto", async () => {
    const { who: user, ctxA, ctxB } = managerA_ownerB;
    const idA = await insertPm(tenantA, "Alvo da A");
    const idB = await insertPm(tenantB, "Alvo da B");
    const denied = await call(user, "PATCH", `${PM}/${idA}`, {
      ctx: ctxA,
      body: { feePercentBp: 777 },
    });
    expect(denied.statusCode).toBe(403);
    // Com o contexto da B, o id da A não existe: 404, e nada muda na A.
    const cross = await call(user, "PATCH", `${PM}/${idA}`, {
      ctx: ctxB,
      body: { feePercentBp: 777 },
    });
    expect(cross.statusCode).toBe(404);
    const allowed = await call(user, "PATCH", `${PM}/${idB}`, {
      ctx: ctxB,
      body: { feePercentBp: 777 },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    const rows = await admin(
      "select id, fee_percent_bp from payment_methods where id = any($1::uuid[])",
      [[idA, idB]],
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.fee_percent_bp]));
    expect(byId[idA]).toBe(0);
    expect(byId[idB]).toBe(777);
  });
});
