"use client";

import {
  ENTRY_FLAGS,
  ENTRY_SEARCH_MAX,
  type EntryListQuery,
  type EntryOptions,
  ORIGIN_CHANNELS,
  PERIOD_PRESETS,
  type PeriodPreset,
  resolvePeriod,
} from "@app/core/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CHANNEL_LABELS } from "./field-labels";

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7_days: "Últimos 7 dias",
  current_month: "Mês corrente",
  previous_month: "Mês anterior",
  custom: "Personalizado",
};

const controlClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-xs font-medium text-muted-foreground";

type FiltersProps = {
  query: EntryListQuery;
  options: EntryOptions | undefined;
  /** O lançador só vê os próprios lançamentos e não tem o filtro "Lançado por" (RF22.R3). */
  showCreatedBy: boolean;
  today: string;
  onChange(next: EntryListQuery): void;
};

/** Atalho que corresponde ao intervalo atual; se nenhum bate, é "personalizado". */
function presetOf(query: EntryListQuery, today: string): PeriodPreset {
  for (const preset of PERIOD_PRESETS) {
    if (preset === "custom") continue;
    const period = resolvePeriod(preset, today);
    if (period.from === query.from && period.to === query.to) return preset;
  }
  return "custom";
}

/**
 * Valor mostrado na hora e sincronizado com a URL quando ela muda. Sem isso, uma caixa de
 * marcação controlada só pela URL volta ao estado antigo entre o clique e o fim da navegação.
 */
