import {
  changeOf,
  computeIndicators,
  dreGroupLabel,
  type PeriodIndicators,
  type ReportScope,
  ratioPermille,
  reportScopeFor,
} from "@app/core";
import {
  type BreakdownDimension,
  breakdownQuerySchema,
  breakdownReportSchema,
  comparisonPeriod,
  dashboardSummarySchema,
  type Indicator,
  type MonthlyReport,
  monthlyQuerySchema,
  monthlyReportSchema,
  monthsOf,
  monthsWindow,
  reportQuerySchema,
} from "@app/core/contracts";
import { reportReader, withTenant } from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  decoratePanelRequest,
  type PanelDeps,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
} from "../panel/panel-context";

export type ReportsRoutesDeps = PanelDeps;

const NOT_INFORMED_CHANNEL = "Não informado";
const NOT_INFORMED_PAYMENT = "Não informada";

/** Rótulo fixo por balde da quebra de categoria; nunca vem de nome de categoria (sensível). */
function categoryLabel(key: string): string {
  switch (key) {
    case "restricted":
      return "Pessoal (restrito)";
    case "fees":
      return "Taxas e comissões";
    case "deducoes":
      return "Deduções";
    case "uncategorized":
      return "Sem categoria";
    default:
      return dreGroupLabel(key);
  }
}

function indicator(
  value: number | null,
  previous: number | null,
  unit: "money" | "permille",
): Indicator {
  return { value, previous, ...changeOf(value, previous, unit) };
}

function buildIndicators(
  current: PeriodIndicators,
  previous: PeriodIndicators | null,
  canSeePayroll: boolean,
) {
  const pick = (
    read: (item: PeriodIndicators) => number | null,
    unit: "money" | "permille",
  ): Indicator => {
    const before = previous === null ? null : read(previous);
    return indicator(read(current), before, unit);
  };
  return {
    grossRevenue: pick((i) => i.grossRevenueCents, "money"),
    deductions: pick((i) => i.deductionsCents, "money"),
    netRevenue: pick((i) => i.netRevenueCents, "money"),
    operatingExpenses: pick((i) => i.operatingExpensesCents, "money"),
    result: pick((i) => i.resultCents, "money"),
    investments: pick((i) => i.investmentsCents, "money"),
    margin: pick((i) => i.marginPermille, "permille"),
    cmvRatio: pick((i) => i.cmvRatioPermille, "permille"),
    // A chave só existe para quem vê folha (RF27.R5, CA02).
    ...(canSeePayroll ? { payrollRatio: pick((i) => i.payrollRatioPermille, "permille") } : {}),
    averageTicket: pick((i) => i.averageTicketCents, "money"),
    breakEven: pick((i) => i.breakEvenCents, "money"),
  };
}

/**
 * Relatórios do dashboard (F4, RF27). Guard `report:view` (e não `requireEntryAction`: relatório
 * não é lançamento; o lançador recebe 403). O recorte sai de `reportScopeFor`; um único
 * `withTenant` por requisição. Erros só com `{ code }`; nenhum valor ou nome em log (regra 9).
 * Os totais incluem a folha (DD-41); `estimatedTax` nunca é enviado na F4 (CA08).
 */
export const reportsRoutes: FastifyPluginAsync<{ deps: ReportsRoutesDeps }> = async (
  app,
  { deps },
) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      // Só o tipo do erro: a mensagem do driver traz SQL e parâmetros.
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha nos relatórios");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const guards = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("report:view"),
  ];

  const invalidRequest = (reply: FastifyReply) => reply.code(400).send({ code: "invalid_request" });
  const forbidden = (reply: FastifyReply) => reply.code(403).send({ code: "forbidden" });

  function panelOf(request: FastifyRequest) {
    if (request.panel == null) throw new Error("requirePanelContext não preencheu o contexto");
    return request.panel;
  }

  /** Recorte do chamador, ou `null` (403): unidade fora do acesso, ator sem unidade ou sem permissão. */
  function scopeOf(
    request: FastifyRequest,
    requestedUnitIds: readonly string[] | undefined,
  ): ReportScope | null {
    const panel = panelOf(request);
    const scope = reportScopeFor({
      actor: panel.actor,
      activeUnitId: panel.unitId,
      requestedUnitIds,
    });
    return scope.ok ? scope.value : null;
  }

  app.get("/api/reports/summary", { preHandler: guards }, async (request, reply) => {
    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(reply);
    const query = parsed.data;
    const scope = scopeOf(request, query.unitIds);
    if (scope === null) return forbidden(reply);
    const panel = panelOf(request);

    const period = { from: query.from, to: query.to };
    const previousPeriod = comparisonPeriod(period, query.compare);
    const sums = await withTenant(deps.appDb, panel.tenantId, async (tx) => ({
      current: await reportReader.periodSums(tx, scope, period),
      previous:
        previousPeriod === null ? null : await reportReader.periodSums(tx, scope, previousPeriod),
    }));
    const current = computeIndicators(sums.current);
    const previous = sums.previous === null ? null : computeIndicators(sums.previous);

    return dashboardSummarySchema.parse({
      period,
      comparison:
        previousPeriod === null || query.compare === "none"
          ? null
          : { kind: query.compare, period: previousPeriod },
      isEmpty: sums.current.entryCount === 0,
      ticketCoveragePermille: current.ticketCoveragePermille,
      indicators: buildIndicators(current, previous, scope.canSeePayroll),
    });
  });

  app.get("/api/reports/monthly", { preHandler: guards }, async (request, reply) => {
    const parsed = monthlyQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(reply);
    const scope = scopeOf(request, parsed.data.unitIds);
    if (scope === null) return forbidden(reply);
    const panel = panelOf(request);

    const window = monthsWindow(parsed.data.to, 6);
    const rows = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      reportReader.monthlySums(tx, scope, window),
    );
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    const body: MonthlyReport = {
      months: monthsOf(parsed.data.to, 6).map((month) => {
        const row = byMonth.get(month);
        const revenueCents = row?.grossRevenueCents ?? 0;
        const expenseCents = row?.expenseCents ?? 0;
        return { month, revenueCents, expenseCents, resultCents: revenueCents - expenseCents };
      }),
    };
    return monthlyReportSchema.parse(body);
  });

  app.get("/api/reports/breakdown", { preHandler: guards }, async (request, reply) => {
    const parsed = breakdownQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(reply);
    const query = parsed.data;
    const scope = scopeOf(request, query.unitIds);
    if (scope === null) return forbidden(reply);
    const panel = panelOf(request);

    const rows = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      reportReader.breakdown(tx, scope, { from: query.from, to: query.to }, query.by),
    );
    const labelOf = (by: BreakdownDimension, key: string | null, name: string | null) => {
      if (by === "category") return categoryLabel(key ?? "uncategorized");
      const fallback = by === "sales_channel" ? NOT_INFORMED_CHANNEL : NOT_INFORMED_PAYMENT;
      return key === null ? fallback : (name ?? fallback);
    };
    const items = rows.map((row) => ({
      key: row.key ?? "none",
      label: labelOf(query.by, row.key, row.name),
      amountCents: row.amountCents,
    }));
    const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
    items.sort((a, b) =>
      a.amountCents !== b.amountCents
        ? b.amountCents - a.amountCents
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0,
    );
    return breakdownReportSchema.parse({
      by: query.by,
      totalCents,
      items: items.map((item) => ({
        ...item,
        sharePermille: ratioPermille(item.amountCents, totalCents),
      })),
    });
  });
};
