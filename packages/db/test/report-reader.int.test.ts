import { computeIndicators, type PeriodSums, type ReportScope } from "@app/core";
import type { BreakdownDimension, Period } from "@app/core/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, createPool, type Database, withTenant } from "../src/client";
import { reportReader } from "../src/report-reader";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { type DashboardReference, seedDashboardReference } from "./report-fixtures";

let db: TestDatabase;
let appPool: ReturnType<typeof createPool>;
let appDb: Database;
let ref: DashboardReference;

const OCTOBER: Period = { from: "2026-10-01", to: "2026-10-31" };
const PAYROLL: Pick<ReportScope, "canSeePayroll"> = { canSeePayroll: true };

function sums(tenantId: string, unitIds: ReportScope["unitIds"], period = OCTOBER) {
  return withTenant(appDb, tenantId, (tx) =>
    reportReader.periodSums(tx, { unitIds, ...PAYROLL }, period),
  );
}

/** Uma consulta independente, escrita à mão, pela conexão admin e com tenant_id explícito. */
async function scalar(sql: string, params: unknown[]): Promise<number> {
  const r = await db.admin.query<{ v: string }>(sql, params);
  return Number(r.rows[0]?.v);
}

beforeAll(async () => {
  db = await startTestDatabase();
  appPool = createPool(db.urls.app);
  appDb = createDatabase(appPool);
  ref = await seedDashboardReference(db.admin);
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await db?.stop();
});

describe("reportReader.periodSums", () => {
  it("CA01: bate com os números feitos à mão", async () => {
    expect(await sums(ref.tenantA, [ref.unitA1])).toEqual(ref.expected);
  });

  it("CA01: cada campo bate com uma consulta SQL independente", async () => {
    const got = await sums(ref.tenantA, [ref.unitA1]);
    const base =
      "tenant_id = $1 and unit_id = $2 and deleted_at is null and occurred_on between '2026-10-01' and '2026-10-31'";
    const p = [ref.tenantA, ref.unitA1];
    const rev = `select coalesce(sum(amount_cents),0)::text v from entries where ${base} and type='revenue'`;
    const expense = (cond: string) =>
      `select coalesce(sum(e.amount_cents),0)::text v from entries e left join categories c on c.id = e.category_id
        where e.tenant_id = $1 and e.unit_id = $2 and e.deleted_at is null
          and e.occurred_on between '2026-10-01' and '2026-10-31' and e.type='expense' and ${cond}`;
    const operating = "(c.kind is null or c.kind not in ('deduction','investment'))";

    expect(got.grossRevenueCents).toBe(await scalar(rev, p));
    expect(got.revenueWithOrdersCents).toBe(await scalar(`${rev} and orders is not null`, p));
    expect(got.ordersCount).toBe(
      await scalar(
        `select coalesce(sum(orders),0)::text v from entries where ${base} and type='revenue'`,
        p,
      ),
    );
    expect(got.feesCents).toBe(
      await scalar(
        `select coalesce(sum(fee_cents),0)::text v from entries where ${base} and type='revenue'`,
        p,
      ),
    );
    expect(got.deductionExpensesCents).toBe(await scalar(expense("c.kind = 'deduction'"), p));
    expect(got.investmentsCents).toBe(await scalar(expense("c.kind = 'investment'"), p));
    expect(got.operatingExpensesCents).toBe(await scalar(expense(operating), p));
    expect(got.cmvCents).toBe(await scalar(expense(`${operating} and c.dre_group = 'cmv'`), p));
    expect(got.payrollCents).toBe(
      await scalar(expense(`${operating} and c.dre_group = 'pessoal'`), p),
    );
    expect(got.fixedCostsCents).toBe(
      await scalar(
        expense(`${operating} and c.nature = 'fixed' and c.dre_group is distinct from 'cmv'`),
        p,
      ),
    );
    expect(got.entryCount).toBe(
      await scalar(`select count(*)::text v from entries where ${base}`, p),
    );
  });

  it("não soma lixeira, setembro, novembro, outra unidade nem outro tenant", async () => {
    const got = await sums(ref.tenantA, [ref.unitA1]);
    expect(got.entryCount).toBe(11);
    expect(got.cmvCents).toBe(309000);
  });

  it("scope [A2] soma só A2", async () => {
    const got: PeriodSums = await sums(ref.tenantA, [ref.unitA2]);
    expect(got).toEqual({
      grossRevenueCents: 50000,
      revenueWithOrdersCents: 0,
      ordersCount: 0,
      feesCents: 0,
      deductionExpensesCents: 0,
      operatingExpensesCents: 44000,
      cmvCents: 44000,
      payrollCents: 0,
      fixedCostsCents: 0,
      investmentsCents: 0,
      entryCount: 2,
    });
  });

  it('scope "all" soma A1 e A2 do tenant A e não o B', async () => {
    const got = await sums(ref.tenantA, "all");
    expect(got.grossRevenueCents).toBe(1150000 + 50000);
    expect(got.operatingExpensesCents).toBe(691000 + 44000);
    expect(got.cmvCents).toBe(309000 + 44000);
    expect(got.entryCount).toBe(13);
  });

  it("tenant B vê só o que é dele", async () => {
    const got = await sums(ref.tenantB, "all");
    expect(got.grossRevenueCents).toBe(99999);
    expect(got.ordersCount).toBe(10);
    expect(got.operatingExpensesCents).toBe(88888);
    expect(got.entryCount).toBe(2);
  });

  it("scope vazio não soma nada", async () => {
    const got = await sums(ref.tenantA, []);
    expect(got.entryCount).toBe(0);
    expect(got.grossRevenueCents).toBe(0);
  });
});

