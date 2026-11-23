import type { BusinessDate } from "@app/core";
import { type ComparisonKind, reportQuerySchema } from "@app/core/contracts";
import { z } from "zod";

/** Estado do dashboard, que mora na URL (RF27.R1): período, unidades e comparação. */
export interface DashboardParams {
  from: BusinessDate;
  to: BusinessDate;
  /** Vazio = o seletor de unidade do topo decide. */
  unitIds: readonly string[];
  compare: ComparisonKind;
}

/** Dia 1 do mês de `today` (texto AAAA-MM-DD, sem `Date`). */
function monthStart(today: BusinessDate): BusinessDate {
  return `${today.slice(0, 8)}01`;
}

/**
 * Lê o estado da URL. O padrão é o mês corrente até hoje (RF27.R1) com `previous_period`.
 * Período ausente, inválido, invertido ou maior que o limite volta ao padrão; unidade ou
 * comparação malformadas são descartadas sozinhas, como em `parseFilters`.
 */
export function parseDashboardParams(
  params: URLSearchParams,
  today: BusinessDate,
): DashboardParams {
  const fallback = { from: monthStart(today), to: today };
  const raw: Record<string, unknown> = {};
  const from = params.get("from");
  const to = params.get("to");
  Object.assign(raw, from !== null && to !== null ? { from, to } : fallback);
  const unitIds = params.getAll("unitIds").filter((id) => z.uuid().safeParse(id).success);
  if (unitIds.length > 0) raw.unitIds = unitIds;
  const compare = params.get("compare");
  if (compare !== null) raw.compare = compare;

  let result = reportQuerySchema.safeParse(raw);
  for (let attempt = 0; attempt < 3 && !result.success; attempt += 1) {
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (key === "from" || key === "to") Object.assign(raw, fallback);
      else if (typeof key === "string") delete raw[key];
    }
    result = reportQuerySchema.safeParse(raw);
  }
  if (!result.success) {
    result = reportQuerySchema.safeParse({ ...fallback });
  }
  if (!result.success) throw new RangeError("today inválido");
  const { from: f, to: t, unitIds: units, compare: c } = result.data;
  return { from: f, to: t, unitIds: units ?? [], compare: c };
}

/** Texto da query string da tela; `parseDashboardParams` lê de volta o mesmo estado. */
export function serializeDashboardParams(p: DashboardParams): string {
  const params = new URLSearchParams();
  params.set("from", p.from);
  params.set("to", p.to);
  for (const id of p.unitIds) params.append("unitIds", id);
  params.set("compare", p.compare);
  return params.toString();
}
