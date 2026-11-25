"use client";

import type { SupplierSettings } from "@app/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatBusinessDate, formatCents } from "@/lib/format";
import { tenantKey } from "@/lib/query/keys";
import { StatusBadge } from "../shared/status-badge";
import { useCatalogMutation } from "../shared/use-catalog-mutation";
import { type SettingsScope, useDebounced } from "../shared/use-settings";
import { MergeDialog } from "./merge-dialog";
import { SupplierForm } from "./supplier-form";

export type SuppliersPeriod = { from?: string; to?: string };

type Props = {
  scope: SettingsScope;
  /** Período da URL (vazio = o servidor usa o mês corrente). */
  period: SuppliersPeriod;
  onPeriodChange: (next: SuppliersPeriod) => void;
};

const SELECT = "h-9 rounded-lg border border-input bg-transparent px-2 text-sm";

/** Fornecedores (RF10): total e última compra vêm do servidor, no recorte de quem consulta. */
export function SuppliersScreen({ scope, period, onPeriodChange }: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<SupplierSettings | null>(null);
  const [merging, setMerging] = useState<SupplierSettings | null>(null);
  const term = useDebounced(search.trim());
  const list = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "suppliers", term, status, period.from, period.to),
    queryFn: () =>
      scope.api.listSuppliers({
        ...(term ? { search: term } : {}),
        ...(status ? { status } : {}),
        ...(period.from ? { from: period.from } : {}),
        ...(period.to ? { to: period.to } : {}),
      }),
  });
  const update = useCatalogMutation(
    scope,
    "suppliers",
    (args: { id: string; body: Parameters<SettingsScope["api"]["updateSupplier"]>[1] }) =>
      scope.api.updateSupplier(args.id, args.body),
  );
  const items = list.data?.items ?? [];

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Fornecedores</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Buscar fornecedor"
            placeholder="Nome, apelido ou documento"
            className="w-56"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Situação
            <select
              className={SELECT}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </label>
          <label htmlFor="sup-from" className="flex items-center gap-2 text-sm">
            De
            <Input
              id="sup-from"
              type="date"
              className="w-40"
              value={period.from ?? list.data?.from ?? ""}
              onChange={(event) => onPeriodChange({ ...period, from: event.target.value })}
            />
          </label>
          <label htmlFor="sup-to" className="flex items-center gap-2 text-sm">
            Até
            <Input
              id="sup-to"
              type="date"
              className="w-40"
              value={period.to ?? list.data?.to ?? ""}
              onChange={(event) => onPeriodChange({ ...period, to: event.target.value })}
            />
          </label>
        </div>
      </header>

      {list.isPending && <p role="status">Carregando…</p>}
      {list.isError && <p role="alert">Não foi possível carregar os fornecedores.</p>}
      {list.data && items.length === 0 && <p role="status">Nenhum fornecedor encontrado.</p>}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{item.name}</span>
              {item.document !== null && (
                <span className="text-sm text-muted-foreground">{item.document}</span>
              )}
              <span className="text-sm text-muted-foreground">
                Gasto no período: {formatCents(item.totalSpentCents)} ·{" "}
                {item.lastPurchaseOn
                  ? `última compra em ${formatBusinessDate(item.lastPurchaseOn)}`
                  : "sem compras no período"}
              </span>
              <StatusBadge status={item.status} />
            </div>
            {scope.canManageSuppliers && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Editar ${item.name}`}
                  onClick={() => setEditing(item)}
                >
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Mesclar ${item.name}`}
                  onClick={() => setMerging(item)}
                >
                  Mesclar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar fornecedor</DialogTitle>
            <DialogDescription>Nome, documento, apelidos e situação.</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <SupplierForm
              supplier={editing}
              canManage={scope.canManageSuppliers}
              onSubmit={(body) => update.mutateAsync({ id: editing.id, body })}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {merging !== null && (
        <MergeDialog
          scope={scope}
          source={merging}
          candidates={items}
          onClose={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            void list.refetch();
          }}
        />
      )}
    </section>
  );
}