const SEPTEMBER: Period = { from: "2026-09-01", to: "2026-09-30" };
const WINDOW: Period = { from: "2026-09-01", to: "2026-10-31" };

function monthly(tenantId: string, unitIds: ReportScope["unitIds"], window = WINDOW) {
  return withTenant(appDb, tenantId, (tx) =>
    reportReader.monthlySums(tx, { unitIds, ...PAYROLL }, window),
  );
}

function breakdown(
  tenantId: string,
  unitIds: ReportScope["unitIds"],
  by: BreakdownDimension,
  canSeePayroll: boolean,
  period = OCTOBER,
) {
  return withTenant(appDb, tenantId, (tx) =>
    reportReader.breakdown(tx, { unitIds, canSeePayroll }, period, by),
  );
}

const byKey = (rows: readonly { key: string | null; amountCents: number }[]) =>
  Object.fromEntries(rows.map((r) => [String(r.key), r.amountCents]));

const sumOf = (rows: readonly { amountCents: number }[]) =>
  rows.reduce((acc, r) => acc + r.amountCents, 0);

describe("reportReader.monthlySums", () => {
  it("devolve só os meses com dados, em ordem, e outubro bate com o resultado do período", async () => {
    const rows = await monthly(ref.tenantA, [ref.unitA1]);
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-10"]);
    // setembro: receita 10000; despesas 22222 + 3000 (dedução) + 4000 (categoria de outro tenant)
    expect(rows[0]).toEqual({ month: "2026-09", grossRevenueCents: 10000, expenseCents: 29222 });
    const october = rows[1];
    const indicators = computeIndicators(await sums(ref.tenantA, [ref.unitA1]));
    expect(october?.grossRevenueCents).toBe(ref.expected.grossRevenueCents);
    expect((october?.grossRevenueCents ?? 0) - (october?.expenseCents ?? 0)).toBe(
      indicators.resultCents,
    );
  });

  it("scope [A2] só traz outubro de A2; lista vazia não traz nada", async () => {
    expect(await monthly(ref.tenantA, [ref.unitA2])).toEqual([
      { month: "2026-10", grossRevenueCents: 50000, expenseCents: 44000 },
    ]);
    expect(await monthly(ref.tenantA, [])).toEqual([]);
  });

  it("o tenant B não aparece no tenant A", async () => {
    const rows = await monthly(ref.tenantA, "all");
    expect(rows.find((r) => r.month === "2026-10")?.grossRevenueCents).toBe(1150000 + 50000);
    const b = await monthly(ref.tenantB, "all");
    expect(b).toEqual([{ month: "2026-10", grossRevenueCents: 99999, expenseCents: 88888 }]);
  });
});

