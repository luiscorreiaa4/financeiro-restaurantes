"use client";

import type { UnitSettings, UnitSettingsInput } from "@app/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ApiError } from "@/lib/api/client";
import { tenantKey } from "@/lib/query/keys";
import { StatusBadge } from "../shared/status-badge";
import type { SettingsScope } from "../shared/use-settings";
import { type LoadCities, UnitForm } from "./unit-form";

type Editing = { kind: "new" } | { kind: "edit"; item: UnitSettings };

const LAST_UNIT_MESSAGE =
  "Não é possível inativar a última unidade ativa. A empresa precisa de pelo menos uma: crie ou reative outra antes.";

function matches(unit: UnitSettings, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === "") return true;
  return [unit.name, ...unit.aliases].some((value) => value.toLowerCase().includes(needle));
}

/** Unidades (RF04): lista com busca e filtro, criar, editar, inativar (com aviso) e reativar. */
export function UnitsScreen({
  scope,
  loadCities,
}: {
  scope: SettingsScope;
  loadCities?: LoadCities;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deactivating, setDeactivating] = useState<UnitSettings | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const units = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "units"),
    queryFn: () => scope.api.listUnits(),
  });
  const channels = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "sales-channels", "active"),
    queryFn: () => scope.api.listSalesChannels({ status: "active" }),
  });

  // O seletor de empresa e unidade da casca lê `/api/units`: recarregue-o também.
  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: tenantKey(scope.ctx, "settings", "units") }),
      queryClient.invalidateQueries({ queryKey: tenantKey(scope.ctx, "units") }),
    ]);
  }
  const create = useMutation({
    mutationFn: (body: UnitSettingsInput) => scope.api.createUnit(body),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (args: { id: string; body: UnitSettingsInput }) =>
      scope.api.updateUnit(args.id, args.body),
    onSuccess: refresh,
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => scope.api.deactivateUnit(id),
    onSuccess: refresh,
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => scope.api.reactivateUnit(id),
    onSuccess: refresh,
  });

  async function confirmDeactivate() {
    if (deactivating === null) return;
    setDeactivateError(null);
    try {
      await deactivate.mutateAsync(deactivating.id);
      setDeactivating(null);
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { code?: string } | undefined) : undefined;
      setDeactivateError(
        body?.code === "last_active_unit"
          ? LAST_UNIT_MESSAGE
          : "Não foi possível inativar. Tente de novo.",
      );
    }
  }

  const visible = (units.data ?? []).filter(
    (u) => (status === "" || u.status === status) && matches(u, search),
  );
  const channelOptions = (channels.data ?? []).filter((c) => !c.protected);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Unidades</h1>
        {scope.canManage && (
          <Button onClick={() => setEditing({ kind: "new" })}>Nova unidade</Button>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Buscar unidade"
          placeholder="Buscar por nome ou apelido"
          className="max-w-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Situação"
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Todas</option>
          <option value="active">Ativas</option>
          <option value="inactive">Inativas</option>
        </select>
      </div>

      {units.isPending && <p role="status">Carregando…</p>}
      {units.isError && <p role="alert">Não foi possível carregar as unidades.</p>}
      <ul className="flex flex-col gap-2">
        {visible.map((unit) => (
          <li
            key={unit.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{unit.name}</span>
              <span className="text-sm text-muted-foreground">
                {unit.city
                  ? `${unit.city}${unit.uf ? `/${unit.uf}` : ""}`
                  : "Município não informado"}
              </span>
              <StatusBadge status={unit.status} />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`${scope.canManage ? "Editar" : "Ver"} ${unit.name}`}
                onClick={() => setEditing({ kind: "edit", item: unit })}
              >
                {scope.canManage ? "Editar" : "Ver"}
              </Button>
              {scope.canManage && unit.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Inativar ${unit.name}`}
                  onClick={() => {
                    setDeactivateError(null);
                    setDeactivating(unit);
                  }}
                >
                  Inativar
                </Button>
              )}
              {scope.canManage && unit.status === "inactive" && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Reativar ${unit.name}`}
                  onClick={() => reactivate.mutate(unit.id)}
                >
                  Reativar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.kind === "new" ? "Nova unidade" : "Unidade"}</DialogTitle>
            <DialogDescription>
              Trocar o fuso ou o canal padrão não altera os lançamentos já feitos.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <UnitForm
              scope={scope}
              initial={editing.kind === "edit" ? editing.item : null}
              channels={channelOptions}
              loadCities={loadCities}
              onSubmit={(body) =>
                editing.kind === "edit"
                  ? update.mutateAsync({ id: editing.item.id, body })
                  : create.mutateAsync(body)
              }
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deactivating !== null} onOpenChange={(open) => !open && setDeactivating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inativar {deactivating?.name}?</DialogTitle>
            <DialogDescription>
              A unidade inativa não recebe novos lançamentos. Os lançamentos antigos continuam.
            </DialogDescription>
          </DialogHeader>
          {deactivating !== null && deactivating.onlyUnitMemberCount > 0 && (
            <p role="note" className="rounded-lg border p-3 text-sm">
              {deactivating.onlyUnitMemberCount}{" "}
              {deactivating.onlyUnitMemberCount === 1 ? "colaborador tem" : "colaboradores têm"} só
              esta unidade e não conseguirão lançar até receberem outra.
            </p>
          )}
          {deactivateError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {deactivateError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeactivating(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmDeactivate} disabled={deactivate.isPending}>
              Inativar unidade
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
