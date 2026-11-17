import type { PanelMembership } from "@app/core";
import type { Database, PanelAccessStore } from "@app/db";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { CheckSession } from "../../modules/auth/check-session";
import { reportsRoutes } from "./reports-routes";

const TENANT = "0198a000-0000-7000-8000-000000000001";
const UNIT_A = "0198a000-0000-7000-8000-0000000000a1";
const UNIT_B = "0198a000-0000-7000-8000-0000000000b2";
const USER = "0198a000-0000-7000-8000-0000000000d1";
const CTX = `${TENANT}.${UNIT_A}`;
const PERIOD = "from=2026-10-01&to=2026-10-31";

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

/** Soma crua de um período: bruta 1000,00, sem taxa, operacionais 400,00 (folha 100,00). */
const SUMS_ROW = {
  gross: "100000",
  with_orders: "100000",
  orders: "50",
  fees: "0",
  deduction: "0",
  operating: "40000",
  cmv: "20000",
  payroll: "10000",
  fixed: "10000",
  investments: "5000",
  entry_count: "4",
};

/** Toda consulta devolve `rows`; `calls` conta as consultas e `txs` as transações. */
function build(setup: { memberships?: PanelMembership[]; rows?: unknown[] } = {}) {
  const state = { calls: 0, txs: 0 };
  const tx = {
    execute: async () => {
      state.calls += 1;
      return { rows: setup.rows ?? [SUMS_ROW] };
    },
  };
  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      state.txs += 1;
      return fn(tx);
    },
  } as unknown as Database;
  const checkSession: CheckSession = async () => ({ ok: true, session, setCookies: [] });
  const access: PanelAccessStore = {
    listPanelMemberships: async () => setup.memberships ?? [membership()],
  };
  const app = Fastify();
  app.register(reportsRoutes, {
    deps: {
      checkSession,
      checkEntry: async () => ({ ok: false }),
      access,
      appDb: db,
      secure: false,
    },
  });
  return { app, state };
}

const get = (app: ReturnType<typeof build>["app"], url: string, xContext: string | null = CTX) =>
  app.inject({
    method: "GET",
    url,
    headers: { cookie: `fr_ctx=${CTX}`, ...(xContext === null ? {} : { "x-context": xContext }) },
  });