describe("reportReader.breakdown por categoria", () => {
  it("sem VER_FOLHA: folha em restricted, nunca em pessoal", async () => {
    const rows = await breakdown(ref.tenantA, [ref.unitA1], "category", false);
    const map = byKey(rows);
    expect(map.restricted).toBe(250000);
    expect(map.pessoal).toBeUndefined();
    expect(map).toEqual({
      restricted: 250000,
      cmv: 309000,
      ocupacao: 120000,
      outras: 7000,
      uncategorized: 5000,
      deducoes: 20000,
      fees: 37500,
    });
    expect(rows.every((r) => r.name === null)).toBe(true);
  });

  it("com VER_FOLHA: pessoal aparece e restricted não", async () => {
    const map = byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", true));
    expect(map.pessoal).toBe(250000);
    expect(map.restricted).toBeUndefined();
  });

  it("a soma dos itens é deduções + operacionais + taxas (investimento fora)", async () => {
    for (const canSee of [true, false]) {
      const rows = await breakdown(ref.tenantA, [ref.unitA1], "category", canSee);
      const e = ref.expected;
      expect(sumOf(rows)).toBe(e.deductionExpensesCents + e.operatingExpensesCents + e.feesCents);
    }
  });

  it("Review Focus 1: categoria de outro tenant vira restricted sem VER_FOLHA e conta no operacional", async () => {
    const hidden = byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", false, SEPTEMBER));
    expect(hidden.restricted).toBe(4000);
    expect(hidden.uncategorized).toBeUndefined();
    const visible = byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", true, SEPTEMBER));
    expect(visible.uncategorized).toBe(4000);
    expect(visible.restricted).toBeUndefined();
    const s = await sums(ref.tenantA, [ref.unitA1], SEPTEMBER);
    expect(s.operatingExpensesCents).toBe(22222 + 4000);
  });

  it("precedência: dedução sensível cai em deducoes, nunca em restricted", async () => {
    for (const canSee of [true, false]) {
      const map = byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", canSee, SEPTEMBER));
      expect(map.deducoes).toBe(3000);
    }
  });

  it("scope [A2] e lista vazia", async () => {
    expect(byKey(await breakdown(ref.tenantA, [ref.unitA2], "category", false))).toEqual({
      cmv: 44000,
    });
    expect(await breakdown(ref.tenantA, [], "category", true)).toEqual([]);
  });

  it("isolamento: o tenant B só vê o dele", async () => {
    const map = byKey(await breakdown(ref.tenantB, "all", "category", true));
    expect(map).toEqual({ cmv: 88888 });
  });
});

describe("reportReader.breakdown por canal e forma de pagamento", () => {
  it("forma de pagamento: receita sem forma tem key null e a soma é a receita bruta", async () => {
    const rows = await breakdown(ref.tenantA, [ref.unitA1], "payment_method", false);
    expect(rows).toEqual([
      { key: expect.any(String), name: "Pix", amountCents: 1000000 },
      { key: null, name: null, amountCents: 150000 },
    ]);
    expect(sumOf(rows)).toBe(ref.expected.grossRevenueCents);
  });

  it("canal de venda: nome do cadastro (receita sempre tem canal, por CHECK do banco)", async () => {
    const oct = await breakdown(ref.tenantA, [ref.unitA1], "sales_channel", true);
    expect(oct).toEqual([{ key: expect.any(String), name: "Salão", amountCents: 1150000 }]);
    const sep = await breakdown(ref.tenantA, [ref.unitA1], "sales_channel", true, SEPTEMBER);
    expect(sep).toEqual([{ key: expect.any(String), name: "Salão", amountCents: 10000 }]);
  });

  it("scope [A2], lista vazia e isolamento", async () => {
    const a2 = await breakdown(ref.tenantA, [ref.unitA2], "sales_channel", true);
    expect(sumOf(a2)).toBe(50000);
    expect(await breakdown(ref.tenantA, [], "payment_method", true)).toEqual([]);
    const b = await breakdown(ref.tenantB, "all", "sales_channel", true);
    expect(b).toEqual([{ key: expect.any(String), name: "Salão", amountCents: 99999 }]);
  });
});

