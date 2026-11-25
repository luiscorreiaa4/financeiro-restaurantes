"use client";

import { dreGroupLabel } from "@app/core";
import type { CategoryNode, CategorySettings } from "@app/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { tenantKey } from "@/lib/query/keys";
import { CATEGORY_KIND_LABELS } from "../shared/catalog-labels";
import { StatusBadge } from "../shared/status-badge";
import { useCatalogMutation } from "../shared/use-catalog-mutation";
import { type SettingsScope, useDebounced } from "../shared/use-settings";
import { SubcategoryForm } from "./subcategory-form";

type Editing = { parent: CategoryNode; item: CategorySettings | null };

const SELECT = "h-9 rounded-lg border border-input bg-transparent px-2 text-sm";

/** Plano de categorias (RF07): árvore de dois níveis; as do sistema são só leitura. */
export function CategoriesScreen({ scope }: { scope: SettingsScope }) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const term = useDebounced(search.trim());
  const list = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "categories", term, kind, status),
    queryFn: () =>
      scope.api.listCategories({
        ...(term ? { search: term } : {}),
        ...(kind ? { kind } : {}),
        ...(status ? { status } : {}),
      }),
  });
  const create = useCatalogMutation(
    scope,
    "categories",
    (body: Parameters<SettingsScope["api"]["createSubcategory"]>[0]) =>
      scope.api.createSubcategory(body),
  );
  const update = useCatalogMutation(
    scope,
    "categories",
    (args: { id: string; body: Parameters<SettingsScope["api"]["updateSubcategory"]>[1] }) =>
      scope.api.updateSubcategory(args.id, args.body),
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Categorias</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Buscar categoria"
            placeholder="Buscar por nome ou palavra de apoio"
            className="w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Tipo
            <select
              className={SELECT}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(CATEGORY_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Situação
            <select
              className={SELECT}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todas</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </select>
          </label>
        </div>
      </header>

      {list.isPending && <p role="status">Carregando…</p>}
      {list.isError && <p role="alert">Não foi possível carregar as categorias.</p>}
      {list.data?.length === 0 && <p role="status">Nenhuma categoria encontrada.</p>}
      <ul className="flex flex-col gap-3">
        {list.data?.map((node) => (
          <li key={node.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{node.name}</span>
                <span className="text-sm text-muted-foreground">
                  {CATEGORY_KIND_LABELS[node.kind]} · {dreGroupLabel(node.dreGroup)}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={node.status} system={node.origin === "system"} />
                  {node.isSensitive && <Badge variant="outline">sensível</Badge>}
                </span>
              </div>
              {scope.canManage && node.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Nova subcategoria em ${node.name}`}
                  onClick={() => setEditing({ parent: node, item: null })}
                >
                  Nova subcategoria
                </Button>
              )}
            </div>
            {node.children.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2 border-l pl-3">
                {node.children.map((child) => {
                  const editable = scope.canManage && child.origin === "company";
                  const label = editable ? "Editar" : "Ver";
                  return (
                    <li
                      key={child.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex flex-col gap-1">
                        <span>{child.name}</span>
                        {child.supportWords.length > 0 && (
                          <span className="text-sm text-muted-foreground">
                            Palavras de apoio: {child.supportWords.join(", ")}
                          </span>
                        )}
                        <StatusBadge status={child.status} system={child.origin === "system"} />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${label} ${child.name}`}
                        onClick={() => setEditing({ parent: node, item: child })}
                      >
                        {label}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.item ? "Subcategoria" : "Nova subcategoria"}</DialogTitle>
            <DialogDescription>
              Subcategoria de {editing?.parent.name}. A categoria pai não muda depois de criada.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <SubcategoryForm
              scope={scope}
              parent={editing.parent}
              initial={editing.item}
              onSubmit={(body) =>
                editing.item
                  ? update.mutateAsync({ id: editing.item.id, body })
                  : create.mutateAsync({ parentId: editing.parent.id, ...body })
              }
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
