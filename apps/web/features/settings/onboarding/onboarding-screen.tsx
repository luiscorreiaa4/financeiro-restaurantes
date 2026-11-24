"use client";

import { formatBp } from "@app/core";
import type { PaymentMethodInput, PaymentMethodSettings } from "@app/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { tenantKey } from "@/lib/query/keys";
import { PaymentMethodForm } from "../payment-methods/payment-method-form";
import type { SettingsScope } from "../shared/use-settings";

type Step = 1 | 2 | 3;

function ChannelStep({ scope, onNext }: { scope: SettingsScope; onNext: () => void }) {
  const queryClient = useQueryClient();
  const units = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "units"),
    queryFn: () => scope.api.listUnits(),
  });
  const channels = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "sales-channels", "active"),
    queryFn: () => scope.api.listSalesChannels({ status: "active" }),
  });
  const save = useMutation({
    mutationFn: (args: { id: string; channelId: string | null }) =>
      scope.api.updateUnit(args.id, { defaultSalesChannelId: args.channelId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tenantKey(scope.ctx, "settings", "units") }),
  });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const options = (channels.data ?? []).filter((channel) => !channel.protected);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Toda receita sem canal definido entra no canal padrão da unidade. Sugestão: Salão.
      </p>
      {units.data
        ?.filter((unit) => unit.status === "active")
        .map((unit) => {
          const current = picked[unit.id] ?? unit.defaultSalesChannelId ?? "";
          return (
            <div key={unit.id} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`ch-${unit.id}`} className="text-sm font-medium">
                  Canal padrão de {unit.name}
                </label>
                <select
                  id={`ch-${unit.id}`}
                  className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={current}
                  onChange={(event) =>
                    setPicked((state) => ({ ...state, [unit.id]: event.target.value }))
                  }
                >
                  <option value="">Nenhum</option>
                  {options.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                aria-label={`Salvar canal de ${unit.name}`}
                disabled={!scope.canManage || save.isPending}
                onClick={() =>
                  save.mutate({ id: unit.id, channelId: current === "" ? null : current })
                }
              >
                Salvar
              </Button>
            </div>
          );
        })}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onNext}>
          Pular
        </Button>
        <Button onClick={onNext}>Próximo</Button>
      </div>
    </div>
  );
}

function RatesStep({ scope, onNext }: { scope: SettingsScope; onNext: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PaymentMethodSettings | null>(null);
  const methods = useQuery({
    queryKey: tenantKey(scope.ctx, "settings", "payment-methods", ""),
    queryFn: () => scope.api.listPaymentMethods({}),
  });
  const update = useMutation({
    mutationFn: (args: { id: string; body: PaymentMethodInput }) =>
      scope.api.updatePaymentMethod(args.id, args.body),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: tenantKey(scope.ctx, "settings", "payment-methods"),
      }),
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Informe a taxa da sua maquininha para o líquido de cada venda sair certo.
      </p>
      <ul className="flex flex-col gap-2">
        {methods.data
          ?.filter((method) => !method.protected && method.status === "active")
          .map((method) => (
            <li
              key={method.id}
              className="flex items-center justify-between gap-2 rounded-lg border p-3"
            >
              <span className="text-sm">
                {method.name} · {formatBp(method.feePercentBp)}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Editar taxa de ${method.name}`}
                onClick={() => setEditing(method)}
              >
                Editar taxa
              </Button>
            </li>
          ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onNext}>
          Pular
        </Button>
        <Button onClick={onNext}>Próximo</Button>
      </div>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Taxa de {editing?.name}</DialogTitle>
            <DialogDescription>Vale para os próximos lançamentos.</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <PaymentMethodForm
              scope={scope}
              initial={editing}
              onSubmit={(body) => update.mutateAsync({ id: editing.id, body })}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TITLES: Record<Step, string> = {
  1: "Canal padrão de cada unidade",
  2: "Taxas das formas de pagamento",
  3: "Colaboradores",
};

/** Assistente inicial (RF01.Obs3, RF04.R6): três passos, cada um pode ser pulado. */
export function OnboardingScreen({ scope }: { scope: SettingsScope }) {
  const [step, setStep] = useState<Step>(1);
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">Passo {step} de 3</p>
      <h1 className="text-xl font-semibold">{TITLES[step]}</h1>
      {step === 1 && <ChannelStep scope={scope} onNext={() => setStep(2)} />}
      {step === 2 && <RatesStep scope={scope} onNext={() => setStep(3)} />}
      {step === 3 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Cadastrar quem lança pelo WhatsApp fica disponível em breve.
          </p>
          <Button disabled>Cadastrar colaborador</Button>
          <Link href="/" className={buttonVariants({ className: "w-full sm:w-auto" })}>
            Ir para o painel
          </Link>
        </div>
      )}
    </section>
  );
}