/** Dados novos do próprio teste, em períodos que nenhum outro teste consulta (tenant A, unidade A1). */
interface NewCategory {
  name: string;
  kind: "expense" | "investment" | "deduction";
  dreGroup: string;
  sensitive: boolean;
}

async function newCategory(c: NewCategory): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into categories (id, tenant_id, name, kind, nature, dre_group, is_sensitive)
     values ($1, $2, $3, $4, 'variable', $5, $6)`,
    [id, ref.tenantA, c.name, c.kind, c.dreGroup, c.sensitive],
  );
  return id;
}

async function newEntry(e: {
  type: "revenue" | "expense";
  on: string;
  amount: number;
  fee?: number;
  orders?: number;
  category?: string;
}): Promise<void> {
  const user = (
    await db.admin.query<{ created_by: string }>(
      "select created_by from entries where tenant_id = $1 limit 1",
      [ref.tenantA],
    )
  ).rows[0]?.created_by;
  const channel = (
    await db.admin.query<{ id: string }>(
      "select id from sales_channels where tenant_id = $1 limit 1",
      [ref.tenantA],
    )
  ).rows[0]?.id;
  const fee = e.fee ?? 0;
  await db.admin.query(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
       amount_cents, fee_cents, net_cents, orders, category_id, sales_channel_id, created_by)
     values ($1, $2, $3, $4, $5, $5, 'Lançamento', $6, $7, $8, $9, $10, $11, $12)`,
    [
      uuidv7(),
      ref.tenantA,
      ref.unitA1,
      e.type,
      e.on,
      e.amount,
      fee,
      e.amount - fee,
      e.orders ?? null,
      e.category ?? null,
      e.type === "revenue" ? channel : null,
      user,
    ],
  );
}

describe("reportReader.breakdown: folha pelo grupo da DRE e sensível", () => {
  const MARCH: Period = { from: "2025-03-01", to: "2025-03-31" };
  const FEBRUARY: Period = { from: "2025-02-01", to: "2025-02-28" };
  const JANUARY: Period = { from: "2025-01-01", to: "2025-01-31" };

  it("categoria não sensível com grupo pessoal: restricted sem VER_FOLHA, pessoal com", async () => {
    const cat = await newCategory({
      name: "Pessoal não marcada",
      kind: "expense",
      dreGroup: "pessoal",
      sensitive: false,
    });
    await newEntry({ type: "expense", on: "2025-03-10", amount: 12345, category: cat });
    const hidden = byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", false, MARCH));
    expect(hidden).toEqual({ restricted: 12345 });
    const visible = byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", true, MARCH));
    expect(visible).toEqual({ pessoal: 12345 });
  });

  it("categoria sensível com grupo outras: restricted sem VER_FOLHA, outras com", async () => {
    const cat = await newCategory({
      name: "Sensível outras",
      kind: "expense",
      dreGroup: "outras",
      sensitive: true,
    });
    await newEntry({ type: "expense", on: "2025-02-10", amount: 6789, category: cat });
    expect(byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", false, FEBRUARY))).toEqual({
      restricted: 6789,
    });
    expect(byKey(await breakdown(ref.tenantA, [ref.unitA1], "category", true, FEBRUARY))).toEqual({
      outras: 6789,
    });
  });

  it("categoria sensível de investimento fica fora do breakdown", async () => {
    const cat = await newCategory({
      name: "Investimento sensível",
      kind: "investment",
      dreGroup: "pessoal",
      sensitive: true,
    });
    await newEntry({ type: "expense", on: "2025-01-10", amount: 5555, category: cat });
    for (const canSee of [true, false]) {
      expect(await breakdown(ref.tenantA, [ref.unitA1], "category", canSee, JANUARY)).toEqual([]);
    }
  });
});

