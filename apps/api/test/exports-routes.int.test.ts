import {
  EXPORT_MAX_PENDING,
  type ExportItem,
  exportItemSchema,
  exportLinkResponseSchema,
  exportListResponseSchema,
} from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, START, startAuthHarness } from "./support/auth-harness";
import {
  EXPORT_ROUTE_MATRIX,
  type ExportMatrixFixture,
  PERSONAS,
  type Persona,
} from "./support/route-matrix";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";
const FILE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const SECRET_SEARCH = "Fornecedor Secreto da Busca";
const PERIOD = { from: "2026-11-01", to: "2026-11-30" };

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.7.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

interface Who {
  userId: string;
  session: string;
  /** Valor do `fr_ctx` e do `X-Context`; a sessão restrita não tem. */
  ctx?: string;
}

let who: Record<Persona, Who>;
let accountant2: Who;
let managerNoExport: Who;
let ownerB: Who;
let tenantA: string;
let tenantB: string;
let unit1: string;
let unit2: string;
let unit3: string;
let FIXTURE: ExportMatrixFixture;

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
    await admin("insert into units (id, tenant_id, name) values ($1, $2, $3)", [
      id,
      tenantId,
      unitName,
    ]);
    unitIds.push(id);
  }
  return { tenantId, unitIds };
}

/** Usuário com senha, sem vínculo ativo na empresa que o harness cria junto. */
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
  method: "GET" | "POST",
  url: string,
  extra: {
    ctx?: string;
    xContext?: string | null;
    body?: unknown;
    origin?: string | null;
  } = {},
) {
  const ctx = extra.ctx ?? user.ctx;
  const xContext = extra.xContext === undefined ? ctx : extra.xContext;
  const origin = extra.origin === undefined ? h.origin : extra.origin;
  const cookie = [user.session, ctx !== undefined ? `${CTX}=${ctx}` : ""]
    .filter(Boolean)
    .join("; ");
  return h.app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      ...(origin !== null ? { origin } : {}),
      "user-agent": "vitest",
      cookie,
      ...(xContext != null ? { "x-context": xContext } : {}),
      ...(extra.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(extra.body !== undefined ? { payload: JSON.stringify(extra.body) } : {}),
  });
}

const createBody = (overrides: Record<string, unknown> = {}) => ({
  format: "csv",
  content: "entries",
  filters: { ...PERIOD },
  clientRequestId: uuidv7(),
  ...overrides,
});

const create = (user: Who, overrides: Record<string, unknown> = {}) =>
  call(user, "POST", "/api/exports", { body: createBody(overrides) });

/**
 * Unidade do pedido: a do contexto de quem pede (o pedido real grava `panel.unitId`); `all` só
 * vale para quem tem todas as unidades, e o worker e as rotas revalidam isso.
 */
const unitChoiceOf = (user: Who): string => user.ctx?.split(".")[1] ?? "all";