function useSynced<T>(value: T, key: string): [T, (next: T) => void] {
  const [local, setLocal] = useState(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` é o texto de `value`, que é recriado a cada render.
  useEffect(() => setLocal(value), [key]);
  return [local, setLocal];
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

/** Lista de marcação (unidades, categorias): mexer em um item troca a lista inteira do filtro. */
function CheckList({
  legend,
  items,
  selected,
  onChange,
}: {
  legend: string;
  items: readonly { id: string; name: string }[];
  selected: readonly string[];
  onChange(next: string[] | undefined): void;
}) {
  const [marked, setMarked] = useSynced(selected, selected.join(","));
  function toggle(id: string, checked: boolean) {
    const next = checked ? [...marked, id] : marked.filter((item) => item !== id);
    setMarked(next);
    onChange(next.length > 0 ? next : undefined);
  }
  return (
    <details className="min-w-0 rounded-md border border-input px-2 py-1.5 text-sm">
      <summary className="cursor-pointer select-none">
        {legend}
        {marked.length > 0 ? ` (${marked.length})` : ""}
      </summary>
      <fieldset className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
        <legend className="sr-only">{legend}</legend>
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={marked.includes(item.id)}
              onChange={(event) => toggle(item.id, event.target.checked)}
            />
            <span className="min-w-0 truncate">{item.name}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

function RefSelect({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: readonly { id: string; name: string }[];
  value: string | undefined;
  onChange(next: string | undefined): void;
}) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        className={controlClass}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Todos</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Os campos de filtro. `idPrefix` separa a cópia do desktop da cópia da folha do celular. */
function FiltersForm({
  query,
  options,
  showCreatedBy,
  today,
  onChange,
  idPrefix,
}: FiltersProps & { idPrefix: string }) {
  const [search, setSearch] = useState(query.q ?? "");
  const id = (name: string) => `${idPrefix}-${name}`;
  // Todo filtro novo recomeça a paginação.
  const apply = (patch: Partial<EntryListQuery>) =>
    onChange({ ...query, ...patch, cursor: undefined });

  function choosePreset(preset: PeriodPreset) {
    if (preset === "custom") return;
    apply(resolvePeriod(preset, today));
  }

  // Datas são texto AAAA-MM-DD, comparável como texto; o campo vazio não muda o filtro.
  function changeFrom(from: string) {
    if (from === "") return;
    apply({ from, to: query.to < from ? from : query.to });
  }
  function changeTo(to: string) {
    if (to === "") return;
    apply({ to, from: query.from > to ? to : query.from });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const text = search.trim();
    apply({ q: text === "" ? undefined : text });
  }

  const flagged = (query.flags?.length ?? 0) > 0;
  const [reviewOnly, setReviewOnly] = useSynced(flagged, String(flagged));

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submitSearch} className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field id={id("q")} label="Buscar">
            <Input
              id={id("q")}
              type="search"
              value={search}
              maxLength={ENTRY_SEARCH_MAX}
              placeholder="Descrição, fornecedor, valor ou chave da nota"
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={id("period")} label="Período">
          <select
            id={id("period")}
            className={controlClass}
            value={presetOf(query, today)}
            onChange={(event) => choosePreset(event.target.value as PeriodPreset)}
          >
            {PERIOD_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {PRESET_LABELS[preset]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("from")} label="De">
          <input
            id={id("from")}
            type="date"
            className={controlClass}
            value={query.from}
            onChange={(event) => changeFrom(event.target.value)}
          />
        </Field>
        <Field id={id("to")} label="Até">
          <input
            id={id("to")}
            type="date"
            className={controlClass}
            value={query.to}
            onChange={(event) => changeTo(event.target.value)}
          />
        </Field>
        <Field id={id("type")} label="Tipo">
          <select
            id={id("type")}
            className={controlClass}
            value={query.type ?? ""}
            onChange={(event) =>
              apply({ type: (event.target.value || undefined) as EntryListQuery["type"] })
            }
          >
            <option value="">Todos</option>
            <option value="expense">Despesas</option>
            <option value="revenue">Receitas</option>
          </select>
        </Field>
        <RefSelect
          id={id("supplier")}
          label="Fornecedor"
          items={options?.suppliers ?? []}
          value={query.supplierId}
          onChange={(supplierId) => apply({ supplierId })}
        />
        <RefSelect
          id={id("payment")}
          label="Forma de pagamento"
          items={options?.paymentMethods ?? []}
          value={query.paymentMethodId}
          onChange={(paymentMethodId) => apply({ paymentMethodId })}
        />
        <RefSelect
          id={id("channel")}
          label="Canal de venda"
          items={options?.salesChannels ?? []}
          value={query.salesChannelId}
          onChange={(salesChannelId) => apply({ salesChannelId })}
        />
        {showCreatedBy && (
          <RefSelect
            id={id("author")}
            label="Lançado por"
            items={options?.members ?? []}
            value={query.createdBy}
            onChange={(createdBy) => apply({ createdBy })}
          />
        )}
        <Field id={id("origin")} label="Canal de origem">
          <select
            id={id("origin")}
            className={controlClass}
            value={query.originChannel ?? ""}
            onChange={(event) =>
              apply({
                originChannel: (event.target.value || undefined) as EntryListQuery["originChannel"],
              })
            }
          >
            <option value="">Todos</option>
            {ORIGIN_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(options?.units.length ?? 0) > 1 && (
          <CheckList
            legend="Unidades"
            items={options?.units ?? []}
            selected={query.unitIds ?? []}
            onChange={(unitIds) => apply({ unitIds })}
          />
        )}
        <CheckList
          legend="Categorias"
          items={options?.categories ?? []}
          selected={query.categoryIds ?? []}
          onChange={(categoryIds) => apply({ categoryIds })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(event) => {
              setReviewOnly(event.target.checked);
              apply({ flags: event.target.checked ? [...ENTRY_FLAGS] : undefined });
            }}
          />
          Só a revisar
        </label>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSearch("");
            onChange({
              ...resolvePeriod("current_month", today),
              sort: query.sort,
              dir: query.dir,
              limit: query.limit,
            });
          }}
        >
          Limpar filtros
        </Button>
      </div>
    </div>
  );
}

/**
 * Filtros da lista (RF22). No computador ficam abertos acima da tabela; no celular abrem em
 * folha lateral (RF22.Obs4). Quem guarda o estado é a URL: aqui só se avisa a mudança.
 */
export function FiltersBar(props: FiltersProps) {
  return (
    <>
      <div className="hidden md:block">
        <FiltersForm {...props} idPrefix="filters" />
      </div>
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Filtros</SheetTrigger>
          <SheetContent side="right" className="overflow-y-auto p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription>Refine a lista de lançamentos.</SheetDescription>
            </SheetHeader>
            <FiltersForm {...props} idPrefix="sheet-filters" />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
