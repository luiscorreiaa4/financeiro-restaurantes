import type { Actor, PanelMembership } from "@app/core";
import { entryItemSchema } from "@app/core/contracts";
import type { Database, EntryRow, PanelAccessStore } from "@app/db";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { CheckSession } from "../../modules/auth/check-session";
import { decoratePanelRequest, requirePanelContext } from "../panel/panel-context";
import { entriesRoutes, requireEntryAction, toItem } from "./entries-routes";

const TENANT = "0198a000-0000-7000-8000-000000000001";
const UNIT_A = "0198a000-0000-7000-8000-0000000000a1";
const UNIT_B = "0198a000-0000-7000-8000-0000000000b2";
const USER = "0198a000-0000-7000-8000-0000000000d1";
const OTHER_USER = "0198a000-0000-7000-8000-0000000000d2";
const CTX = `${TENANT}.${UNIT_A}`;
const PERIOD = "from=2026-11-01&to=2026-11-30";

function membership(over: Partial<PanelMembership> = {}): PanelMembership {
  return {
    membershipId: "0198a000-0000-7000-8000-0000000000c1",
    tenantId: TENANT,
    tenantName: "Bistrô",
    accountStatus: "active",
    role: "owner",
    permissions: [],
    panelAccess: true,
    allUnits: false,
    unitIds: [UNIT_A],
    defaultUnitId: UNIT_A,
    preferredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

const session = {
  sessionId: "s1",
  userId: USER,
  name: "Ana",
  email: "ana@example.com",
  keepConnected: false,
  updatedAt: new Date("2026-11-10T00:00:00Z"),
};

/**
 * Banco de mentira só para a rota chegar ao leitor: a transação roda e toda consulta devolve
 * `rows`. `calls` conta as consultas, para provar que um pedido recusado não leu nada.
 */
function fakeDb(rows: unknown[] = [], fail?: Error) {
  const state = { calls: 0 };
  const tx = {
    execute: async () => {
      state.calls += 1;
      if (fail !== undefined) throw fail;
      return { rows };
    },
  };
  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, state };
}

function build(
  setup: {
    memberships?: PanelMembership[];
    rows?: unknown[];
    /** Toda consulta falha com este erro. */
    fail?: Error;
    logStream?: { write(line: string): void };
  } = {},
) {
  const checkSession: CheckSession = async () => ({ ok: true, session, setCookies: [] });
  const access: PanelAccessStore = {
    listPanelMemberships: async () => setup.memberships ?? [membership()],
  };
  const { db, state } = fakeDb(setup.rows, setup.fail);
  const app = Fastify(
    setup.logStream ? { logger: { level: "error", stream: setup.logStream } } : {},
  );
  app.register(entriesRoutes, {
    deps: {
      checkSession,
      checkEntry: async () => ({ ok: false }),
      access,
      appDb: db,
      secure: false,
      clock: { now: () => new Date("2026-11-13T12:00:00Z"), today: () => "2026-11-13" },
    },
  });
  return { app, state };
}

const get = (app: ReturnType<typeof build>["app"], url: string, xContext: string | null = CTX) =>
  app.inject({
    method: "GET",
    url,
    headers: {
      cookie: `fr_ctx=${CTX}`,
      ...(xContext === null ? {} : { "x-context": xContext }),
    },
  });

const cursorOf = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

describe("GET /api/entries e /api/entries/totals: pedido inválido", () => {
  const invalid = [
    ["sem período", ""],
    ["data que não existe", "from=2026-02-30&to=2026-03-01"],
    ["período invertido", "from=2026-11-30&to=2026-11-01"],
    ["período maior que 24 meses", "from=2024-01-01&to=2026-11-30"],
    ["limite acima de 100", `${PERIOD}&limit=101`],
    ["limite zero", `${PERIOD}&limit=0`],
    ["ordenação desconhecida", `${PERIOD}&sort=description`],
    ["sentido desconhecido", `${PERIOD}&dir=up`],
    ["unidade que não é uuid", `${PERIOD}&unitIds=abc`],
    ["tipo desconhecido", `${PERIOD}&type=transfer`],
    ["sinal desconhecido", `${PERIOD}&flags=urgente`],
    ["busca com mais de 100 caracteres", `${PERIOD}&q=${"a".repeat(101)}`],
  ] as const;

  for (const [name, query] of invalid) {
    it(`${name}: 400 invalid_request, só com o código e sem consultar o banco`, async () => {
      for (const path of ["/api/entries", "/api/entries/totals"]) {
        const { app, state } = build();
        const response = await get(app, `${path}?${query}`);
        expect(response.statusCode, path).toBe(400);
        expect(response.json(), path).toEqual({ code: "invalid_request" });
        expect(state.calls, path).toBe(0);
      }
    });
  }
});

describe("GET /api/entries: cursor (R8)", () => {
  const VALID_ID = "0198a000-0000-7000-8000-0000000000e1";
  const cursors = [
    ["ilegível", "isto-nao-e-um-cursor"],
    ["base64 de texto que não é JSON", Buffer.from("oi").toString("base64url")],
    ["de outra ordenação", cursorOf({ s: "amount", d: "desc", v: "1000", id: VALID_ID })],
    [
      "de outro sentido",
      cursorOf({ s: "created_at", d: "asc", v: "2026-11-01T10:00:00.000000Z", id: VALID_ID }),
    ],
    [
      "adulterado com SQL no valor",
      cursorOf({ s: "created_at", d: "desc", v: "now()); drop table entries;--", id: VALID_ID }),
    ],
    [
      "adulterado no id",
      cursorOf({ s: "created_at", d: "desc", v: "2026-11-01T10:00:00.000000Z", id: "x" }),
    ],
    ["maior que o limite", "a".repeat(513)],
  ] as const;

  for (const [name, cursor] of cursors) {
    it(`cursor ${name}: 400 invalid_request, nunca 500`, async () => {
      const { app } = build();
      const response = await get(app, `/api/entries?${PERIOD}&cursor=${cursor}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "invalid_request" });
    });
  }

  it("falha do banco: 500 só com o código, e o log leva só o tipo do erro", async () => {
    const lines: string[] = [];
    const { app } = build({
      logStream: { write: (line) => lines.push(line) },
      fail: new Error("select ... salario-da-maria 424242"),
    });
    for (const path of ["/api/entries", "/api/entries/totals", "/api/entries/options"]) {
      const response = await get(app, `${path}?${PERIOD}`);
      expect(response.statusCode, path).toBe(500);
      expect(response.json(), path).toEqual({ code: "internal" });
    }
    const logs = lines.join("\n");
    expect(logs).toContain("falha nos lançamentos");
    expect(logs).not.toContain("salario-da-maria");
    expect(logs).not.toContain("424242");
    expect(logs).not.toContain(CTX);
    expect(logs).not.toContain(session.email);
  });
});

describe("GET /api/entries*: guards e recorte sem banco", () => {
  it("sem X-Context: 409 context_changed nas três rotas, sem consultar o banco", async () => {
    for (const path of ["/api/entries", "/api/entries/totals", "/api/entries/options"]) {
      const { app, state } = build();
      const response = await get(app, `${path}?${PERIOD}`, null);
      expect(response.statusCode, path).toBe(409);
      expect(response.json(), path).toEqual({ code: "context_changed" });
      expect(state.calls, path).toBe(0);
    }
  });

  it("unidade fora do acesso no filtro: 403 forbidden, sem consultar o banco (R4)", async () => {
    for (const path of ["/api/entries", "/api/entries/totals"]) {
      const { app, state } = build({ memberships: [membership({ role: "manager" })] });
      const response = await get(app, `${path}?${PERIOD}&unitIds=${UNIT_A}&unitIds=${UNIT_B}`);
      expect(response.statusCode, path).toBe(403);
      expect(response.json(), path).toEqual({ code: "forbidden" });
      expect(state.calls, path).toBe(0);
    }
  });

  it("lista vazia responde items vazio e nextCursor nulo", async () => {
    const { app } = build();
    const response = await get(app, `/api/entries?${PERIOD}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  it("totais: o resultado é receitas menos despesas, calculado no servidor, e pode ser negativo", async () => {
    const { app } = build({ rows: [{ revenue_cents: "10000", expense_cents: "25050", count: 3 }] });
    const response = await get(app, `/api/entries/totals?${PERIOD}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      revenueCents: 10000,
      expenseCents: 25050,
      resultCents: -15050,
      count: 3,
      hasRestricted: false,
    });
  });
});

describe("GET /api/entries/:id e /api/entries/:id/source: sem banco", () => {
  const ENTRY_ID = "0198a000-0000-7000-8000-0000000000e1";
  const paths = (id: string) => [`/api/entries/${id}`, `/api/entries/${id}/source`];

  it("id que não é UUID: 400 invalid_request, sem consultar o banco", async () => {
    for (const id of ["abc", "123", "0198a000-0000-7000-8000-0000000000e", "1%20or%201=1"]) {
      for (const path of paths(id)) {
        const { app, state } = build();
        const response = await get(app, path);
        expect(response.statusCode, path).toBe(400);
        expect(response.json(), path).toEqual({ code: "invalid_request" });
        expect(state.calls, path).toBe(0);
      }
    }
  });

  it("lançamento que o leitor não devolve: 404 not_found só com o código, e nada mais é lido", async () => {
    for (const path of paths(ENTRY_ID)) {
      const { app, state } = build();
      const response = await get(app, path);
      expect(response.statusCode, path).toBe(404);
      expect(response.json(), path).toEqual({ code: "not_found" });
      // Só o `set_config` do tenant e a consulta do recorte: histórico, origem e nomes não
      // são lidos sem o lançamento.
      expect(state.calls, path).toBe(2);
    }
  });

  it("sem X-Context: 409 context_changed, sem consultar o banco", async () => {
    for (const path of paths(ENTRY_ID)) {
      const { app, state } = build();
      const response = await get(app, path, null);
      expect(response.statusCode, path).toBe(409);
      expect(response.json(), path).toEqual({ code: "context_changed" });
      expect(state.calls, path).toBe(0);
    }
  });

  it("falha do banco: 500 só com o código", async () => {
    for (const path of paths(ENTRY_ID)) {
      const { app } = build({ fail: new Error("select ... salario-da-maria") });
      const response = await get(app, path);
      expect(response.statusCode, path).toBe(500);
      expect(response.json(), path).toEqual({ code: "internal" });
    }
  });
});

describe("requireEntryAction", () => {
  function guarded(role: PanelMembership["role"]) {
    const app = Fastify();
    app.decorateRequest("session", null);
    decoratePanelRequest(app);
    const context = requirePanelContext({
      checkSession: async () => ({ ok: true, session, setCookies: [] }),
      access: { listPanelMemberships: async () => [membership({ role })] },
      secure: false,
    });
    for (const action of ["entry:view", "entry:edit", "entry:delete", "entry:restore"] as const) {
      app.get(
        `/${action.replace(":", "-")}`,
        { preHandler: [context, requireEntryAction(action)] },
        async () => ({
          ok: true,
        }),
      );
    }
    return app;
  }
  const statusOf = async (role: PanelMembership["role"], action: string) =>
    (await get(guarded(role), `/${action.replace(":", "-")}`)).statusCode;

  it("lançador passa nas ações que tem sobre os próprios lançamentos", async () => {
    for (const action of ["entry:view", "entry:edit", "entry:delete", "entry:restore"]) {
      expect(await statusOf("staff", action), action).toBe(200);
    }
  });

  it("contador lê e é barrado com 403 forbidden em toda escrita", async () => {
    expect(await statusOf("accountant", "entry:view")).toBe(200);
    for (const action of ["entry:edit", "entry:delete", "entry:restore"]) {
      const response = await get(guarded("accountant"), `/${action.replace(":", "-")}`);
      expect(response.statusCode, action).toBe(403);
      expect(response.json(), action).toEqual({ code: "forbidden" });
    }
  });

  it("dono e gerente passam em todas", async () => {
    for (const role of ["owner", "manager"] as const) {
      for (const action of ["entry:view", "entry:edit", "entry:delete", "entry:restore"]) {
        expect(await statusOf(role, action), `${role} ${action}`).toBe(200);
      }
    }
  });
});

describe("toItem", () => {
  const row: EntryRow = {
    id: "0198a000-0000-7000-8000-0000000000e1",
    version: 2,
    type: "expense",
    occurredOn: "2026-11-10",
    paidOn: "2026-11-12",
    description: "Carne",
    quantity: 3.5,
    quantityUnit: "kg",
    orders: null,
    amountCents: 12345,
    feeCents: 0,
    netCents: 12345,
    category: { id: "0198a000-0000-7000-8000-0000000000f1", name: "Insumos" },
    supplier: null,
    paymentMethod: null,
    salesChannel: null,
    unit: { id: UNIT_A, name: "Matriz" },
    createdBy: { id: USER, name: "Ana" },
    originChannel: "whatsapp",
    flags: ["old_date"],
    createdAt: "2026-11-10T13:00:00.123456Z",
    categoryIsSensitive: false,
    createdById: USER,
    deletedAt: null,
  };
  const actor = (over: Partial<Actor> = {}): Actor => ({
    role: "owner",
    permissions: [],
    units: "all",
    panelAccess: true,
    ...over,
  });
  const actions = (item: ReturnType<typeof toItem>) => ({
    canEdit: item.canEdit,
    canDelete: item.canDelete,
    canRestore: item.canRestore,
  });

  it("entrega exatamente os campos do contrato, sem os campos internos do leitor", () => {
    const item = toItem(row, actor(), USER, true);
    expect(entryItemSchema.strict().safeParse(item).success).toBe(true);
    expect(item).not.toHaveProperty("categoryIsSensitive");
    expect(item).not.toHaveProperty("createdById");
    expect(item).not.toHaveProperty("deletedAt");
    expect(item.amountCents).toBe(12345);
  });

  it("dono edita e exclui; restaurar só cabe na lixeira", () => {
    expect(actions(toItem(row, actor(), USER, true))).toEqual({
      canEdit: true,
      canDelete: true,
      canRestore: false,
    });
    const deleted = { ...row, deletedAt: "2026-11-11T10:00:00.000000Z" };
    expect(actions(toItem(deleted, actor(), USER, true))).toEqual({
      canEdit: false,
      canDelete: false,
      canRestore: true,
    });
  });

  it("conta que não aceita gravação: nenhuma ação, nem para o dono", () => {
    expect(actions(toItem(row, actor(), USER, false))).toEqual({
      canEdit: false,
      canDelete: false,
      canRestore: false,
    });
    const deleted = { ...row, deletedAt: "2026-11-11T10:00:00.000000Z" };
    expect(toItem(deleted, actor(), USER, false).canRestore).toBe(false);
  });

  it("contador não altera nada", () => {
    expect(actions(toItem(row, actor({ role: "accountant" }), OTHER_USER, true))).toEqual({
      canEdit: false,
      canDelete: false,
      canRestore: false,
    });
  });

  it("lançador altera o próprio e não o de outra pessoa", () => {
    const staff = actor({ role: "staff", units: [UNIT_A] });
    expect(toItem(row, staff, USER, true).canEdit).toBe(true);
    expect(actions(toItem(row, staff, OTHER_USER, true))).toEqual({
      canEdit: false,
      canDelete: false,
      canRestore: false,
    });
  });

  it("gerente não altera lançamento de unidade fora do seu acesso", () => {
    const manager = actor({ role: "manager", units: [UNIT_B] });
    expect(toItem(row, manager, USER, true).canEdit).toBe(false);
    expect(toItem(row, actor({ role: "manager", units: [UNIT_A] }), USER, true).canEdit).toBe(true);
  });

  it("categoria não resolvida (nula e marcada sensível) é tratada como folha: só quem vê folha altera", () => {
    const unresolved = { ...row, category: null, categoryIsSensitive: true };
    const manager = actor({ role: "manager", units: [UNIT_A] });
    expect(actions(toItem(unresolved, manager, USER, true))).toEqual({
      canEdit: false,
      canDelete: false,
      canRestore: false,
    });
    const withPayroll = actor({ role: "manager", units: [UNIT_A], permissions: ["VER_FOLHA"] });
    expect(toItem(unresolved, withPayroll, USER, true).canEdit).toBe(true);
    expect(toItem(unresolved, actor(), USER, true).canEdit).toBe(true);
  });
});
