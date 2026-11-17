"use client";

import {
  type ComparisonKind,
  PERIOD_PRESETS,
  type PeriodPreset,
  resolvePeriod,
} from "@app/core/contracts";
import type { DashboardParams } from "./url-state";

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7_days: "Últimos 7 dias",
  current_month: "Mês corrente",
  previous_month: "Mês anterior",
  custom: "Personalizado",
};

const COMPARE_LABELS: Record<ComparisonKind, string> = {
  previous_period: "Período anterior",
  previous_year: "Mesmo período do ano anterior",
  none: "Sem comparação",
};
const COMPARE_ORDER: readonly ComparisonKind[] = ["previous_period", "previous_year", "none"];

const controlClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-xs font-medium text-muted-foreground";

function presetOf(params: DashboardParams, today: string): PeriodPreset {
  for (const preset of PERIOD_PRESETS) {
    if (preset === "custom") continue;
    const period = resolvePeriod(preset, today);
    if (period.from === params.from && period.to === params.to) return preset;
  }
  return "custom";
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Período, unidade e "Comparar com" (RF27.R1, R2). Só muda a URL: quem lê a URL refaz as
 * consultas. O período usa os mesmos atalhos da lista de lançamentos.
 */
export function DashboardFilters({
  params,
  today,
  units,
  onChange,
}: {
  params: DashboardParams;
  today: string;
  /** Unidades de acesso (nome e id); com uma só, o seletor não aparece. */
  units: readonly { id: string; name: string }[];
  onChange(next: DashboardParams): void;
}) {
  function choosePreset(preset: PeriodPreset) {
    if (preset === "custom") return;
    onChange({ ...params, ...resolvePeriod(preset, today) });
  }
  // Datas são texto AAAA-MM-DD, comparável como texto; campo vazio não muda o filtro.
  function changeFrom(from: string) {
    if (from === "") return;
    onChange({ ...params, from, to: params.to < from ? from : params.to });
  }
  function changeTo(to: string) {
    if (to === "") return;
    onChange({ ...params, to, from: params.from > to ? to : params.from });
  }

  return (
    <form
      aria-label="Filtros do dashboard"
      onSubmit={(event) => event.preventDefault()}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <Field id="dash-period" label="Período">
        <select
          id="dash-period"
          className={controlClass}
          value={presetOf(params, today)}
          onChange={(event) => choosePreset(event.target.value as PeriodPreset)}
        >
          {PERIOD_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dash-from" label="De">
        <input
          id="dash-from"
          type="date"
          className={controlClass}
          value={params.from}
          onChange={(event) => changeFrom(event.target.value)}
        />
      </Field>
      <Field id="dash-to" label="Até">
        <input
          id="dash-to"
          type="date"
          className={controlClass}
          value={params.to}
          onChange={(event) => changeTo(event.target.value)}
        />
      </Field>
      {units.length > 1 && (
        <Field id="dash-unit" label="Unidade do relatório">
          <select
            id="dash-unit"
            className={controlClass}
            value={params.unitIds.length === 1 ? (params.unitIds[0] ?? "") : ""}
            onChange={(event) =>
              onChange({
                ...params,
                unitIds: event.target.value === "" ? [] : [event.target.value],
              })
            }
          >
            <option value="">Unidade do seletor do topo</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="dash-compare" label="Comparar com">
        <select
          id="dash-compare"
          className={controlClass}
          value={params.compare}
          onChange={(event) =>
            onChange({ ...params, compare: event.target.value as ComparisonKind })
          }
        >
          {COMPARE_ORDER.map((kind) => (
            <option key={kind} value={kind}>
              {COMPARE_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>
    </form>
  );
}
