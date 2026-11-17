import type { PeriodSums } from "@app/core";
import type pg from "pg";
import { uuidv7 } from "../src/uuid";

export interface DashboardReference {
  tenantA: string;
  tenantB: string;
  unitA1: string;
  unitA2: string;
  /** Soma de outubro/2026 na unidade A1 do tenant A, calculada à mão (nunca pelo reader). */
  expected: PeriodSums;
}

/** Categoria do sistema (tenant nulo): reaproveita a que já existe, senão cria. */
async function systemCategory(
  admin: pg.Pool,
  c: { name: string; nature: string | null; dreGroup: string; sensitive?: boolean },
): Promise<string> {
  const found = await admin.query<{ id: string }>(
    "select id from categories where tenant_id is null and parent_id is null and name = $1",
    [c.name],
  );
  if (found.rows[0]) return found.rows[0].id;
  const id = uuidv7();
  await admin.query(
    `insert into categories (id, tenant_id, name, kind, nature, dre_group, is_sensitive)
     values ($1, null, $2, 'expense', $3, $4, $5)`,
    [id, c.name, c.nature, c.dreGroup, c.sensitive ?? false],
  );
  return id;
}

async function tenantCategory(
  admin: pg.Pool,
  tenantId: string,
  c: { name: string; kind: string; nature: string | null; dreGroup: string; sensitive?: boolean },
): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `insert into categories (id, tenant_id, name, kind, nature, dre_group, is_sensitive)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, tenantId, c.name, c.kind, c.nature, c.dreGroup, c.sensitive ?? false],
  );
  return id;
}

/**
 * Dados de referência do dashboard (F4, RF27.CA01): dois tenants, duas unidades no A e os
 * lançamentos de outubro/2026 da unidade A1 mais os que NÃO podem entrar na soma dela.
 *
 * Contas à mão de A1 em outubro/2026 (centavos):
 *   Receitas: R1 600000 (200 pedidos, taxa 30000) + R2 400000 (sem pedidos) + R3 150000
 *     (50 pedidos, taxa 7500, sem forma de pagamento)
 *     bruta 1150000; com pedidos 750000; pedidos 250; taxas 37500.
 *   Despesas: dedução 20000; investimento 320000; folha 250000 (fixa, pessoal);
 *     insumos 300000 (CMV); aluguel 120000 (fixo); sem categoria 5000;
 *     categoria sem natureza 7000; CMV de natureza fixa 9000.
 *     operacionais = 250000+300000+120000+5000+7000+9000 = 691000
 *     cmv = 300000+9000 = 309000; folha 250000; fixos = 250000+120000 = 370000
 *   Quantidade: 3 receitas + 8 despesas = 11.
 */
export async function seedDashboardReference(admin: pg.Pool): Promise<DashboardReference> {
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const unitA1 = uuidv7();
  const unitA2 = uuidv7();
  const unitB = uuidv7();
  const userA = uuidv7();
  const userB = uuidv7();
  const channelA = uuidv7();
  const channelB = uuidv7();
  const pixA = uuidv7();

  for (const [t, u, user, ch] of [
    [tenantA, unitA1, userA, channelA],
    [tenantB, unitB, userB, channelB],
  ] as const) {
    await admin.query("insert into tenants (id, name) values ($1, $2)", [t, "Restaurante"]);
    await admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [u, t]);
    await admin.query("insert into users (id, name, email) values ($1, 'Dono', $2)", [
      user,
      `${user}@ex.com`,
    ]);
    await admin.query("insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Salão')", [
      ch,
      t,
    ]);
  }
  await admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Filial')", [
    unitA2,
    tenantA,
  ]);
  await admin.query("insert into payment_methods (id, tenant_id, name) values ($1, $2, 'Pix')", [
    pixA,
    tenantA,
  ]);

  const folha = await systemCategory(admin, {
    name: "Folha de pagamento",
    nature: "fixed",
    dreGroup: "pessoal",
    sensitive: true,
  });
  const insumos = await systemCategory(admin, {
    name: "Insumos",
    nature: "variable",
    dreGroup: "cmv",
  });
  const aluguel = await systemCategory(admin, {
    name: "Aluguel",
    nature: "fixed",
    dreGroup: "ocupacao",
  });
  const deduction = await tenantCategory(admin, tenantA, {
    name: "Comissão de plataforma",
    kind: "deduction",
    nature: "variable",
    dreGroup: "impostos",
  });
  const investment = await tenantCategory(admin, tenantA, {
    name: "Reforma",
    kind: "investment",
    nature: "fixed",
    dreGroup: "outras",
  });
  const sensitiveDeduction = await tenantCategory(admin, tenantA, {
    name: "Taxa sensível",
    kind: "deduction",
    nature: "variable",
    dreGroup: "impostos",
    sensitive: true,
  });
  const foreignCategory = await tenantCategory(admin, tenantB, {
    name: "Categoria do outro tenant",
    kind: "expense",
    nature: "variable",
    dreGroup: "outras",
  });
  const noNature = await tenantCategory(admin, tenantA, {
    name: "Diversas",
    kind: "expense",
    nature: null,
    dreGroup: "outras",
  });
  const fixedCmv = await tenantCategory(admin, tenantA, {
    name: "Insumo contratado",
    kind: "expense",
    nature: "fixed",
    dreGroup: "cmv",
  });

  interface E {
    tenant: string;
    unit: string;
    user: string;
    type: "revenue" | "expense";
    on: string;
    amount: number;
    fee?: number;
    orders?: number;
    category?: string | null;
    payment?: string | null;
    deleted?: boolean;
  }
  const insert = async (e: E): Promise<void> => {
    const fee = e.fee ?? 0;
    await admin.query(
      `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
         amount_cents, fee_cents, net_cents, orders, category_id, payment_method_id,
         sales_channel_id, created_by, deleted_at, deleted_by, restorable_until)
       values ($1, $2, $3, $4, $5, $5, 'Lançamento', $6, $7, $8, $9, $10, $11, $12, $13,
         case when $14 then now() end, case when $14 then $13::uuid end,
         case when $14 then current_date + 30 end)`,
      [
        uuidv7(),
        e.tenant,
        e.unit,
        e.type,
        e.on,
        e.amount,
        fee,
        e.amount - fee,
        e.orders ?? null,
        e.category ?? null,
        e.payment ?? null,
        e.type === "revenue" ? (e.tenant === tenantA ? channelA : channelB) : null,
        e.user,
        e.deleted ?? false,
      ],
    );
  };
  const a1 = { tenant: tenantA, unit: unitA1, user: userA };
  const oct = "2026-10-";

  await insert({
    ...a1,
    type: "revenue",
    on: `${oct}05`,
    amount: 600000,
    fee: 30000,
    orders: 200,
    payment: pixA,
  });
  await insert({ ...a1, type: "revenue", on: `${oct}10`, amount: 400000, payment: pixA });
  await insert({ ...a1, type: "revenue", on: `${oct}15`, amount: 150000, fee: 7500, orders: 50 });
  await insert({ ...a1, type: "expense", on: `${oct}02`, amount: 20000, category: deduction });
  await insert({ ...a1, type: "expense", on: `${oct}03`, amount: 320000, category: investment });
  await insert({ ...a1, type: "expense", on: `${oct}04`, amount: 250000, category: folha });
  await insert({ ...a1, type: "expense", on: `${oct}06`, amount: 300000, category: insumos });
  await insert({ ...a1, type: "expense", on: `${oct}07`, amount: 120000, category: aluguel });
  await insert({ ...a1, type: "expense", on: `${oct}08`, amount: 5000 });
  await insert({ ...a1, type: "expense", on: `${oct}09`, amount: 7000, category: noNature });
  await insert({ ...a1, type: "expense", on: `${oct}11`, amount: 9000, category: fixedCmv });

  // Fora da soma de A1.
  await insert({
    ...a1,
    type: "expense",
    on: `${oct}12`,
    amount: 11111,
    category: insumos,
    deleted: true,
  });
  await insert({ ...a1, type: "expense", on: "2026-09-30", amount: 22222, category: insumos });
  await insert({ ...a1, type: "revenue", on: "2026-11-01", amount: 77777 });
  // Setembro em A1 (série mensal e precedência do balde): receita 10000; insumos 22222
  // (acima); dedução sensível 3000.
  await insert({ ...a1, type: "revenue", on: "2026-09-15", amount: 10000 });
  await insert({
    ...a1,
    type: "expense",
    on: "2026-09-20",
    amount: 3000,
    category: sensitiveDeduction,
  });
  // Corrompido de propósito: categoria de outro tenant (Review Focus 1). O gatilho
  // entries_category_scope impediria; só no teste ele é desligado durante este INSERT.
  const client = await admin.connect();
  try {
    await client.query("alter table entries disable trigger entries_category_scope");
    await client.query(
      `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
         amount_cents, fee_cents, net_cents, category_id, created_by)
       values ($1, $2, $3, 'expense', '2026-09-25', '2026-09-25', 'Lançamento', 4000, 0, 4000,
         $4, $5)`,
      [uuidv7(), tenantA, unitA1, foreignCategory, userA],
    );
  } finally {
    await client.query("alter table entries enable trigger entries_category_scope");
    client.release();
  }
  const a2 = { tenant: tenantA, unit: unitA2, user: userA };
  await insert({ ...a2, type: "revenue", on: `${oct}20`, amount: 50000 });
  await insert({ ...a2, type: "expense", on: `${oct}21`, amount: 44000, category: insumos });
  const b = { tenant: tenantB, unit: unitB, user: userB };
  await insert({ ...b, type: "revenue", on: `${oct}05`, amount: 99999, orders: 10 });
  await insert({ ...b, type: "expense", on: `${oct}06`, amount: 88888, category: insumos });

  return {
    tenantA,
    tenantB,
    unitA1,
    unitA2,
    expected: {
      grossRevenueCents: 1150000,
      revenueWithOrdersCents: 750000,
      ordersCount: 250,
      feesCents: 37500,
      deductionExpensesCents: 20000,
      operatingExpensesCents: 691000,
      cmvCents: 309000,
      payrollCents: 250000,
      fixedCostsCents: 370000,
      investmentsCents: 320000,
      entryCount: 11,
    },
  };
}
