import { computeIndicators, type PeriodSums } from "@app/core";
import {
  type BreakdownReport,
  breakdownReportSchema,
  type DashboardSummary,
  dashboardSummarySchema,
  type MonthlyReport,
  monthlyReportSchema,
} from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DashboardReference,
  seedDashboardReference,
} from "../../../packages/db/test/report-fixtures";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";

// Rotas de relatório do dashboard (F4, RF27) sobre o seed de referência do T6/T7. A matriz
// papel × rota fica em `entries-panel.int.test.ts` (ROUTE_MATRIX); aqui ficam os critérios de
// aceite, o isolamento entre empresas e o recorte por unidade.

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";
const OCTOBER = "from=2026-10-01&to=2026-10-31";

let h: AuthHarness;
let ref: DashboardReference;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;
const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);

interface Who {
  session: string;
  ctx: string;
}
let owner: Who;
let manager: Who; // VER_FOLHA, só a unidade A1, seletor na A1
let managerAll: Who; // VER_FOLHA, só a unidade A1, seletor em "todas"
let managerNoPayroll: Who; // sem VER_FOLHA, só a unidade A1
let accountant: Who;
let ownerB: Who;

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

async function open(
  user: { userId: string; email: string },
  tenantId: string,
  unit: string,
): Promise<Who> {
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email: user.email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return { session: h.sessionCookie(response), ctx: `${tenantId}.${unit}` };
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

/** A resposta tem de ser idêntica ao contrato: nada além do que ele declara. */
async function summaryOf(who: Who, query: string): Promise<DashboardSummary> {
  const response = await get(who, `/api/reports/summary?${query}`);
  expect(response.statusCode).toBe(200);
  const parsed = dashboardSummarySchema.parse(response.json());
  expect(response.json()).toEqual(parsed);
  return parsed;
}

async function breakdownOf(who: Who, query: string): Promise<BreakdownReport> {
  const response = await get(who, `/api/reports/breakdown?${query}`);
  expect(response.statusCode).toBe(200);
  const parsed = breakdownReportSchema.parse(response.json());
  expect(response.json()).toEqual(parsed);
  return parsed;
}

async function monthlyOf(who: Who, query: string): Promise<MonthlyReport> {
  const response = await get(who, `/api/reports/monthly?${query}`);
  expect(response.statusCode).toBe(200);
  const parsed = monthlyReportSchema.parse(response.json());
  expect(response.json()).toEqual(parsed);
  return parsed;
}

beforeAll(async () => {
  h = await startAuthHarness();
  ref = await seedDashboardReference(h.db.admin);
  const { tenantA, tenantB, unitA1 } = ref;

  const ownerUser = await addUser();
  await addMembership(ownerUser.userId, tenantA, { role: "owner" });
  const managerUser = await addUser();
  await addMembership(managerUser.userId, tenantA, {
    role: "manager",
    unitIds: [unitA1],
    permissions: ["VER_FOLHA"],
  });
  const noPayrollUser = await addUser();
  await addMembership(noPayrollUser.userId, tenantA, { role: "manager", unitIds: [unitA1] });
  const accountantUser = await addUser();
  await addMembership(accountantUser.userId, tenantA, { role: "accountant" });
  const bOwnerUser = await addUser();
  await addMembership(bOwnerUser.userId, tenantB, { role: "owner" });

  owner = await open(ownerUser, tenantA, "all");
  manager = await open(managerUser, tenantA, unitA1);
  managerAll = await open(managerUser, tenantA, "all");
  managerNoPayroll = await open(noPayrollUser, tenantA, unitA1);
  accountant = await open(accountantUser, tenantA, "all");
  ownerB = await open(bOwnerUser, tenantB, "all");
});

afterAll(async () => {
  await h?.stop();
});

/** Os indicadores esperados de `computeIndicators(sums)` no formato da rota, sem variação. */
function expectedValues(sums: PeriodSums) {
  const i = computeIndicators(sums);
  return {
    grossRevenue: i.grossRevenueCents,
    deductions: i.deductionsCents,
    netRevenue: i.netRevenueCents,
    operatingExpenses: i.operatingExpensesCents,
    result: i.resultCents,
    investments: i.investmentsCents,
    margin: i.marginPermille,
    cmvRatio: i.cmvRatioPermille,
    payrollRatio: i.payrollRatioPermille,
    averageTicket: i.averageTicketCents,
    breakEven: i.breakEvenCents,
  };
}

describe("CA01: o summary bate com as contas do domínio", () => {
  it("outubro da unidade A1: cada indicador é o de computeIndicators(expected)", async () => {
    const summary = await summaryOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&compare=none`);
    const values = Object.fromEntries(
      Object.entries(summary.indicators).map(([name, item]) => [name, item.value]),
    );
    expect(values).toEqual(expectedValues(ref.expected));
    expect(summary.ticketCoveragePermille).toBe(
      computeIndicators(ref.expected).ticketCoveragePermille,
    );
    expect(summary.isEmpty).toBe(false);
    expect(summary.comparison).toBeNull();
    expect(summary.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    // Contas à mão (seed): bruta 1150000, deduções 37500 + 20000, resultado 401500.
    expect(summary.indicators.result.value).toBe(401_500);
    expect(summary.indicators.deductions.value).toBe(57_500);
    // Sem comparação: nada de valor anterior nem variação.
    expect(summary.indicators.grossRevenue).toEqual({
      value: 1_150_000,
      previous: null,
      changePermille: null,
      direction: null,
    });
  });

  it("com comparação, o período anterior sai da mesma transação e traz a variação", async () => {
    const summary = await summaryOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}`);
    expect(summary.comparison).toEqual({
      kind: "previous_period",
      // Mesmo número de dias (31), imediatamente antes.
      period: { from: "2026-08-31", to: "2026-09-30" },
    });
    // Setembro em A1: receita 10000.
    expect(summary.indicators.grossRevenue.previous).toBe(10_000);
    expect(summary.indicators.grossRevenue.direction).toBe("up");
  });

  it("a série mensal completa seis meses e fecha com o resultado do summary", async () => {
    const monthly = await monthlyOf(owner, `to=2026-10-31&unitIds=${ref.unitA1}`);
    expect(monthly.months.map((month) => month.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    const october = monthly.months[5];
    expect(october).toEqual({
      month: "2026-10",
      revenueCents: 1_150_000,
      expenseCents: 37_500 + 20_000 + 691_000,
      resultCents: 401_500,
    });
    expect(monthly.months[0]).toEqual({
      month: "2026-05",
      revenueCents: 0,
      expenseCents: 0,
      resultCents: 0,
    });
  });
});

describe("CA03: investimento fica fora do resultado", () => {
  it("aparece em investments e não muda o resultado", async () => {
    const summary = await summaryOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&compare=none`);
    expect(summary.indicators.investments.value).toBe(320_000);
    const { grossRevenue, deductions, operatingExpenses, result } = summary.indicators;
    expect(result.value).toBe(
      (grossRevenue.value as number) -
        (deductions.value as number) -
        (operatingExpenses.value as number),
    );
    const categories = await breakdownOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&by=category`);
    expect(categories.items.some((item) => item.label === "Reforma")).toBe(false);
  });
});

describe("CA04: período sem receita", () => {
  it("margem, CMV e ticket nulos, status 200", async () => {
    // 02 a 04/10: dedução, investimento e folha, nenhuma receita.
    const summary = await summaryOf(
      owner,
      `from=2026-10-02&to=2026-10-04&unitIds=${ref.unitA1}&compare=none`,
    );
    expect(summary.isEmpty).toBe(false);
    expect(summary.indicators.margin.value).toBeNull();
    expect(summary.indicators.cmvRatio.value).toBeNull();
    expect(summary.indicators.averageTicket.value).toBeNull();
    expect(summary.indicators.breakEven.value).toBeNull();
    expect(summary.indicators.grossRevenue.value).toBe(0);
  });

  it("período sem nenhum lançamento: isEmpty", async () => {
    const summary = await summaryOf(owner, "from=2025-01-01&to=2025-01-31");
    expect(summary.isEmpty).toBe(true);
  });
});

describe("CA02 e Review Focus 5: quem não vê a folha", () => {
  it("o summary não tem a chave payrollRatio; o gerente com VER_FOLHA e o contador têm", async () => {
    const query = `${OCTOBER}&unitIds=${ref.unitA1}`;
    expect("payrollRatio" in (await summaryOf(managerNoPayroll, query)).indicators).toBe(false);
    const raw = (await get(managerNoPayroll, `/api/reports/summary?${query}`)).body;
    expect(raw).not.toContain("payrollRatio");
    expect("payrollRatio" in (await summaryOf(manager, query)).indicators).toBe(true);
    expect("payrollRatio" in (await summaryOf(accountant, query)).indicators).toBe(true);
    expect("payrollRatio" in (await summaryOf(owner, query)).indicators).toBe(true);
  });

  it("os totais incluem a folha para todos (DD-41)", async () => {
    const query = `${OCTOBER}&unitIds=${ref.unitA1}&compare=none`;
    const restricted = await summaryOf(managerNoPayroll, query);
    const full = await summaryOf(owner, query);
    expect(restricted.indicators.operatingExpenses).toEqual(full.indicators.operatingExpenses);
    expect(restricted.indicators.result).toEqual(full.indicators.result);
  });

  it("o breakdown de categoria vira Pessoal (restrito), sem nome de categoria sensível", async () => {
    for (const month of [OCTOBER, "from=2026-09-01&to=2026-09-30"]) {
      const query = `${month}&unitIds=${ref.unitA1}&by=category`;
      const response = await get(managerNoPayroll, `/api/reports/breakdown?${query}`);
      expect(response.statusCode).toBe(200);
      const labels = (response.json() as BreakdownReport).items.map((item) => item.label);
      expect(labels, month).not.toContain("Pessoal");
      for (const name of ["Folha de pagamento", "Taxa sensível", "Categoria do outro tenant"]) {
        expect(response.body, `${month} ${name}`).not.toContain(name);
      }
      if (month === OCTOBER) expect(labels).toContain("Pessoal (restrito)");
    }
    const october = await breakdownOf(
      managerNoPayroll,
      `${OCTOBER}&unitIds=${ref.unitA1}&by=category`,
    );
    expect(october.items.find((item) => item.key === "restricted")?.amountCents).toBe(250_000);
  });

  it("Review Focus 1: categoria que a junção não traz cai em restrito para quem não vê a folha", async () => {
    // Setembro/A1: despesa de 4000 com categoria de outro tenant (corrompida de propósito).
    const query = "from=2026-09-01&to=2026-09-30";
    const hidden = await breakdownOf(
      managerNoPayroll,
      `${query}&unitIds=${ref.unitA1}&by=category`,
    );
    expect(hidden.items.find((item) => item.key === "restricted")?.amountCents).toBe(4_000);
    const seen = await breakdownOf(owner, `${query}&unitIds=${ref.unitA1}&by=category`);
    expect(seen.items.some((item) => item.key === "restricted")).toBe(false);
    // Quem vê a folha lê o balde "Sem categoria", não o restrito.
    expect(seen.items.find((item) => item.key === "uncategorized")?.amountCents).toBe(4_000);
  });

  it("quem vê a folha lê o grupo Pessoal", async () => {
    const seen = await breakdownOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&by=category`);
    expect(seen.items.find((item) => item.label === "Pessoal")?.amountCents).toBe(250_000);
    expect(seen.items.some((item) => item.label === "Pessoal (restrito)")).toBe(false);
  });

  it("canal e forma de pagamento: nulo vira Não informada, e a soma bate com a receita", async () => {
    const payments = await breakdownOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&by=payment_method`);
    expect(payments.items).toEqual([
      { key: expect.any(String), label: "Pix", amountCents: 1_000_000, sharePermille: 870 },
      { key: "none", label: "Não informada", amountCents: 150_000, sharePermille: 130 },
    ]);
    expect(payments.totalCents).toBe(1_150_000);
    const channels = await breakdownOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&by=sales_channel`);
    expect(channels.items).toHaveLength(1);
    expect(channels.items[0]).toMatchObject({ label: "Salão", sharePermille: 1000 });
  });
});

describe("CA08: imposto estimado nunca sai na F4", () => {
  it("mesmo com a estimativa ligada para a empresa, nenhuma resposta tem estimatedTax", async () => {
    await admin(
      `insert into tax_settings (id, tenant_id, valid_from, enabled, regime)
       values ($1, $2, '2026-01-01', true, 'simples_nacional')`,
      [uuidv7(), ref.tenantA],
    );
    const urls = [
      `/api/reports/summary?${OCTOBER}`,
      "/api/reports/monthly?to=2026-10-31",
      `/api/reports/breakdown?${OCTOBER}&by=category`,
    ];
    for (const who of [owner, manager, accountant]) {
      for (const url of urls) {
        const response = await get(who, url);
        expect(response.statusCode, url).toBe(200);
        expect(response.body, url).not.toContain("estimatedTax");
      }
    }
  });
});

describe("Isolamento entre empresas (RNF02)", () => {
  it("o summary da empresa A não muda com lançamentos da empresa B", async () => {
    const before = await summaryOf(owner, OCTOBER);
    // Só a A: A1 (1150000) + A2 (50000), sem os 99999 da B.
    expect(before.indicators.grossRevenue.value).toBe(1_200_000);
    const [unit] = (await admin("select id from units where tenant_id = $1", [ref.tenantB])).rows;
    const [user] = (await admin("select id from users order by id limit 1")).rows;
    const [channel] = (
      await admin("select id from sales_channels where tenant_id = $1", [ref.tenantB])
    ).rows;
    await admin(
      `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
         amount_cents, net_cents, sales_channel_id, created_by)
       values ($1, $2, $3, 'revenue', '2026-10-12', '2026-10-12', 'B', 777777, 777777, $4, $5)`,
      [uuidv7(), ref.tenantB, unit.id, channel.id, user.id],
    );
    expect(await summaryOf(owner, OCTOBER)).toEqual(before);
    const b = await summaryOf(ownerB, OCTOBER);
    expect(b.indicators.grossRevenue.value).toBe(99_999 + 777_777);
  });

  it("unidade da empresa B em unitIds: o dono (todas as unidades) recebe zero, nunca o dado da B (RLS)", async () => {
    const [unit] = (await admin("select id from units where tenant_id = $1", [ref.tenantB])).rows;
    const summary = await summaryOf(owner, `${OCTOBER}&unitIds=${unit.id}&compare=none`);
    expect(summary.isEmpty).toBe(true);
    expect(summary.indicators.grossRevenue.value).toBe(0);
    // Quem tem unidades listadas recebe 403 para unidade de fora (teste de recorte abaixo).
    const manager403 = await get(manager, `/api/reports/summary?${OCTOBER}&unitIds=${unit.id}`);
    expect(manager403.statusCode).toBe(403);
  });
});

describe("Recorte por unidade (RF06.R5)", () => {
  it("Review Focus 4: gerente de uma unidade, sem unitIds, soma só a unidade dele e nunca a A2", async () => {
    const summary = await summaryOf(manager, `${OCTOBER}&compare=none`);
    expect(summary.indicators.grossRevenue.value).toBe(1_150_000);
    const monthly = await monthlyOf(manager, "to=2026-10-31");
    expect(monthly.months[5]?.revenueCents).toBe(1_150_000);
    const categories = await breakdownOf(manager, `${OCTOBER}&by=category`);
    // A2 tem insumos de 44000: o CMV de A1 é 309000 sem ele.
    expect(categories.items.find((item) => item.label === "CMV")?.amountCents).toBe(309_000);
  });

  it("Review Focus 4: o seletor em todas não existe para quem tem uma unidade só (context_invalid), sem dado", async () => {
    const response = await get(managerAll, `/api/reports/summary?${OCTOBER}`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "context_invalid" });
  });

  it("unidade fora do acesso em unitIds: 403 forbidden nas três rotas", async () => {
    const outside = `unitIds=${ref.unitA2}`;
    for (const url of [
      `/api/reports/summary?${OCTOBER}&${outside}`,
      `/api/reports/monthly?to=2026-10-31&${outside}`,
      `/api/reports/breakdown?${OCTOBER}&${outside}&by=category`,
    ]) {
      const response = await get(manager, url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json(), url).toEqual({ code: "forbidden" });
    }
  });

  it("dono pode escolher uma unidade e a lista de unidades prevalece sobre o seletor", async () => {
    const summary = await summaryOf(owner, `${OCTOBER}&unitIds=${ref.unitA2}&compare=none`);
    expect(summary.indicators.grossRevenue.value).toBe(50_000);
  });
});

describe("Query inválida", () => {
  it("período invertido: 400 invalid_request, sem dado", async () => {
    for (const url of [
      "/api/reports/summary?from=2026-10-31&to=2026-10-01",
      "/api/reports/breakdown?from=2026-10-31&to=2026-10-01&by=category",
      "/api/reports/summary?from=2024-01-01&to=2026-10-31",
      "/api/reports/monthly?to=2026-13-01",
    ]) {
      const response = await get(owner, url);
      expect(response.statusCode, url).toBe(400);
      expect(response.json(), url).toEqual({ code: "invalid_request" });
    }
  });
});

describe("unitIds repetido", () => {
  it("a mesma unidade duas vezes dá 200 e o mesmo resultado que uma", async () => {
    const once = await summaryOf(owner, `${OCTOBER}&unitIds=${ref.unitA1}&compare=none`);
    const twice = await summaryOf(
      owner,
      `${OCTOBER}&unitIds=${ref.unitA1}&unitIds=${ref.unitA1}&compare=none`,
    );
    expect(twice).toEqual(once);
    expect(twice.indicators.grossRevenue.value).toBe(1_150_000);
  });
});
