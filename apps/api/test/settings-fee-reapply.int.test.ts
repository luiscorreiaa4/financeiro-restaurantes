import { feeReapplicationPreviewSchema, feeReapplicationSchema } from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";
import { FEE_REAPPLY_ROUTE_MATRIX, PERSONAS, type Persona } from "./support/route-matrix";

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
/** Gerente da A e dono da B (contexto troca de empresa). */
let managerA_ownerB: { who: Who; ctxA: string; ctxB: string };
let tenantA: string;
let tenantB: string;
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

const BASE = "/api/settings/fee-reapplications";
const jobs = () => h.exports.jobs.filter((j) => j.queue === "fee-reapply");
const countRows = async (tenantId: string) =>
  (
    await admin("select count(*)::int as n from fee_reapplications where tenant_id = $1", [
      tenantId,
    ])
  ).rows[0].n as number;

async function addMethod(tenantId: string, name: string, bp = 320) {
  const id = uuidv7();
  await admin(
    "insert into payment_methods (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, $3, 'credit', $4)",
    [id, tenantId, name, bp],
  );
  return id;
}
async function addChannel(tenantId: string, name: string, type: string, bp: number) {
  const id = uuidv7();
  await admin(
    "insert into sales_channels (id, tenant_id, name, type, fee_percent_bp) values ($1, $2, $3, $4, $5)",
    [id, tenantId, name, type, bp],
  );
  return id;
}
async function addRevenue(
  tenantId: string,
  unitId: string,
  userId: string,
  methodId: string,
  channelId: string,
  over: { feeBp?: number; type?: string; deleted?: boolean } = {},
) {
  const feeBp = over.feeBp ?? 0;
  const fee = Math.round((10000 * feeBp) / 10000);
  await admin(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents,
       fee_percent_bp, fee_cents, net_cents, payment_method_id, sales_channel_id, created_by, deleted_at)
     values ($1, $2, $3, $4, '2026-10-10', '2026-10-10', 'v', 10000, $5, $6, $7, $8, $9, $10, $11)`,
    [
      uuidv7(),
      tenantId,
      unitId,
      over.type ?? "revenue",
      feeBp,
      fee,
      10000 - fee,
      methodId,
      over.type === "expense" ? null : channelId,
      userId,
      over.deleted ? new Date("2026-10-20T10:00:00Z") : null,
    ],
  );
}

const period = { from: "2026-10-01", to: "2026-10-31" };
const confirmBody = (targetId: string, over: Record<string, unknown> = {}) => ({
  targetKind: "payment_method",
  targetId,
  ...period,
  clientRequestId: uuidv7(),
  ...over,
});

describe("matriz papel × rota de reaplicação de taxa (RF08, RF09, RF06.CA06)", () => {
  for (const route of FEE_REAPPLY_ROUTE_MATRIX) {
    for (const persona of PERSONAS) {
      const status = route.expected[persona];
      it(`${route.name}: ${persona} recebe ${status}`, async () => {
        const response = await call(who[persona], route.method, route.url(), {
          body: route.body?.(),
        });
        expect(response.statusCode, response.body).toBe(status);
        if (status >= 400) expect(response.json()).toHaveProperty("code");
      });
    }
  }

  it("sem X-Context: 409 context_changed em todas as rotas", async () => {
    for (const route of FEE_REAPPLY_ROUTE_MATRIX) {
      const response = await call(who.owner, route.method, route.url(), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });

  it("as rotas não criaram linha nenhuma (todas apontavam para alvo inexistente)", async () => {
    expect(await countRows(tenantA)).toBe(0);
  });
});

describe("prévia", () => {
  it("conta só receita ativa do alvo no período e soma a diferença do líquido", async () => {
    const pm = await addMethod(tenantA, "Crédito prévia");
    const salao = await addChannel(tenantA, "Salão prévia", "dine_in", 0);
    const ifood = await addChannel(tenantA, "iFood prévia", "app", 1200);
    for (let i = 0; i < 3; i += 1) {
      await addRevenue(tenantA, unit1, who.owner.userId, pm, salao);
    }
    await addRevenue(tenantA, unit1, who.owner.userId, pm, salao, { type: "expense" });
    await addRevenue(tenantA, unit1, who.owner.userId, pm, salao, { deleted: true });
    // Review Focus 4: a comissão do app já vale; a forma não muda este lançamento.
    await addRevenue(tenantA, unit2, who.owner.userId, pm, ifood, { feeBp: 1200 });
    const response = await call(who.owner, "POST", `${BASE}/preview`, {
      body: { targetKind: "payment_method", targetId: pm, ...period },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(feeReapplicationPreviewSchema.parse(response.json())).toEqual({
      matched: 3,
      deltaNetCents: -960,
      feePercentBp: 320,
      feeFixedCents: 0,
    });
    expect(await countRows(tenantA)).toBe(0);
  });

  it("alvo de outra empresa, inexistente ou com o tipo trocado: 404 e nenhuma linha", async () => {
    const mine = await addMethod(tenantA, "Minha prévia");
    const theirs = await addMethod(tenantB, "Da B prévia");
    const cases = [
      { targetKind: "payment_method", targetId: theirs },
      { targetKind: "payment_method", targetId: uuidv7() },
      { targetKind: "sales_channel", targetId: mine },
    ];
    for (const target of cases) {
      const response = await call(who.owner, "POST", `${BASE}/preview`, {
        body: { ...target, ...period },
      });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toEqual({ code: "not_found" });
    }
    expect(await countRows(tenantA)).toBe(0);
    expect(await countRows(tenantB)).toBe(0);
  });

  it("período acima de 366 dias, fim no futuro ou invertido: recusado", async () => {
    const pm = await addMethod(tenantA, "Período");
    const long = await call(who.owner, "POST", `${BASE}/preview`, {
      body: { targetKind: "payment_method", targetId: pm, from: "2025-01-01", to: "2026-01-03" },
    });
    expect(long.statusCode).toBe(422);
    expect(long.json()).toEqual({ code: "validation", field: "period", reason: "too_long" });
    const future = await call(who.owner, "POST", `${BASE}/preview`, {
      body: { targetKind: "payment_method", targetId: pm, from: "2026-11-01", to: "2026-12-31" },
    });
    expect(future.statusCode).toBe(422);
    expect(future.json()).toEqual({ code: "validation", field: "to", reason: "future" });
    const inverted = await call(who.owner, "POST", `${BASE}/preview`, {
      body: { targetKind: "payment_method", targetId: pm, from: "2026-10-31", to: "2026-10-01" },
    });
    expect(inverted.statusCode).toBe(400);
  });
});

describe("confirmação", () => {
  it("grava a linha queued, enfileira o job e responde pelo contrato; replay não duplica", async () => {
    const pm = await addMethod(tenantA, "Crédito confirma", 350);
    const before = jobs().length;
    const body = confirmBody(pm);
    const first = await call(who.owner, "POST", BASE, { body });
    expect(first.statusCode, first.body).toBe(202);
    const created = feeReapplicationSchema.parse(first.json());
    expect(created).toMatchObject({ status: "queued", targetId: pm, from: "2026-10-01" });
    expect(jobs()).toHaveLength(before + 1);
    expect(jobs().at(-1)?.payload).toEqual({ tenantId: tenantA, reapplicationId: created.id });
    const stored = await admin(
      "select fee_percent_bp, created_by, client_request_id from fee_reapplications where id = $1",
      [created.id],
    );
    expect(stored.rows[0]).toMatchObject({
      fee_percent_bp: 350,
      created_by: who.owner.userId,
      client_request_id: body.clientRequestId,
    });

    const again = await call(who.owner, "POST", BASE, { body });
    expect(again.statusCode, again.body).toBe(200);
    expect(feeReapplicationSchema.parse(again.json()).id).toBe(created.id);
    // Linha ainda queued: o replay reenfileira o mesmo job (a fila `exclusive` o deduplica).
    expect(jobs()).toHaveLength(before + 2);
    expect(jobs().at(-1)?.payload).toEqual(jobs().at(-2)?.payload);
    const rows = await admin(
      "select count(*)::int as n from fee_reapplications where target_id = $1",
      [pm],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("a mesma clientRequestId em outra empresa não colide nem revela nada", async () => {
    const pmA = await addMethod(tenantA, "Chave A");
    const pmB = await addMethod(tenantB, "Chave B");
    const clientRequestId = uuidv7();
    const a = await call(who.owner, "POST", BASE, { body: confirmBody(pmA, { clientRequestId }) });
    expect(a.statusCode, a.body).toBe(202);
    const b = await call(managerA_ownerB.who, "POST", BASE, {
      ctx: managerA_ownerB.ctxB,
      body: confirmBody(pmB, { clientRequestId }),
    });
    expect(b.statusCode, b.body).toBe(202);
    expect(feeReapplicationSchema.parse(b.json()).id).not.toBe(
      feeReapplicationSchema.parse(a.json()).id,
    );
  });

  it("alvo ativo: 409 reapply_in_progress com a linha atual; outro alvo não bloqueia", async () => {
    const pm = await addMethod(tenantA, "Ativo");
    const other = await addMethod(tenantA, "Outro ativo");
    const first = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    expect(first.statusCode).toBe(202);
    const before = jobs().length;
    const second = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    expect(second.statusCode, second.body).toBe(409);
    const json = second.json() as { code: string; item: unknown };
    expect(json.code).toBe("reapply_in_progress");
    expect(feeReapplicationSchema.parse(json.item).id).toBe(first.json().id);
    expect(jobs()).toHaveLength(before);
    expect((await call(who.owner, "POST", BASE, { body: confirmBody(other) })).statusCode).toBe(
      202,
    );
    // running também bloqueia.
    await admin("update fee_reapplications set status = 'running' where id = $1", [
      first.json().id,
    ]);
    expect((await call(who.owner, "POST", BASE, { body: confirmBody(pm) })).statusCode).toBe(409);
  });

  it("linha queued órfã (2 h): novo POST do alvo é aceito e a antiga vira failed/stale", async () => {
    const pm = await addMethod(tenantA, "Órfã rota");
    const orphan = uuidv7();
    await admin(
      `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date,
         fee_percent_bp, fee_fixed_cents, status, created_by, client_request_id, created_at)
       values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 320, 0, 'queued', $4, $5,
         now() - interval '2 hours')`,
      [orphan, tenantA, pm, who.owner.userId, uuidv7()],
    );
    const response = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    expect(response.statusCode, response.body).toBe(202);
    const old = await admin("select status, error_code from fee_reapplications where id = $1", [
      orphan,
    ]);
    expect(old.rows[0]).toEqual({ status: "failed", error_code: "stale" });
  });

  it("linha queued recente do alvo continua dando 409 com o contrato tipado", async () => {
    const pm = await addMethod(tenantA, "Recente rota");
    const first = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    const second = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    expect(second.statusCode).toBe(409);
    expect(Object.keys(second.json()).sort()).toEqual(["code", "item"]);
    expect(feeReapplicationSchema.parse(second.json().item).id).toBe(first.json().id);
  });

  it("replay da mesma chave com a linha ainda queued reenfileira o job (API caiu antes do enqueue)", async () => {
    const pm = await addMethod(tenantA, "Replay órfão");
    const id = uuidv7();
    const clientRequestId = uuidv7();
    await admin(
      `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date,
         fee_percent_bp, fee_fixed_cents, status, created_by, client_request_id)
       values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 320, 0, 'queued', $4, $5)`,
      [id, tenantA, pm, who.owner.userId, clientRequestId],
    );
    const before = jobs().length;
    const response = await call(who.owner, "POST", BASE, {
      body: confirmBody(pm, { clientRequestId }),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(feeReapplicationSchema.parse(response.json()).id).toBe(id);
    expect(jobs()).toHaveLength(before + 1);
    expect(jobs().at(-1)?.payload).toEqual({ tenantId: tenantA, reapplicationId: id });
    // Linha terminada não reenfileira.
    await admin("update fee_reapplications set status = 'done' where id = $1", [id]);
    await call(who.owner, "POST", BASE, { body: confirmBody(pm, { clientRequestId }) });
    expect(jobs()).toHaveLength(before + 1);
  });

  it("alvo de outra empresa, inexistente ou com tipo trocado: 404 e nenhuma linha nova", async () => {
    const mine = await addMethod(tenantA, "Confirma tipo");
    const theirs = await addMethod(tenantB, "Da B confirma");
    const beforeA = await countRows(tenantA);
    const beforeB = await countRows(tenantB);
    const beforeJobs = jobs().length;
    for (const target of [
      { targetId: theirs },
      { targetId: uuidv7() },
      { targetKind: "sales_channel", targetId: mine },
    ]) {
      const response = await call(who.owner, "POST", BASE, { body: confirmBody(mine, target) });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toEqual({ code: "not_found" });
    }
    expect(await countRows(tenantA)).toBe(beforeA);
    expect(await countRows(tenantB)).toBe(beforeB);
    expect(jobs()).toHaveLength(beforeJobs);
  });

  it("período inválido na confirmação: 422 e nenhuma linha", async () => {
    const pm = await addMethod(tenantA, "Confirma período");
    const before = await countRows(tenantA);
    const response = await call(who.owner, "POST", BASE, {
      body: confirmBody(pm, { from: "2025-01-01", to: "2026-01-03" }),
    });
    expect(response.statusCode).toBe(422);
    expect(await countRows(tenantA)).toBe(before);
  });

  it("falha ao enfileirar: 503, linha failed/queue_unavailable e o alvo volta a aceitar", async () => {
    const pm = await addMethod(tenantA, "Fila fora");
    h.exports.failNext = true;
    const response = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toEqual({ code: "queue_unavailable" });
    const row = await admin(
      "select status, error_code from fee_reapplications where target_id = $1",
      [pm],
    );
    expect(row.rows).toEqual([{ status: "failed", error_code: "queue_unavailable" }]);
    expect((await call(who.owner, "POST", BASE, { body: confirmBody(pm) })).statusCode).toBe(202);
  });
});

describe("última reaplicação do alvo", () => {
  it("devolve a mais recente pelo contrato; outra empresa não a vê", async () => {
    const pm = await addMethod(tenantA, "Última");
    const url = `${BASE}?targetKind=payment_method&targetId=${pm}`;
    expect((await call(who.owner, "GET", url)).json()).toEqual({ item: null });
    const created = await call(who.owner, "POST", BASE, { body: confirmBody(pm) });
    const got = await call(who.owner, "GET", url);
    expect(got.statusCode).toBe(200);
    const { item } = got.json() as { item: unknown };
    expect(feeReapplicationSchema.parse(item).id).toBe(created.json().id);
    const other = await call(managerA_ownerB.who, "GET", url, { ctx: managerA_ownerB.ctxB });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({ item: null });
  });

  it("consulta malformada: 400", async () => {
    const response = await call(who.owner, "GET", `${BASE}?targetKind=outro&targetId=x`);
    expect(response.statusCode).toBe(400);
  });
});
