"use client";

import { CATALOG_ALIASES_MAX, PAYMENT_METHOD_TYPES, type PaymentMethodType } from "@app/core";
import type { PaymentMethodInput, PaymentMethodSettings } from "@app/core/contracts";
import { useRef, useState } from "react";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents } from "@/lib/format";
import { AliasesInput } from "../shared/aliases-input";
import { PAYMENT_TYPE_LABELS } from "../shared/catalog-labels";
import { PercentInput } from "../shared/percent-input";
import { ReadOnlyNotice } from "../shared/read-only-notice";
import { type SettingsErrorText, settingsErrorText } from "../shared/settings-errors";
import { type SettingsScope, useFeePreview } from "../shared/use-settings";

const EMPTY: PaymentMethodInput = {
  name: "",
  type: "other",
  feePercentBp: 0,
  feeFixedCents: 0,
  aliases: [],
  status: "active",
  isDefaultCard: false,
};

type Props = {
  scope: SettingsScope;
  /** Forma em edição; `null` cria uma nova. */
  initial: PaymentMethodSettings | null;
  onSubmit: (body: PaymentMethodInput) => Promise<unknown>;
  onDone: () => void;
};

/**
 * Formulário de forma de pagamento (RF08). Sem `catalog:manage` (ou forma do sistema) abre somente
 * leitura. A prévia do líquido vem do servidor: a tela não calcula taxa.
 */
export function PaymentMethodForm({ scope, initial, onSubmit, onDone }: Props) {
  const [values, setValues] = useState<PaymentMethodInput>(() => {
    if (initial === null) return EMPTY;
    const { id: _id, protected: _protected, ...rest } = initial;
    return rest;
  });
  const [rate, setRate] = useState<number | null>(values.feePercentBp);
  const [error, setError] = useState<SettingsErrorText | null>(null);
  const sending = useRef(false);
  const locked = !scope.canManage || initial?.protected === true;
  const preview = useFeePreview(scope, rate, values.feeFixedCents);

  function set<K extends keyof PaymentMethodInput>(key: K, value: PaymentMethodInput[K]) {
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

  const isCard = values.type === "credit" || values.type === "debit";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {locked && (
        <ReadOnlyNotice
          reason={
            initial?.protected
              ? "Este é um cadastro do sistema: não pode ser editado, inativado nem escolhido como cartão padrão."
              : undefined
          }
        />
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="pm-name">Nome</Label>
        <Input
          id="pm-name"
          value={values.name}
          disabled={locked}
          onChange={(event) => set("name", event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pm-type">Tipo</Label>
        <select
          id="pm-type"
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          value={values.type}
          disabled={locked}
          onChange={(event) => set("type", event.target.value as PaymentMethodType)}
        >
          {PAYMENT_METHOD_TYPES.map((type) => (
            <option key={type} value={type}>
              {PAYMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <PercentInput label="Taxa percentual" value={rate} onChange={setRate} disabled={locked} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="pm-fixed">Taxa fixa por venda</Label>
        <MoneyInput
          id="pm-fixed"
          value={values.feeFixedCents === 0 ? null : values.feeFixedCents}
          disabled={locked}
          onChange={(cents) => set("feeFixedCents", cents ?? 0)}
        />
      </div>
      {preview.data && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          Venda de R$ 100,00 rende {formatCents(preview.data.netCents)} líquidos
          <span className="block text-muted-foreground">
            Taxa de {formatCents(preview.data.feeCents)}. Mudar a taxa não altera lançamentos já
            feitos.
          </span>
        </p>
      )}
      <AliasesInput
        value={values.aliases}
        max={CATALOG_ALIASES_MAX}
        disabled={locked}
        onChange={(aliases) => set("aliases", aliases)}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="pm-status">Situação</Label>
        <select
          id="pm-status"
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          value={values.status}
          disabled={locked}
          onChange={(event) => set("status", event.target.value as "active" | "inactive")}
        >
          <option value="active">Ativa</option>
          <option value="inactive">Inativa</option>
        </select>
      </div>
      {isCard && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={values.isDefaultCard}
            disabled={locked}
            onChange={(event) => set("isDefaultCard", event.target.checked)}
          />
          Forma de cartão padrão (usada quando a mensagem só diz "cartão")
        </label>
      )}
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
