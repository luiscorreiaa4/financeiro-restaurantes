import { z } from "zod";
import { businessDateSchema, queryList } from "./entries";
import { COMPARISON_KINDS, periodWithinLimit } from "./period";

// Contrato da API de relatórios do dashboard (F4, RF27): só Zod e tipos. Dinheiro em
// centavos inteiros e percentual em décimos de ponto percentual (RNF13, DD-38).

const idSchema = z.uuid();

/** Intervalo de datas de negócio, com `from <= to`. */
export const periodSchema = z
  .object({ from: businessDateSchema, to: businessDateSchema })
  .strict()
  .refine((period) => period.from <= period.to, { path: ["to"], message: "period_inverted" });

export const indicatorSchema = z
  .object({
    value: z.int().nullable(),
    previous: z.int().nullable(),
    changePermille: z.int().nullable(),
    direction: z.enum(["up", "down", "flat"]).nullable(),
  })
  .strict();

export const dashboardSummarySchema = z
  .object({
    period: periodSchema,
    comparison: z
      .object({ kind: z.enum(["previous_period", "previous_year"]), period: periodSchema })
      .strict()
      .nullable(),
    isEmpty: z.boolean(),
    ticketCoveragePermille: z.int().nullable(),
    indicators: z
      .object({
        grossRevenue: indicatorSchema,
        deductions: indicatorSchema,
        netRevenue: indicatorSchema,
        operatingExpenses: indicatorSchema,
        result: indicatorSchema,
        investments: indicatorSchema,
        margin: indicatorSchema,
        cmvRatio: indicatorSchema,
        // A chave só existe para quem vê folha (RF27.R5, CA02).
        payrollRatio: indicatorSchema.optional(),
        averageTicket: indicatorSchema,
        breakEven: indicatorSchema,
      })
      .strict(),
    estimatedTax: z
      .object({ amountCents: z.int(), revenueSharePermille: z.int().nullable() })
      .strict()
      .optional(),
  })
  .strict();

function checkPeriod(query: { from: string; to: string }, ctx: z.RefinementCtx): void {
  // Data inválida já tem o seu erro; as checagens do objeto rodam mesmo assim.
  if (!businessDateSchema.safeParse(query.from).success) return;
  if (!businessDateSchema.safeParse(query.to).success) return;
  if (query.from > query.to) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "period_inverted" });
  } else if (!periodWithinLimit(query.from, query.to)) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "period_too_long" });
  }
}

export const reportQuerySchema = z
  .object({
    from: businessDateSchema,
    to: businessDateSchema,
    unitIds: queryList(idSchema),
    compare: z.enum(COMPARISON_KINDS).default("previous_period"),
  })
  .superRefine(checkPeriod);

export const monthlyQuerySchema = z.object({
  to: businessDateSchema,
  unitIds: queryList(idSchema),
});

export const monthlyReportSchema = z
  .object({
    months: z
      .array(
        z
          .object({
            month: z.string().regex(/^\d{4}-\d{2}$/),
            revenueCents: z.int(),
            expenseCents: z.int(),
            resultCents: z.int(),
          })
          .strict(),
      )
      .length(6),
  })
  .strict();

export const BREAKDOWN_DIMENSIONS = ["category", "sales_channel", "payment_method"] as const;

export const breakdownQuerySchema = z
  .object({
    from: businessDateSchema,
    to: businessDateSchema,
    unitIds: queryList(idSchema),
    by: z.enum(BREAKDOWN_DIMENSIONS),
  })
  .superRefine(checkPeriod);

export const breakdownReportSchema = z
  .object({
    by: z.enum(BREAKDOWN_DIMENSIONS),
    totalCents: z.int(),
    items: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          amountCents: z.int(),
          sharePermille: z.int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type Indicator = z.infer<typeof indicatorSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
export type BreakdownReport = z.infer<typeof breakdownReportSchema>;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type MonthlyQuery = z.infer<typeof monthlyQuerySchema>;
export type BreakdownQuery = z.infer<typeof breakdownQuerySchema>;