describe("reportReader.periodSums: reforço em períodos isolados", () => {
  const JULY: Period = { from: "2025-07-01", to: "2025-07-31" };
  const SEPT: Period = { from: "2025-09-01", to: "2025-09-30" };
  const OCT25: Period = { from: "2025-10-01", to: "2025-10-31" };

  it("bordas: primeiro e último dia entram; dia anterior e seguinte não", async () => {
    // Dentro: 1000 (01/07) + 2000 (31/07) = 3000. Fora: 400 (30/06) e 800 (01/08).
    await newEntry({ type: "revenue", on: "2025-07-01", amount: 1000 });
    await newEntry({ type: "revenue", on: "2025-07-31", amount: 2000 });
    await newEntry({ type: "revenue", on: "2025-06-30", amount: 400 });
    await newEntry({ type: "revenue", on: "2025-08-01", amount: 800 });
    const got = await sums(ref.tenantA, [ref.unitA1], JULY);
    expect(got.grossRevenueCents).toBe(3000);
    expect(got.entryCount).toBe(2);
  });

  it("despesa com taxa não soma em taxas; despesa com pedidos é recusada pelo CHECK", async () => {
    // Despesa de 5000 com taxa 700: feesCents continua 0; receita de 9000 com taxa 450 e 3 pedidos.
    await newEntry({ type: "expense", on: "2025-09-05", amount: 5000, fee: 700 });
    await newEntry({ type: "revenue", on: "2025-09-06", amount: 9000, fee: 450, orders: 3 });
    const got = await sums(ref.tenantA, [ref.unitA1], SEPT);
    expect(got.feesCents).toBe(450);
    expect(got.ordersCount).toBe(3);
    expect(got.revenueWithOrdersCents).toBe(9000);
    // entries_orders_check: pedidos só em receita.
    await expect(
      newEntry({ type: "expense", on: "2025-09-07", amount: 100, orders: 2 }),
    ).rejects.toThrow(/entries_orders_check/);
  });

  it("dedução com grupo cmv e investimento com grupo pessoal não contam em cmv nem folha", async () => {
    const deduction = await newCategory({
      name: "Dedução cmv",
      kind: "deduction",
      dreGroup: "cmv",
      sensitive: false,
    });
    const invest = await newCategory({
      name: "Investimento pessoal",
      kind: "investment",
      dreGroup: "pessoal",
      sensitive: false,
    });
    await newEntry({ type: "expense", on: "2025-10-05", amount: 1500, category: deduction });
    await newEntry({ type: "expense", on: "2025-10-06", amount: 2500, category: invest });
    const got = await sums(ref.tenantA, [ref.unitA1], OCT25);
    expect(got.cmvCents).toBe(0);
    expect(got.payrollCents).toBe(0);
    expect(got.operatingExpensesCents).toBe(0);
    expect(got.deductionExpensesCents).toBe(1500);
    expect(got.investmentsCents).toBe(2500);
  });

  it("sem VER_FOLHA os totais ainda incluem a folha (DD-41), no período e na série mensal", async () => {
    // Folha de 7000 em 2025-11 (categoria sensível com grupo pessoal) e despesa comum de 1000.
    const folha = await newCategory({
      name: "Folha nov",
      kind: "expense",
      dreGroup: "pessoal",
      sensitive: true,
    });
    await newEntry({ type: "expense", on: "2025-11-05", amount: 7000, category: folha });
    await newEntry({ type: "expense", on: "2025-11-06", amount: 1000 });
    const period: Period = { from: "2025-11-01", to: "2025-11-30" };
    const scope = { unitIds: [ref.unitA1], canSeePayroll: false };
    const s = await withTenant(appDb, ref.tenantA, (tx) =>
      reportReader.periodSums(tx, scope, period),
    );
    expect(s.payrollCents).toBe(7000);
    expect(s.operatingExpensesCents).toBe(8000);
    const m = await withTenant(appDb, ref.tenantA, (tx) =>
      reportReader.monthlySums(tx, scope, period),
    );
    expect(m).toEqual([{ month: "2025-11", grossRevenueCents: 0, expenseCents: 8000 }]);
  });
});