describe("GET /api/reports/summary", () => {
  it("uma transação só, com período atual e anterior", async () => {
    const { app, state } = build();
    const response = await get(app, `/api/reports/summary?${PERIOD}`);
    expect(response.statusCode).toBe(200);
    expect(state.txs).toBe(1);
    // Uma consulta do `set local` do tenant mais duas somas.
    expect(state.calls).toBe(3);
    expect(response.json().comparison).toEqual({
      kind: "previous_period",
      period: { from: "2026-08-31", to: "2026-09-30" },
    });
  });

  it("compare=none: sem comparação, previous e variação nulos, uma soma só", async () => {
    const { app, state } = build();
    const response = await get(app, `/api/reports/summary?${PERIOD}&compare=none`);
    expect(response.statusCode).toBe(200);
    expect(state.calls).toBe(2);
    const body = response.json();
    expect(body.comparison).toBeNull();
    expect(body.indicators.grossRevenue).toEqual({
      value: 100000,
      previous: null,
      changePermille: null,
      direction: null,
    });
  });

  it("formata: dinheiro e permille nas unidades certas, nunca estimatedTax", async () => {
    const { app } = build();
    const body = (await get(app, `/api/reports/summary?${PERIOD}`)).json();
    expect(body.isEmpty).toBe(false);
    expect(body.indicators.result.value).toBe(60000);
    expect(body.indicators.margin.value).toBe(600);
    // Mesmos dados nos dois períodos: variação zero.
    expect(body.indicators.margin).toMatchObject({ changePermille: 0, direction: "flat" });
    expect(body.indicators.result).toMatchObject({ changePermille: 0, direction: "flat" });
    expect("estimatedTax" in body).toBe(false);
  });

  it("entryCount 0 vira isEmpty", async () => {
    const { app } = build({ rows: [{ ...SUMS_ROW, entry_count: "0" }] });
    expect((await get(app, `/api/reports/summary?${PERIOD}`)).json().isEmpty).toBe(true);
  });

  it("payrollRatio só para quem vê a folha, como chave ausente", async () => {
    const owner = await get(build().app, `/api/reports/summary?${PERIOD}`);
    expect("payrollRatio" in owner.json().indicators).toBe(true);
    const noPayroll = build({ memberships: [membership({ role: "manager" })] });
    const manager = await get(noPayroll.app, `/api/reports/summary?${PERIOD}`);
    expect(manager.statusCode).toBe(200);
    expect("payrollRatio" in manager.json().indicators).toBe(false);
    const withPayroll = build({
      memberships: [membership({ role: "manager", permissions: ["VER_FOLHA"] })],
    });
    const seen = await get(withPayroll.app, `/api/reports/summary?${PERIOD}`);
    expect("payrollRatio" in seen.json().indicators).toBe(true);
  });

  it.each([
    ["período invertido", "from=2026-10-31&to=2026-10-01"],
    ["mais de 24 meses", "from=2024-01-01&to=2026-10-31"],
    ["data inválida", "from=2026-02-30&to=2026-10-31"],
    ["sem período", ""],
    ["unidade que não é UUID", `${PERIOD}&unitIds=abc`],
    ["comparação desconhecida", `${PERIOD}&compare=x`],
  ])("query inválida (%s): 400 invalid_request, sem ler", async (_name, query) => {
    const { app, state } = build();
    const response = await get(app, `/api/reports/summary?${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "invalid_request" });
    expect(state.calls).toBe(0);
  });

  it("unidade fora do acesso: 403 forbidden, sem ler", async () => {
    const { app, state } = build();
    const response = await get(app, `/api/reports/summary?${PERIOD}&unitIds=${UNIT_B}`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
    expect(state.calls).toBe(0);
  });

  it("lançador: 403 forbidden", async () => {
    const { app, state } = build({ memberships: [membership({ role: "staff" })] });
    const response = await get(app, `/api/reports/summary?${PERIOD}`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
    expect(state.calls).toBe(0);
  });

  it("X-Context ausente: 409 context_changed", async () => {
    const response = await get(build().app, `/api/reports/summary?${PERIOD}`, null);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "context_changed" });
  });
});

describe("GET /api/reports/monthly", () => {
  it("completa os seis meses com zero e calcula o resultado", async () => {
    const { app, state } = build({
      rows: [
        { month: "2026-08", gross: "1000", expense: "400" },
        { month: "2026-10", gross: "500", expense: "900" },
      ],
    });
    const response = await get(app, "/api/reports/monthly?to=2026-10-31");
    expect(response.statusCode).toBe(200);
    expect(state.txs).toBe(1);
    expect(response.json().months).toEqual([
      { month: "2026-05", revenueCents: 0, expenseCents: 0, resultCents: 0 },
      { month: "2026-06", revenueCents: 0, expenseCents: 0, resultCents: 0 },
      { month: "2026-07", revenueCents: 0, expenseCents: 0, resultCents: 0 },
      { month: "2026-08", revenueCents: 1000, expenseCents: 400, resultCents: 600 },
      { month: "2026-09", revenueCents: 0, expenseCents: 0, resultCents: 0 },
      { month: "2026-10", revenueCents: 500, expenseCents: 900, resultCents: -400 },
    ]);
  });

  it("data inválida: 400; unidade fora do acesso: 403", async () => {
    const { app } = build();
    expect((await get(app, "/api/reports/monthly?to=x")).statusCode).toBe(400);
    expect(
      (await get(app, `/api/reports/monthly?to=2026-10-31&unitIds=${UNIT_B}`)).statusCode,
    ).toBe(403);
  });
});

describe("GET /api/reports/breakdown", () => {
  it("categoria: rótulos fixos, total, participação e ordem com desempate pela chave", async () => {
    const { app } = build({
      rows: [
        { key: "restricted", amount: "3000" },
        { key: "fees", amount: "3000" },
        { key: "deducoes", amount: "1000" },
        { key: "uncategorized", amount: "500" },
        { key: "cmv", amount: "5000" },
        { key: "constructor", amount: "500" },
      ],
    });
    const body = (await get(app, `/api/reports/breakdown?${PERIOD}&by=category`)).json();
    expect(body.totalCents).toBe(13000);
    expect(body.items.map((item: { key: string }) => item.key)).toEqual([
      "cmv",
      "fees",
      "restricted",
      "deducoes",
      "constructor",
      "uncategorized",
    ]);
    expect(body.items.map((item: { label: string }) => item.label)).toEqual([
      "CMV",
      "Taxas e comissões",
      "Pessoal (restrito)",
      "Deduções",
      "Outros",
      "Sem categoria",
    ]);
    expect(body.items[0].sharePermille).toBe(385);
  });

  it("canal: nome do cadastro, nulo vira none e Não informado; nome nulo com chave também", async () => {
    const { app } = build({
      rows: [
        { key: "c1", name: "Salão", amount: "700" },
        { key: null, name: null, amount: "200" },
        { key: "c2", name: null, amount: "100" },
      ],
    });
    const body = (await get(app, `/api/reports/breakdown?${PERIOD}&by=sales_channel`)).json();
    expect(body.items).toEqual([
      { key: "c1", label: "Salão", amountCents: 700, sharePermille: 700 },
      { key: "none", label: "Não informado", amountCents: 200, sharePermille: 200 },
      { key: "c2", label: "Não informado", amountCents: 100, sharePermille: 100 },
    ]);
  });

  it("forma de pagamento: nula vira Não informada; total zero deixa a participação nula", async () => {
    const { app } = build({ rows: [{ key: null, name: null, amount: "0" }] });
    const body = (await get(app, `/api/reports/breakdown?${PERIOD}&by=payment_method`)).json();
    expect(body.items).toEqual([
      { key: "none", label: "Não informada", amountCents: 0, sharePermille: null },
    ]);
  });

  it("dimensão desconhecida e período invertido: 400", async () => {
    const { app } = build();
    expect((await get(app, `/api/reports/breakdown?${PERIOD}&by=x`)).statusCode).toBe(400);
    const inverted = await get(
      app,
      "/api/reports/breakdown?from=2026-10-31&to=2026-10-01&by=category",
    );
    expect(inverted.statusCode).toBe(400);
  });
});

describe("limites e ordem dos guards", () => {
  const unitIds = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `unitIds=0198a000-0000-7000-8000-${String(i).padStart(12, "0")}`,
    ).join("&");

  it("mais de 100 unitIds: 400 invalid_request, sem ler", async () => {
    const { app, state } = build();
    for (const path of [
      `/api/reports/summary?${PERIOD}`,
      `/api/reports/monthly?to=2026-10-31`,
      `/api/reports/breakdown?${PERIOD}&by=category`,
    ]) {
      const response = await get(app, `${path}&${unitIds(101)}`);
      expect(response.statusCode, path).toBe(400);
      expect(response.json(), path).toEqual({ code: "invalid_request" });
    }
    expect(state.calls).toBe(0);
  });

  it("lançador com query inválida: 403 forbidden (o guard roda antes do parse)", async () => {
    const { app, state } = build({ memberships: [membership({ role: "staff" })] });
    for (const path of [
      "/api/reports/summary?from=2026-10-31&to=2026-10-01",
      "/api/reports/monthly?to=x",
      "/api/reports/breakdown?from=2026-10-31&to=2026-10-01&by=x",
    ]) {
      const response = await get(app, path);
      expect(response.statusCode, path).toBe(403);
      expect(response.json(), path).toEqual({ code: "forbidden" });
    }
    expect(state.calls).toBe(0);
  });
});