/** Pedido pronto com arquivo no store, gravado direto (sem passar pela rota). */
async function seedReady(
  user: Who,
  tenantId: string,
  options: { createdAt?: string; fileDeleted?: boolean; withFile?: boolean; status?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const key = `exports/${tenantId}/${id}.csv`;
  const status = options.status ?? "ready";
  await admin(
    `insert into exports (id, tenant_id, requested_by, unit_choice, format, content, filters, status,
       row_count, file_size, file_key, client_request_id, created_at, finished_at, file_deleted_at)
     values ($1, $2, $3, $12, 'csv', 'entries', $4::jsonb, $5, 1, $6, $7, $8,
       coalesce($9::timestamptz, $10::timestamptz), $10::timestamptz,
       case when $11::boolean then $10::timestamptz else null end)`,
    [
      id,
      tenantId,
      user.userId,
      JSON.stringify(PERIOD),
      status,
      FILE_BYTES.length,
      status === "ready" ? key : null,
      uuidv7(),
      options.createdAt ?? null,
      START.toISOString(),
      options.fileDeleted ?? false,
      unitChoiceOf(user),
    ],
  );
  if (options.withFile !== false && status === "ready") {
    await h.exports.store.put(key, FILE_BYTES);
  }
  return id;
}

function downloadUrl(user: Who, tenantId: string, exportId: string): string {
  const { token } = h.exports.signer.issue({ exportId, userId: user.userId, tenantId });
  return `/api/exports/${exportId}/download?t=${token}`;
}

const itemOf = (response: { json(): unknown }): ExportItem =>
  exportItemSchema.parse(response.json());

beforeAll(async () => {
  h = await startAuthHarness();
  const a = await addTenant("Empresa A", ["Unidade 1", "Unidade 2", "Unidade 3"]);
  tenantA = a.tenantId;
  [unit1, unit2, unit3] = a.unitIds as [string, string, string];
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
  // Sessão aberta e painel retirado em seguida: a sessão continua, o acesso não.
  await admin("update memberships set panel_access = false where user_id = $1", [
    staffNoPanelUser.userId,
  ]);

  who = {
    owner: await member(tenantA, { role: "owner" }, all),
    manager: await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2], permissions: ["VER_FOLHA", "EXPORTAR_DADOS"] },
      at1,
    ),
    managerNoPayroll: await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2], permissions: ["EXPORTAR_DADOS"] },
      at1,
    ),
    staff: await member(tenantA, { role: "staff", unitIds: [unit1] }, at1),
    accountant: await member(tenantA, { role: "accountant" }, all),
    restricted: {
      userId: restrictedUser.userId,
      session: await login(restrictedUser.email),
    },
    readOnly: await member(c.tenantId, { role: "owner" }, `${c.tenantId}.all`),
    staffNoPanel: staffNoPanelWho,
  };
  accountant2 = await member(tenantA, { role: "accountant" }, all);
  managerNoExport = await member(
    tenantA,
    { role: "manager", unitIds: [unit1], permissions: ["VER_FOLHA"] },
    at1,
  );
  ownerB = await member(tenantB, { role: "owner" }, `${tenantB}.all`);

  const tenantOf = (persona: Persona) => (persona === "readOnly" ? c.tenantId : tenantA);
  const exportIds = {} as Record<Persona, string>;
  const downloadUrls = {} as Record<Persona, string>;
  for (const persona of PERSONAS) {
    exportIds[persona] = await seedReady(who[persona], tenantOf(persona));
    downloadUrls[persona] = downloadUrl(who[persona], tenantOf(persona), exportIds[persona]);
  }
  FIXTURE = { exportIds, downloadUrls };
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("matriz papel × rota das exportações (RF29, RF06.CA06)", () => {
  for (const route of EXPORT_ROUTE_MATRIX) {
    for (const persona of PERSONAS) {
      const status = route.expected[persona];
      it(`${route.name}: ${persona} recebe ${status}`, async () => {
        const response = await call(who[persona], route.method, route.url(FIXTURE, persona), {
          body: route.body?.(),
          ...(route.navigation ? { xContext: null } : {}),
        });
        expect(response.statusCode, response.body).toBe(status);
        if (status >= 400) {
          // Recusa não leva dado nenhum, só o código.
          expect(Object.keys(response.json()).filter((key) => key !== "message")).toEqual(["code"]);
        }
      });
    }
  }

  it("sem sessão: 401 em todas as rotas", async () => {
    for (const route of EXPORT_ROUTE_MATRIX) {
      const response = await h.app.inject({
        method: route.method,
        url: route.url(FIXTURE, "owner"),
        headers: {
          origin: h.origin,
          ...(route.body ? { "content-type": "application/json" } : {}),
        },
        ...(route.body ? { payload: JSON.stringify(route.body()) } : {}),
      });
      expect(response.statusCode, route.name).toBe(401);
    }
  });

  it("sem X-Context: 409 context_changed nas três rotas de fetch (o download é navegação)", async () => {
    for (const route of EXPORT_ROUTE_MATRIX.filter((candidate) => !candidate.navigation)) {
      const response = await call(who.owner, route.method, route.url(FIXTURE, "owner"), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });

  it("cookie de contexto forjado para a empresa B: 403 context_invalid, também no download", async () => {
    const forged = `${tenantB}.all`;
    const list = await call(who.owner, "GET", "/api/exports", { ctx: forged });
    expect(list.statusCode).toBe(403);
    expect(list.json()).toEqual({ code: "context_invalid" });
    const download = await call(who.owner, "GET", FIXTURE.downloadUrls.owner, {
      ctx: forged,
      xContext: null,
    });
    expect(download.statusCode).toBe(403);
    expect(download.json()).toEqual({ code: "context_invalid" });
  });
});

describe("POST /api/exports", () => {
  it("cria o pedido: 202 com o item na fila, job só com ids e auditoria sem texto de busca", async () => {
    const jobsBefore = h.exports.jobs.length;
    const response = await create(who.owner, {
      filters: { ...PERIOD, q: SECRET_SEARCH, unitIds: [unit1] },
    });
    expect(response.statusCode, response.body).toBe(202);
    const item = itemOf(response);
    expect(item).toMatchObject({
      status: "queued",
      format: "csv",
      content: "entries",
      rowCount: null,
      available: false,
    });
    expect(h.exports.jobs).toHaveLength(jobsBefore + 1);
    expect(h.exports.jobs.at(-1)).toEqual({
      queue: "generate-export",
      payload: { tenantId: tenantA, exportId: item.id },
    });
    const audit = await admin(
      "select action, actor_id, metadata from audit_log where target = $1 order by created_at",
      [item.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "export_requested", actor_id: who.owner.userId });
    expect(audit.rows[0].metadata).toMatchObject({
      format: "csv",
      content: "entries",
      filters: { from: PERIOD.from, to: PERIOD.to, q: "[busca]", unitIds: [unit1] },
    });
    // O texto livre da busca nunca vai para a auditoria nem para o log (regra 9).
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET_SEARCH);
    expect(h.logLines.join("\n")).not.toContain(SECRET_SEARCH);
    // O pedido guarda a busca para o worker filtrar (é o que "estes filtros" significa).
    const stored = await admin("select filters, unit_choice from exports where id = $1", [item.id]);
    expect(stored.rows[0].filters.q).toBe(SECRET_SEARCH);
    expect(stored.rows[0].unit_choice).toBe("all");
  });

  it("corpo inválido: 400 invalid_request", async () => {
    for (const body of [
      {},
      createBody({ format: "pdf" }),
      createBody({ clientRequestId: "nao-e-uuid" }),
      createBody({ filters: { from: "2026-11-30", to: "2026-11-01" } }),
      { ...createBody(), extra: 1 },
    ]) {
      const response = await call(who.owner, "POST", "/api/exports", { body });
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toEqual({ code: "invalid_request" });
    }
  });

  it("COMPLETO só do dono: contador e gerente com EXPORTAR_DADOS recebem 403 forbidden", async () => {
    for (const user of [who.accountant, who.manager]) {
      const response = await create(user, { content: "full" });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: "forbidden" });
    }
    expect((await create(who.owner, { content: "full" })).statusCode).toBe(202);
  });

  it("CA03: gerente sem EXPORTAR_DADOS recebe 403 forbidden e nada é gravado", async () => {
    const body = createBody();
    const response = await call(managerNoExport, "POST", "/api/exports", { body });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
    const rows = await admin("select 1 from exports where client_request_id = $1", [
      body.clientRequestId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("unidade do filtro fora do acesso: 403 forbidden e nada é gravado", async () => {
    const body = createBody({ filters: { ...PERIOD, unitIds: [unit3] } });
    const response = await call(who.managerNoPayroll, "POST", "/api/exports", { body });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
    const rows = await admin("select 1 from exports where client_request_id = $1", [
      body.clientRequestId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("sem Origin a escrita é recusada pelo hook global (origin_forbidden)", async () => {
    const response = await call(who.owner, "POST", "/api/exports", {
      body: createBody(),
      origin: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "origin_forbidden" });
  });

  it("repetição da mesma chave: 202 e depois 200 com o mesmo pedido, uma linha e um job", async () => {
    const body = createBody();
    const jobsBefore = h.exports.jobs.length;
    const first = await call(who.managerNoPayroll, "POST", "/api/exports", { body });
    expect(first.statusCode).toBe(202);
    // Corpo diferente com a mesma chave devolve o primeiro pedido.
    const second = await call(who.managerNoPayroll, "POST", "/api/exports", {
      body: { ...body, format: "xlsx" },
    });
    expect(second.statusCode).toBe(200);
    expect(itemOf(second)).toEqual(itemOf(first));
    const rows = await admin("select 1 from exports where client_request_id = $1", [
      body.clientRequestId,
    ]);
    expect(rows.rowCount).toBe(1);
    expect(h.exports.jobs).toHaveLength(jobsBefore + 1);
  });

  it("a mesma chave de outro usuário não colide nem revela o pedido do primeiro", async () => {
    const body = createBody();
    const first1 = await member(tenantA, { role: "owner" }, `${tenantA}.all`);
    const second1 = await member(tenantA, { role: "accountant" }, `${tenantA}.all`);
    const first = await call(first1, "POST", "/api/exports", { body });
    expect(first.statusCode).toBe(202);
    const other = await call(second1, "POST", "/api/exports", { body });
    expect(other.statusCode).toBe(202);
    expect(itemOf(other).id).not.toBe(itemOf(first).id);
  });

  it("Review Focus 6: com 3 pendentes, o reenvio da mesma chave dá 200 com o mesmo id; chave nova dá 429", async () => {
    const first = await create(accountant2);
    expect(first.statusCode).toBe(202);
    const keyed = createBody();
    const keyedResponse = await call(accountant2, "POST", "/api/exports", { body: keyed });
    expect(keyedResponse.statusCode).toBe(202);
    expect((await create(accountant2)).statusCode).toBe(202);

    const pending = await admin(
      "select count(*)::int as n from exports where requested_by = $1 and status = 'queued'",
      [accountant2.userId],
    );
    expect(pending.rows[0].n).toBe(EXPORT_MAX_PENDING);

    const replay = await call(accountant2, "POST", "/api/exports", { body: keyed });
    expect(replay.statusCode).toBe(200);
    expect(itemOf(replay).id).toBe(itemOf(keyedResponse).id);

    const over = await create(accountant2);
    expect(over.statusCode).toBe(429);
    expect(over.json()).toEqual({ code: "too_many_pending" });
    const after = await admin("select count(*)::int as n from exports where requested_by = $1", [
      accountant2.userId,
    ]);
    expect(after.rows[0].n).toBe(EXPORT_MAX_PENDING);
  });

  it("corrida da mesma chave (linha sem commit noutra conexão): o 23505 vira 200 com o pedido que ganhou", async () => {
    const user = await member(tenantA, { role: "accountant" }, `${tenantA}.all`);
    const body = createBody();
    const winner = uuidv7();
    const conn = await h.db.admin.connect();
    try {
      await conn.query("begin");
      await conn.query(
        `insert into exports (id, tenant_id, requested_by, unit_choice, format, content, filters,
           status, client_request_id)
         values ($1, $2, $3, 'all', 'csv', 'entries', $4::jsonb, 'queued', $5)`,
        [winner, tenantA, user.userId, JSON.stringify(PERIOD), body.clientRequestId],
      );
      // A rota não vê a linha (sem commit), tenta inserir e fica esperando o índice único.
      const pending = call(user, "POST", "/api/exports", { body });
      const deadline = Date.now() + 10_000;
      for (;;) {
        const waiting = await admin(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%insert into \"exports\"%'",
        );
        if ((waiting.rowCount ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error("a inserção não ficou esperando o índice");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await conn.query("commit");
      const response = await pending;
      expect(response.statusCode, response.body).toBe(200);
      expect(itemOf(response).id).toBe(winner);
    } finally {
      await conn.query("rollback").catch(() => undefined);
      conn.release();
    }
    const rows = await admin("select 1 from exports where client_request_id = $1", [
      body.clientRequestId,
    ]);
    expect(rows.rowCount).toBe(1);
  });

  it("fila fora do ar depois do commit: 503 queue_unavailable, pedido failed/generation_failed e auditado, sem pendente eterno", async () => {
    const user = await member(tenantA, { role: "accountant" }, `${tenantA}.all`);
    const body = createBody();
    h.exports.failNext = true;
    const response = await call(user, "POST", "/api/exports", { body });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "queue_unavailable" });
    const row = await admin(
      "select id, status, error_code from exports where client_request_id = $1",
      [body.clientRequestId],
    );
    expect(row.rows[0]).toMatchObject({ status: "failed", error_code: "generation_failed" });
    const audit = await admin(
      "select action from exports e join audit_log a on a.target = e.id::text where e.id = $1 order by a.created_at",
      [row.rows[0].id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["export_requested", "export_failed"]);
    // Não conta como pendente, e o reenvio da mesma chave mostra o pedido falho (200).
    const replay = await call(user, "POST", "/api/exports", { body });
    expect(replay.statusCode).toBe(200);
    expect(itemOf(replay)).toMatchObject({ status: "failed", errorCode: "generation_failed" });
  });
});

describe("GET /api/exports", () => {
  it("lista só os pedidos do próprio usuário na empresa ativa, dos últimos 7 dias, com available", async () => {
    const user = await member(tenantA, { role: "owner" }, `${tenantA}.all`);
    const ready = await seedReady(user, tenantA);
    const noFile = await seedReady(user, tenantA, { fileDeleted: true });
    const old = await seedReady(user, tenantA, { createdAt: "2026-10-31T12:00:00.000Z" });
    await seedReady(who.owner, tenantA);
    await seedReady(ownerB, tenantB);

    const response = await call(user, "GET", "/api/exports");
    expect(response.statusCode).toBe(200);
    const list = exportListResponseSchema.parse(response.json());
    expect(response.json()).toEqual(list);
    expect(list.items.map((item) => item.id).sort()).toEqual([ready, noFile].sort());
    expect(list.items.find((item) => item.id === ready)?.available).toBe(true);
    expect(list.items.find((item) => item.id === noFile)?.available).toBe(false);
    expect(list.items.map((item) => item.id)).not.toContain(old);
  });

  it("duas empresas: A não vê o pedido de B e B não vê o de A", async () => {
    const idB = await seedReady(ownerB, tenantB);
    const fromA = await call(who.owner, "GET", "/api/exports");
    const listA = exportListResponseSchema.parse(fromA.json());
    expect(listA.items.map((item) => item.id)).not.toContain(idB);
    expect(fromA.body).not.toContain(idB);
    const fromB = await call(ownerB, "GET", "/api/exports");
    const listB = exportListResponseSchema.parse(fromB.json());
    expect(listB.items.map((item) => item.id)).toEqual(expect.arrayContaining([idB]));
    expect(listB.items.map((item) => item.id)).not.toContain(FIXTURE.exportIds.owner);
  });

  it("outro usuário da mesma empresa não vê o pedido do primeiro", async () => {
    const response = await call(who.accountant, "GET", "/api/exports");
    const list = exportListResponseSchema.parse(response.json());
    expect(list.items.map((item) => item.id)).not.toContain(FIXTURE.exportIds.owner);
    expect(list.items.map((item) => item.id)).toContain(FIXTURE.exportIds.accountant);
  });
});

describe("POST /api/exports/:id/link", () => {
  it("caminho certo: url com token e expiração de 1 h, no contrato", async () => {
    const response = await call(who.owner, "POST", `/api/exports/${FIXTURE.exportIds.owner}/link`);
    expect(response.statusCode).toBe(200);
    const link = exportLinkResponseSchema.parse(response.json());
    expect(response.json()).toEqual(link);
    expect(link.url).toMatch(
      new RegExp(`^/api/exports/${FIXTURE.exportIds.owner}/download\\?t=[A-Za-z0-9_-]+$`),
    );
    expect(new Date(link.expiresAt).getTime()).toBe(START.getTime() + 3_600_000);
  });

  it("outro usuário, outra empresa e id inexistente: o mesmo 404 export_not_found", async () => {
    const targets: Array<[Who, string]> = [
      [who.accountant, FIXTURE.exportIds.owner],
      [ownerB, FIXTURE.exportIds.owner],
      [who.owner, uuidv7()],
      [who.owner, "nao-e-uuid"],
    ];
    for (const [user, id] of targets) {
      const response = await call(user, "POST", `/api/exports/${id}/link`);
      expect(response.statusCode, id).toBe(404);
      expect(response.json()).toEqual({ code: "export_not_found" });
    }
  });

  it("pedido que não está pronto: 409 export_not_ready", async () => {
    for (const status of ["queued", "generating", "failed"]) {
      const id = await seedReady(who.owner, tenantA, { status });
      const response = await call(who.owner, "POST", `/api/exports/${id}/link`);
      expect(response.statusCode, status).toBe(409);
      expect(response.json()).toEqual({ code: "export_not_ready" });
    }
  });

  it("arquivo apagado ou pedido com mais de 7 dias: 410 export_expired", async () => {
    const deleted = await seedReady(who.owner, tenantA, { fileDeleted: true });
    const old = await seedReady(who.owner, tenantA, { createdAt: "2026-11-01T12:00:00.000Z" });
    for (const id of [deleted, old]) {
      const response = await call(who.owner, "POST", `/api/exports/${id}/link`);
      expect(response.statusCode, id).toBe(410);
      expect(response.json()).toEqual({ code: "export_expired" });
    }
  });
});

describe("GET /api/exports/:id/download", () => {
  it("devolve os bytes com os cabeçalhos de anexo, sem cache, e audita o download", async () => {
    const url = downloadUrl(who.owner, tenantA, FIXTURE.exportIds.owner);
    const response = await call(who.owner, "GET", url, { xContext: null });
    expect(response.statusCode).toBe(200);
    expect(new Uint8Array(response.rawPayload)).toEqual(FILE_BYTES);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="lancamentos_2026-11-01_2026-11-30.csv"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const audit = await admin(
      "select actor_id, metadata from audit_log where target = $1 and action = 'export_downloaded'",
      [FIXTURE.exportIds.owner],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
    expect(audit.rows[0].actor_id).toBe(who.owner.userId);
    expect(JSON.stringify(audit.rows)).not.toContain("t=");
  });

  it("nunca loga o token do link", async () => {
    const url = downloadUrl(who.owner, tenantA, FIXTURE.exportIds.owner);
    const token = url.split("t=")[1] as string;
    await call(who.owner, "GET", url, { xContext: null });
    expect(h.logLines.join("\n")).not.toContain(token);
  });

  it("sem token, com token qualquer ou de outro pedido: 403 link_invalid e nenhum byte", async () => {
    const other = await seedReady(who.owner, tenantA);
    const otherToken = h.exports.signer.issue({
      exportId: other,
      userId: who.owner.userId,
      tenantId: tenantA,
    }).token;
    const id = FIXTURE.exportIds.owner;
    for (const query of ["", "?t=", "?t=lixo", `?t=${otherToken}`]) {
      const response = await call(who.owner, "GET", `/api/exports/${id}/download${query}`, {
        xContext: null,
      });
      expect(response.statusCode, query).toBe(403);
      expect(response.json()).toEqual({ code: "link_invalid" });
      expect(new Uint8Array(response.rawPayload)).not.toEqual(FILE_BYTES);
    }
  });

  it("token com arquivo ausente do store: 403 antes de 410 quando o token é inválido, 410 quando é válido", async () => {
    const id = await seedReady(who.owner, tenantA, { withFile: false });
    const bad = await call(who.owner, "GET", `/api/exports/${id}/download?t=lixo`, {
      xContext: null,
    });
    expect(bad.statusCode).toBe(403);
    const good = await call(who.owner, "GET", downloadUrl(who.owner, tenantA, id), {
      xContext: null,
    });
    expect(good.statusCode).toBe(410);
    expect(good.json()).toEqual({ code: "export_expired" });
  });

  it("arquivo apagado ou pedido com mais de 7 dias: 410 export_expired, sem byte", async () => {
    const deleted = await seedReady(who.owner, tenantA, { fileDeleted: true });
    const old = await seedReady(who.owner, tenantA, { createdAt: "2026-11-01T12:00:00.000Z" });
    for (const id of [deleted, old]) {
      const response = await call(who.owner, "GET", downloadUrl(who.owner, tenantA, id), {
        xContext: null,
      });
      expect(response.statusCode, id).toBe(410);
      expect(response.json()).toEqual({ code: "export_expired" });
    }
  });

  it("CA04 / Review Focus 2: o link do dono aberto pela sessão do contador ou de outra empresa dá 404 e nenhum byte", async () => {
    const url = downloadUrl(who.owner, tenantA, FIXTURE.exportIds.owner);
    for (const user of [who.accountant, ownerB]) {
      const response = await call(user, "GET", url, { xContext: null });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "export_not_found" });
      expect(new Uint8Array(response.rawPayload)).not.toEqual(FILE_BYTES);
      expect(response.headers["content-disposition"]).toBeUndefined();
    }
  });

  it("CA05 / Review Focus 3: em t0 + 3600 s passa; em t0 + 3601 s é 403 link_invalid", async () => {
    try {
      const url = downloadUrl(who.owner, tenantA, FIXTURE.exportIds.owner);
      h.clock.advance(3_600_000);
      const inTime = await call(who.owner, "GET", url, { xContext: null });
      expect(inTime.statusCode).toBe(200);
      h.clock.advance(1_000);
      const late = await call(who.owner, "GET", url, { xContext: null });
      expect(late.statusCode).toBe(403);
      expect(late.json()).toEqual({ code: "link_invalid" });
      expect(new Uint8Array(late.rawPayload)).not.toEqual(FILE_BYTES);
    } finally {
      h.clock.reset();
    }
  });
});

describe("link e download refazem a autorização depois do ready (A.8-2, RF06.R3, RF29.R2)", () => {
  interface SeedOptions {
    content?: "entries" | "full";
    unitChoice?: string;
    filters?: Record<string, unknown>;
    includedSensitive?: boolean;
  }

  /** Pedido pronto com arquivo no store, com o conteúdo, a unidade e a folha escolhidos. */
  async function seedExport(user: Who, tenantId: string, options: SeedOptions = {}) {
    const id = uuidv7();
    const key = `exports/${tenantId}/${id}.csv`;
    await admin(
      `insert into exports (id, tenant_id, requested_by, unit_choice, format, content, filters, status,
         row_count, file_size, file_key, client_request_id, created_at, finished_at, included_sensitive)
       values ($1, $2, $3, $4, 'csv', $5, $6::jsonb, 'ready', 1, $7, $8, $9,
         $10::timestamptz, $10::timestamptz, $11)`,
      [
        id,
        tenantId,
        user.userId,
        options.unitChoice ?? unitChoiceOf(user),
        options.content ?? "entries",
        JSON.stringify(options.filters ?? PERIOD),
        FILE_BYTES.length,
        key,
        uuidv7(),
        START.toISOString(),
        options.includedSensitive ?? false,
      ],
    );
    await h.exports.store.put(key, FILE_BYTES);
    return id;
  }

  /** Espia o store: o arquivo não pode nem ser lido antes da autorização. */
  function spyStore() {
    const store = h.exports.store;
    const original = store.get.bind(store);
    const reads: string[] = [];
    store.get = async (key: string) => {
      reads.push(key);
      return original(key);
    };
    return {
      reads,
      restore: () => {
        store.get = original;
      },
    };
  }

  /** Gerente novo (com as permissões dadas) para não mexer nos vínculos das outras personas. */
  const newManager = (permissions: string[], unitIds = [unit1, unit2]) =>
    member(tenantA, { role: "manager", unitIds, permissions }, `${tenantA}.${unit1}`);

  const dropPermissions = (user: Who, permissions: string[]) =>
    admin("update memberships set permissions = $2::jsonb where user_id = $1 and tenant_id = $3", [
      user.userId,
      JSON.stringify(permissions),
      tenantA,
    ]);

  async function expectBlocked(user: Who, id: string) {
    const spy = spyStore();
    try {
      const link = await call(user, "POST", `/api/exports/${id}/link`);
      expect(link.statusCode, link.body).toBe(403);
      expect(link.json()).toEqual({ code: "forbidden" });
      const download = await call(user, "GET", downloadUrl(user, tenantA, id), { xContext: null });
      expect(download.statusCode, download.body).toBe(403);
      expect(download.json()).toEqual({ code: "forbidden" });
      expect(spy.reads).toEqual([]);
    } finally {
      spy.restore();
    }
  }

  async function expectDelivered(user: Who, tenantId: string, id: string) {
    const link = await call(user, "POST", `/api/exports/${id}/link`);
    expect(link.statusCode, link.body).toBe(200);
    const download = await call(user, "GET", downloadUrl(user, tenantId, id), { xContext: null });
    expect(download.statusCode, download.body).toBe(200);
    expect(new Uint8Array(download.rawPayload)).toEqual(FILE_BYTES);
  }

  it("gerente gerou com folha e perdeu VER_FOLHA: link e download dão 403 forbidden e o store não é lido", async () => {
    const manager = await newManager(["VER_FOLHA", "EXPORTAR_DADOS"]);
    const id = await seedExport(manager, tenantA, { includedSensitive: true });
    await expectDelivered(manager, tenantA, id);
    await dropPermissions(manager, ["EXPORTAR_DADOS"]);
    await expectBlocked(manager, id);
  });

  it("gerente perdeu EXPORTAR_DADOS depois do ready: 403 forbidden", async () => {
    const manager = await newManager(["EXPORTAR_DADOS"]);
    const id = await seedExport(manager, tenantA);
    await dropPermissions(manager, []);
    await expectBlocked(manager, id);
  });

  it("gerente perdeu a unidade do pedido depois do ready: 403 forbidden", async () => {
    const manager = await newManager(["EXPORTAR_DADOS"]);
    const id = await seedExport(manager, tenantA, { unitChoice: unit2 });
    await expectDelivered(manager, tenantA, id);
    await admin(
      `delete from membership_units where unit_id = $2 and membership_id in
         (select id from memberships where user_id = $1 and tenant_id = $3)`,
      [manager.userId, unit2, tenantA],
    );
    await expectBlocked(manager, id);
  });

  it("gerente perdeu a unidade dos filtros do pedido depois do ready: 403 forbidden", async () => {
    const manager = await newManager(["EXPORTAR_DADOS"]);
    const id = await seedExport(manager, tenantA, { filters: { ...PERIOD, unitIds: [unit2] } });
    await expectDelivered(manager, tenantA, id);
    await admin(
      `delete from membership_units where unit_id = $2 and membership_id in
         (select id from memberships where user_id = $1 and tenant_id = $3)`,
      [manager.userId, unit2, tenantA],
    );
    await expectBlocked(manager, id);
  });

  it("quem gerou o COMPLETO como dono e virou gerente: 403 forbidden (sem export:full)", async () => {
    const user = await member(tenantA, { role: "owner" }, `${tenantA}.all`);
    const id = await seedExport(user, tenantA, {
      content: "full",
      unitChoice: unit1,
      includedSensitive: true,
    });
    await expectDelivered(user, tenantA, id);
    await admin(
      "update memberships set role = 'manager', all_units = false, permissions = $2::jsonb where user_id = $1 and tenant_id = $3",
      [user.userId, JSON.stringify(["VER_FOLHA", "EXPORTAR_DADOS"]), tenantA],
    );
    await admin(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) select $3, tenant_id, id, $2 from memberships where user_id = $1 and tenant_id = $4",
      [user.userId, unit1, uuidv7(), tenantA],
    );
    // O contexto "todas" não vale mais para um gerente com uma unidade só.
    user.ctx = `${tenantA}.${unit1}`;
    await expectBlocked(user, id);
  });

  it("controle positivo: gerente sem folha, arquivo sem folha, continua baixando", async () => {
    const manager = await newManager(["EXPORTAR_DADOS"]);
    const id = await seedExport(manager, tenantA, { includedSensitive: false });
    await expectDelivered(manager, tenantA, id);
    // Ganhar VER_FOLHA, que nada tem a ver com o arquivo, não muda a entrega.
    await dropPermissions(manager, ["EXPORTAR_DADOS", "VER_FOLHA"]);
    await expectDelivered(manager, tenantA, id);
  });

  it("controle positivo: o dono baixa o seu COMPLETO com folha e a conta somente leitura baixa", async () => {
    const owner = await member(tenantA, { role: "owner" }, `${tenantA}.all`);
    const full = await seedExport(owner, tenantA, { content: "full", includedSensitive: true });
    await expectDelivered(owner, tenantA, full);
    const readOnlyTenant = `${who.readOnly.ctx}`.split(".")[0] as string;
    const readOnly = await seedExport(who.readOnly, readOnlyTenant);
    await expectDelivered(who.readOnly, readOnlyTenant, readOnly);
  });
});
