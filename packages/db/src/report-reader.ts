import type { PeriodSums, ReportScope } from "@app/core";
import type { BreakdownDimension, Period } from "@app/core/contracts";
import { sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { arrayLiteral, sensitiveExpression, toCents } from "./entry-reader";

interface RawSums extends Record<string, unknown> {
  gross: string;
  with_orders: string;
  orders: string;
  fees: string;
  deduction: string;
  operating: string;
  cmv: string;
  payroll: string;
  fixed: string;
  investments: string;
  entry_count: string;
}

/**
 * Despesa operacional: tudo o que não é dedução nem investimento, inclusive sem categoria ou
 * com categoria que a junção não trouxe (`c.kind` nulo). Texto fixo do código.
 */
const OPERATING = `e.type = 'expense' and (c.kind is null or c.kind not in ('deduction', 'investment'))`;

export interface MonthlyRow {
  month: string;
  grossRevenueCents: number;
  expenseCents: number;
}

export interface BreakdownRow {
  key: string | null;
  name: string | null;
  amountCents: number;
}

/** Despesa que entra no total mensal: dedução ou operacional (investimento fora). */
const EXPENSE_COUNTED = `e.type = 'expense' and (c.kind is null or c.kind <> 'investment')`;

function unitFilter(scope: ReportScope) {
  return scope.unitIds === "all"
    ? sql`true`
    : sql`e.unit_id = any(${arrayLiteral(scope.unitIds)}::uuid[])`;
}

/** Soma `expr` nas linhas que casam, sempre inteiro (nunca nulo). */
function total(expr: string, filter: string): string {
  return `coalesce(sum(${expr}) filter (where ${filter}), 0)::bigint::text`;
}

/**
 * Consultas de leitura do dashboard (F4, RF27). Rodam na transação de `withTenant`; quem chama
 * já resolveu o recorte com `reportScopeFor`. Os totais incluem a folha para todos (DD-41): o
 * sensível só afeta o detalhe por categoria, que não passa por aqui.
 */
export const reportReader = {
  /** Somas do período (competência, `occurred_on`) no recorte de unidades, calculadas pelo banco. */
  async periodSums(tx: Transaction, scope: ReportScope, period: Period): Promise<PeriodSums> {
    const unit =
      scope.unitIds === "all"
        ? sql`true`
        : sql`e.unit_id = any(${arrayLiteral(scope.unitIds)}::uuid[])`;
    const result = await tx.execute<RawSums>(sql`
      select
        ${sql.raw(total("e.amount_cents", "e.type = 'revenue'"))} as gross,
        ${sql.raw(total("e.amount_cents", "e.type = 'revenue' and e.orders is not null"))} as with_orders,
        ${sql.raw(total("e.orders", "e.type = 'revenue' and e.orders is not null"))} as orders,
        ${sql.raw(total("e.fee_cents", "e.type = 'revenue'"))} as fees,
        ${sql.raw(total("e.amount_cents", "e.type = 'expense' and c.kind = 'deduction'"))} as deduction,
        ${sql.raw(total("e.amount_cents", OPERATING))} as operating,
        ${sql.raw(total("e.amount_cents", `${OPERATING} and c.dre_group = 'cmv'`))} as cmv,
        ${sql.raw(total("e.amount_cents", `${OPERATING} and c.dre_group = 'pessoal'`))} as payroll,
        ${sql.raw(
          total(
            "e.amount_cents",
            `${OPERATING} and c.nature = 'fixed' and c.dre_group is distinct from 'cmv'`,
          ),
        )} as fixed,
        ${sql.raw(total("e.amount_cents", "e.type = 'expense' and c.kind = 'investment'"))} as investments,
        count(*)::text as entry_count
      from entries e
      left join categories c on c.id = e.category_id
      where e.deleted_at is null
        and e.occurred_on between ${period.from}::date and ${period.to}::date
        and ${unit}
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("reportReader: consulta sem linha");
    return {
      grossRevenueCents: toCents(row.gross),
      revenueWithOrdersCents: toCents(row.with_orders),
      ordersCount: toCents(row.orders),
      feesCents: toCents(row.fees),
      deductionExpensesCents: toCents(row.deduction),
      operatingExpensesCents: toCents(row.operating),
      cmvCents: toCents(row.cmv),
      payrollCents: toCents(row.payroll),
      fixedCostsCents: toCents(row.fixed),
      investmentsCents: toCents(row.investments),
      entryCount: toCents(row.entry_count),
    };
  },

  /**
   * Série mensal (competência) no recorte: receita bruta e despesa total (taxas + deduções +
   * operacionais; investimento fora). Só meses com dados, em ordem. A folha entra no total (DD-41).
   */
  async monthlySums(
    tx: Transaction,
    scope: ReportScope,
    window: Period,
  ): Promise<readonly MonthlyRow[]> {
    const result = await tx.execute<{ month: string; gross: string; expense: string }>(sql`
      select
        to_char(e.occurred_on, 'YYYY-MM') as month,
        ${sql.raw(total("e.amount_cents", "e.type = 'revenue'"))} as gross,
        (
          coalesce(sum(e.fee_cents) filter (where e.type = 'revenue'), 0)
          + coalesce(sum(e.amount_cents) filter (where ${sql.raw(EXPENSE_COUNTED)}), 0)
        )::bigint::text as expense
      from entries e
      left join categories c on c.id = e.category_id
      where e.deleted_at is null
        and e.occurred_on between ${window.from}::date and ${window.to}::date
        and ${unitFilter(scope)}
      group by 1
      order by 1
    `);
    return result.rows.map((row) => ({
      month: row.month,
      grossRevenueCents: toCents(row.gross),
      expenseCents: toCents(row.expense),
    }));
  },

  /**
   * Quebra do período. Por categoria: só despesa e taxas, com o balde decidido por lançamento
   * (investimento fora; dedução; restrito para quem não vê sensíveis, falhando fechado; grupo da
   * DRE). Por canal e forma: só receitas. O nome nunca sai na quebra por categoria.
   */
  async breakdown(
    tx: Transaction,
    scope: ReportScope,
    period: Period,
    by: BreakdownDimension,
  ): Promise<readonly BreakdownRow[]> {
    const window = sql`e.deleted_at is null
      and e.occurred_on between ${period.from}::date and ${period.to}::date
      and ${unitFilter(scope)}`;
    if (by === "category") {
      // Sem VER_FOLHA, o grupo "pessoal" também é restrito, mesmo em categoria não marcada como
      // sensível. `is not distinct from` evita nulo: a expressão nunca é nula.
      const restricted = scope.canSeePayroll
        ? "false"
        : `(${sensitiveExpression("e", "c")} or c.dre_group is not distinct from 'pessoal')`;
      const result = await tx.execute<{ key: string; amount: string }>(sql`
        select key, sum(amount)::bigint::text as amount from (
          select
            case
              when c.kind = 'deduction' then 'deducoes'
              when ${sql.raw(restricted)} then 'restricted'
              else coalesce(c.dre_group, 'uncategorized')
            end as key,
            e.amount_cents as amount
          from entries e
          left join categories c on c.id = e.category_id
          where e.type = 'expense'
            and (c.kind is null or c.kind <> 'investment')
            and ${window}
          union all
          select 'fees', e.fee_cents
          from entries e
          where e.type = 'revenue' and ${window}
        ) t
        group by key
        having sum(amount) <> 0
        order by amount desc, key
      `);
      return result.rows.map((row) => ({
        key: row.key,
        name: null,
        amountCents: toCents(row.amount),
      }));
    }
    const [column, table] =
      by === "sales_channel"
        ? (["sales_channel_id", "sales_channels"] as const)
        : (["payment_method_id", "payment_methods"] as const);
    const result = await tx.execute<{ key: string | null; name: string | null; amount: string }>(
      sql`
      select e.${sql.raw(column)}::text as key, d.name as name,
        sum(e.amount_cents)::bigint::text as amount
      from entries e
      left join ${sql.raw(table)} d on d.id = e.${sql.raw(column)}
      where e.type = 'revenue' and ${window}
      group by e.${sql.raw(column)}, d.name
      order by sum(e.amount_cents) desc, e.${sql.raw(column)}::text nulls last
    `,
    );
    return result.rows.map((row) => ({
      key: row.key,
      name: row.name,
      amountCents: toCents(row.amount),
    }));
  },
};
