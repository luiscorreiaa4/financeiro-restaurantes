"use client";

import { CATALOG_ALIASES_MAX, SALES_CHANNEL_TYPES, type SalesChannelType } from "@app/core";
import type { SalesChannelSettings, SalesChannelSettingsInput } from "@app/core/contracts";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AliasesInput } from "../shared/aliases-input";
import { CHANNEL_TYPE_LABELS } from "../shared/catalog-labels";
import { PercentInput } from "../shared/percent-input";
import { ReadOnlyNotice } from "../shared/read-only-notice";
import { type SettingsErrorText, settingsErrorText } from "../shared/settings-errors";
import type { SettingsScope } from "../shared/use-settings";

const EMPTY: SalesChannelSettingsInput = {
  name: "",
  type: "other",
  feePercentBp: 0,
  aliases: [],
  status: "active",
};

type Props = {
  scope: SettingsScope;
  initial: SalesChannelSettings | null;
  onSubmit: (body: SalesChannelSettingsInput) => Promise<unknown>;
  onDone: () => void;
};

/** Formulário de canal de venda (RF09): comissão em pontos-base, sem taxa fixa nem cartão padrão. */
export function SalesChannelForm({ scope, initial, onSubmit, onDone }: Props) {
  const [values, setValues] = useState<SalesChannelSettingsInput>(() => {
    if (initial === null) return EMPTY;
    const { id: _id, protected: _protected, ...rest } = initial;
    return rest;
  });
  const [rate, setRate] = useState<number | null>(values.feePercentBp);
  const [error, setError] = useState<SettingsErrorText | null>(null);
  const sending = useRef(false);
  const locked = !scope.canManage || initial?.protected === true;

  function set<K extends keyof SalesChannelSettingsInput>(
    key: K,
    value: SalesChannelSettingsInput[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || locked || rate === null) return;
    sending.current = true;
    setError(null);
    try {
      await onSubmit({ ...values, feePercentBp: rate });
      onDone();
    } catch (e) {
      setError(settingsErrorText(e));
    } finally {
      sending.current = false;
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {locked && (
        <ReadOnlyNotice
          reason={
            initial?.protected
              ? "Este é um cadastro do sistema: não pode ser editado, inativado nem escolhido como canal padrão."
              : undefined
          }
        />
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="sc-name">Nome</Label>
        <Input
          id="sc-name"
          value={values.name}
          disabled={locked}
          onChange={(event) => set("name", event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sc-type">Tipo</Label>
        <select
          id="sc-type"
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          value={values.type}
          disabled={locked}
          onChange={(event) => set("type", event.target.value as SalesChannelType)}
        >
          {SALES_CHANNEL_TYPES.map((type) => (
            <option key={type} value={type}>
              {CHANNEL_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <PercentInput label="Comissão do canal" value={rate} onChange={setRate} disabled={locked} />
      {values.type === "app" && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Em canal de aplicativo, a comissão substitui a taxa da forma de pagamento (regra
          provisória P06): a venda no iFood paga só a comissão do canal.
        </p>
      )}
      <AliasesInput
        value={values.aliases}
        max={CATALOG_ALIASES_MAX}
        disabled={locked}
        onChange={(aliases) => set("aliases", aliases)}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="sc-status">Situação</Label>
        <select
          id="sc-status"
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          value={values.status}
          disabled={locked}
          onChange={(event) => set("status", event.target.value as "active" | "inactive")}
        >
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </select>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {!locked && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" disabled={rate === null}>
            Salvar
          </Button>
        </div>
      )}
    </form>
  );
}
