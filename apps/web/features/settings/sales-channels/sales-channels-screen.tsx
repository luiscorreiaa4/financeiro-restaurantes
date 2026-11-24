"use client";

import { formatBp } from "@app/core";
import type { SalesChannelSettings, SalesChannelSettingsInput } from "@app/core/contracts";
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
import { tenantKey } from "@/lib/query/keys";
import { FeeReapplyDialog } from "../fee-reapply/fee-reapply-dialog";
import { CHANNEL_TYPE_LABELS } from "../shared/catalog-labels";
import { StatusBadge } from "../shared/status-badge";
import { useCatalogMutation } from "../shared/use-catalog-mutation";
import type { SettingsScope } from "../shared/use-settings";
import { SalesChannelForm } from "./sales-channel-form";

type Editing = { kind: "new" } | { kind: "edit"; item: SalesChannelSettings };

/** Canais de venda (RF09): lista, criar, editar, inativar e reaplicar a taxa (quem pode). */
export function SalesChannelsScreen({ scope }: { scope: SettingsScope }) {
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reapplying, setReapplying] = useState<SalesChannelSettings | null>(null);
  const list = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "sales-channels", status),
    queryFn: () => scope.api.listSalesChannels(status ? { status } : {}),
  });
  const create = useCatalogMutation(scope, "sales-channels", (body: SalesChannelSettingsInput) =>
    scope.api.createSalesChannel(body),
  );
  const update = useCatalogMutation(
    scope,
    "sales-channels",
    (args: { id: string; body: SalesChannelSettingsInput }) =>
      scope.api.updateSalesChannel(args.id, args.body),
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Canais de venda</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Situação
            <select
              className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todas</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </select>
          </label>
          {scope.canManage && (
            <Button onClick={() => setEditing({ kind: "new" })}>Novo canal de venda</Button>
          )}
        </div>
      </header>

      {list.isPending && <p role="status">Carregando…</p>}
      {list.isError && <p role="alert">Não foi possível carregar as formas de pagamento.</p>}
      <ul className="flex flex-col gap-2">
        {list.data?.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{item.name}</span>
              <span className="text-sm text-muted-foreground">
                {CHANNEL_TYPE_LABELS[item.type]} · comissão {formatBp(item.feePercentBp)}
              </span>
              <StatusBadge status={item.status} system={item.protected} />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`${scope.canManage && !item.protected ? "Editar" : "Ver"} ${item.name}`}
                onClick={() => setEditing({ kind: "edit", item })}
              >
                {scope.canManage && !item.protected ? "Editar" : "Ver"}
              </Button>
              {scope.canManage && !item.protected && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Reaplicar taxa de ${item.name}`}
                  onClick={() => setReapplying(item)}
                >
                  Reaplicar taxa
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.kind === "new" ? "Novo canal de venda" : "Canal de venda"}
            </DialogTitle>
            <DialogDescription>
              Comissão do canal. Vale para os próximos lançamentos.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <SalesChannelForm
              scope={scope}
              initial={editing.kind === "edit" ? editing.item : null}
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

      {reapplying !== null && (
        <FeeReapplyDialog
          scope={scope}
          target={{ kind: "sales_channel", id: reapplying.id, name: reapplying.name }}
          onClose={() => setReapplying(null)}
        />
      )}
    </section>
  );
}
