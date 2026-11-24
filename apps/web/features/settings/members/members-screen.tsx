"use client";

import type {
  MemberCreated,
  MemberSettings,
  MemberSettingsInput,
  MemberSettingsPatch,
} from "@app/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ApiError } from "@/lib/api/client";
import { tenantKey } from "@/lib/query/keys";
import { useDebounced } from "../shared/use-settings";
import { InviteDialog } from "./invite-dialog";
import { MemberForm } from "./member-form";
import { MEMBER_ERRORS, ROLE_LABELS, STATUS_LABELS } from "./member-labels";
import type { MembersScope } from "./use-members";

type Editing = { kind: "new" } | { kind: "edit"; item: MemberSettings };

function unitsText(member: MemberSettings, unitNames: Map<string, string>): string {
  if (member.allUnits) return "Todas as unidades";
  const names = member.unitIds.map((id) => unitNames.get(id)).filter(Boolean);
  return names.length === 0 ? "Sem unidade" : names.join(", ");
}

/** Colaboradores (RF05): lista com busca e filtros, cadastro com texto de convite, desativar e reativar. */
export function MembersScreen({
  scope,
  whatsappNumber,
  startNew = false,
}: {
  scope: MembersScope;
  whatsappNumber?: string;
  /** `?novo=1` (assistente inicial): abre o cadastro ao montar. */
  startNew?: boolean;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(
    startNew && scope.canManage ? { kind: "new" } : null,
  );
  const [created, setCreated] = useState<MemberCreated | null>(null);
  const [toggling, setToggling] = useState<{
    item: MemberSettings;
    to: "deactivate" | "reactivate";
  } | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const term = useDebounced(search);

  const members = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "members", term, role, status),
    queryFn: () => scope.api.list({ search: term, role, status }),
  });
  const units = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "units"),
    queryFn: () => scope.listUnits(),
  });
  const unitNames = new Map((units.data ?? []).map((u) => [u.id, u.name]));

  // A lista de unidades mostra "colaboradores só desta unidade": recarregue as duas.
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: tenantKey(scope.ctx, "settings") });
  const create = useMutation({
    mutationFn: (body: MemberSettingsInput) => scope.api.create(body),
    onSuccess: async (result) => {
      await refresh();
      setCreated(result);
    },
  });
  const update = useMutation({
    mutationFn: (args: { id: string; body: MemberSettingsPatch }) =>
      scope.api.update(args.id, args.body),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (args: { id: string; to: "deactivate" | "reactivate" }) =>
      args.to === "deactivate" ? scope.api.deactivate(args.id) : scope.api.reactivate(args.id),
    onSuccess: refresh,
  });

  async function confirmToggle() {
    if (toggling === null) return;
    setToggleError(null);
    try {
      await toggle.mutateAsync({ id: toggling.item.id, to: toggling.to });
      setToggling(null);
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { code?: string } | undefined) : undefined;
      setToggleError(
        (body?.code && MEMBER_ERRORS[body.code]) || "Não foi possível concluir. Tente de novo.",
      );
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Colaboradores</h1>
        {scope.canManage && (
          <Button onClick={() => setEditing({ kind: "new" })}>Novo colaborador</Button>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Buscar colaborador"
          placeholder="Nome ou final do celular"
          className="max-w-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Papel"
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">Todos os papéis</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Situação"
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Todas</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {members.isPending && <p role="status">Carregando…</p>}
      {members.isError && <p role="alert">Não foi possível carregar os colaboradores.</p>}
      {members.data?.length === 0 && <p role="status">Nenhum colaborador encontrado.</p>}
      <ul className="flex flex-col gap-2">
        {(members.data ?? []).map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{member.displayName}</span>
              <span className="text-sm text-muted-foreground">
                {ROLE_LABELS[member.role]} · {member.phoneMasked}
              </span>
              <span className="text-sm text-muted-foreground">{unitsText(member, unitNames)}</span>
              <Badge
                variant={member.status === "active" ? "secondary" : "outline"}
                className="w-fit"
              >
                {STATUS_LABELS[member.status]}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`${scope.canManage ? "Editar" : "Ver"} ${member.displayName}`}
                onClick={() => setEditing({ kind: "edit", item: member })}
              >
                {scope.canManage ? "Editar" : "Ver"}
              </Button>
              {scope.canManage && member.status !== "deactivated" && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Desativar ${member.displayName}`}
                  onClick={() => {
                    setToggleError(null);
                    setToggling({ item: member, to: "deactivate" });
                  }}
                >
                  Desativar
                </Button>
              )}
              {scope.canManage && member.status === "deactivated" && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Reativar ${member.displayName}`}
                  onClick={() => {
                    setToggleError(null);
                    setToggling({ item: member, to: "reactivate" });
                  }}
                >
                  Reativar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.kind === "new" ? "Novo colaborador" : "Colaborador"}
            </DialogTitle>
            <DialogDescription>
              Quem perde acesso é desconectado do painel na hora.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <MemberForm
              scope={scope}
              initial={editing.kind === "edit" ? editing.item : null}
              units={units.data ?? []}
              onCreate={(body) => create.mutateAsync(body)}
              onUpdate={(id, body) => update.mutateAsync({ id, body })}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <InviteDialog
        open={created !== null}
        name={created?.member.displayName ?? ""}
        text={created?.inviteText ?? ""}
        whatsappNumber={whatsappNumber}
        onClose={() => setCreated(null)}
      />

      <Dialog open={toggling !== null} onOpenChange={(open) => !open && setToggling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {toggling?.to === "deactivate" ? "Desativar" : "Reativar"}{" "}
              {toggling?.item.displayName}?
            </DialogTitle>
            <DialogDescription>
              {toggling?.to === "deactivate"
                ? "A pessoa deixa de lançar e perde o acesso ao painel. O histórico continua."
                : "A pessoa volta a lançar. Se ainda não respondeu ao convite, fica como convidada."}
            </DialogDescription>
          </DialogHeader>
          {toggleError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {toggleError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setToggling(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmToggle} disabled={toggle.isPending}>
              {toggling?.to === "deactivate" ? "Desativar colaborador" : "Reativar colaborador"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
