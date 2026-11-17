"use client";

import { QUANTITY_UNITS } from "@app/core";
import { type EntryDetail, type EntryOptions, entryPatchSchema } from "@app/core/contracts";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import { isEntryStale } from "./entries-api";
import { Field, NativeSelect } from "./entry-form-fields";
import {
  buildPatch,
  type EntryFormValues,
  type FormField,
  initialValues,
  localErrors,
  QUANTITY_REQUIRED_MESSAGE,
} from "./form-patch";
import { StaleNotice } from "./stale-notice";
import { SupplierField } from "./supplier-field";
import { useUpdateEntry } from "./use-entries";

/** Mensagem do 422 `invalid_entry`, por código de domínio, e o campo que ela aponta. */
export const DOMAIN_ERRORS: Record<string, { field: FormField | null; message: string }> = {
  DateTooFarAhead: {
    field: "occurredOn",
    message: "A data pode ser no máximo 60 dias à frente de hoje.",
  },
  InvalidBusinessDate: { field: "occurredOn", message: "Informe uma data válida." },
  QuantityRequired: { field: "quantity", message: QUANTITY_REQUIRED_MESSAGE },
  InvalidAmount: { field: "amountCents", message: "Informe um valor maior que zero." },
  UnknownReference: {
    field: null,
    message: "Algum cadastro escolhido não existe mais. Recarregue o lançamento.",
  },
  NothingToChange: { field: null, message: "Nenhuma alteração para salvar." },
  AmountNotPositive: { field: "amountCents", message: "Informe um valor maior que zero." },
  MoneyOverflow: { field: "amountCents", message: "O valor informado é grande demais." },
  InvalidQuantity: { field: "quantity", message: "Informe uma quantidade válida." },
  InvalidOrders: { field: "orders", message: "Informe um número inteiro maior que zero." },
  DescriptionEmpty: {
    field: "description",
    message: "A descrição ficou vazia depois de omitir números sensíveis.",
  },
  CategoryTypeMismatch: {
    field: "categoryId",
    message: "A categoria não combina com o tipo do lançamento.",
  },
  SalesChannelRequired: { field: "salesChannelId", message: "Escolha o canal de venda." },
  UnitInactive: { field: "unitId", message: "Esta unidade está inativa." },
};

export const FALLBACK_ERROR = "Não foi possível salvar. Tente de novo.";

/** Edição do lançamento no painel (RF23). Só é montado para quem tem `canEdit`. */
export function EntryForm({
  entry,
  options,
  onSaved,
  onReload,
  onCancel,
}: {
  entry: EntryDetail;
  options: EntryOptions;
  onSaved: (saved: EntryDetail) => void;
  onReload: (current: EntryDetail) => void;
  onCancel: () => void;
}) {
  const form = useForm<EntryFormValues>({ defaultValues: initialValues(entry) });
  const { control, register, setError, clearErrors, watch, formState } = form;
  const errors = formState.errors;
  const update = useUpdateEntry();
  const [stale, setStale] = useState<EntryDetail | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Trava síncrona: dois cliques no mesmo instante chegam antes de o React desabilitar o botão.
  const sending = useRef(false);
  const type = watch("type");
  const busy = update.isPending;
  // Unidade de medida antiga, fora da lista fechada: continua escolhida e não vai no patch (R6).
  const legacyUnit = entry.quantityUnit ?? "";

  function apiMessage(error: ApiError, field: FormField | null): string {
    const body = error.body as { code?: unknown; reason?: unknown } | undefined;
    if (error.status === 422 && body?.code === "invalid_entry") {
      const known = typeof body.reason === "string" ? DOMAIN_ERRORS[body.reason] : undefined;
      if (known?.field) setError(known.field, { message: known.message });
      return known && known.field === null ? known.message : "";
    }
    if (body?.code === "context_changed") return error.message;
    void field;
    return FALLBACK_ERROR;
  }

  async function send(markReviewed: boolean) {
    if (sending.current) return;
    clearErrors();
    setFormError(null);
    setStale(null);
    const values = form.getValues();
    const patch = buildPatch(values, entry);
    const problems = localErrors(values, patch, options);
    const parsed = entryPatchSchema.safeParse(patch);
    for (const [field, message] of Object.entries(problems)) {
      setError(field as FormField, { message });
    }
    if (Object.keys(problems).length > 0) return;
    if (!parsed.success) {
      setFormError("Confira os campos preenchidos.");
      return;
    }
    if (Object.keys(patch).length === 0 && !markReviewed) {
      setFormError("Nenhuma alteração para salvar.");
      return;
    }
    sending.current = true;
    try {
      const saved = await update.mutateAsync({
        id: entry.id,
        body: { expectedVersion: entry.version, patch: parsed.data, markReviewed },
      });
      onSaved(saved);
    } catch (error) {
      const current = isEntryStale(error);
      if (current) setStale(current);
      else if (error instanceof ApiError) setFormError(apiMessage(error, null) || null);
      else setFormError(FALLBACK_ERROR);
    } finally {
      sending.current = false;
    }
  }

  const invalid = (field: FormField) => (errors[field] ? true : undefined);
  const message = (field: FormField) => errors[field]?.message;
  const categoryOptions = options.categories;

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send(false);
      }}
    >
      {stale && <StaleNotice current={stale} onReload={onReload} />}
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="entry-type" label="Tipo" error={message("type")}>
          <NativeSelect id="entry-type" {...register("type")}>
            <option value="expense">Despesa</option>
            <option value="revenue">Receita</option>
          </NativeSelect>
        </Field>
        <Field id="entry-amount" label="Valor bruto" error={message("amountCents")}>
          <Controller
            control={control}
            name="amountCents"
            render={({ field }) => (
              <MoneyInput
                id="entry-amount"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={invalid("amountCents")}
              />
            )}
          />
        </Field>
        <Field id="entry-occurred" label="Data" error={message("occurredOn")}>
          <Input
            id="entry-occurred"
            type="date"
            aria-invalid={invalid("occurredOn")}
            {...register("occurredOn")}
          />
        </Field>
        <Field id="entry-paid" label="Data de pagamento" error={message("paidOn")}>
          <Input
            id="entry-paid"
            type="date"
            aria-invalid={invalid("paidOn")}
            {...register("paidOn")}
          />
        </Field>
      </div>

      <Field id="entry-description" label="Descrição" error={message("description")}>
        <Input
          id="entry-description"
          maxLength={200}
          aria-invalid={invalid("description")}
          {...register("description")}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="entry-category" label="Categoria" error={message("categoryId")}>
          <NativeSelect id="entry-category" {...register("categoryId")}>
            {entry.category === null && <option value="">Sem categoria</option>}
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="entry-supplier" label="Fornecedor" error={message("supplier")}>
          <Controller
            control={control}
            name="supplier"
            render={({ field }) => (
              <SupplierField
                id="entry-supplier"
                suppliers={options.suppliers}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </Field>
        <Field id="entry-payment" label="Forma de pagamento" error={message("paymentMethodId")}>
          <NativeSelect id="entry-payment" {...register("paymentMethodId")}>
            <option value="">Nenhuma</option>
            {options.paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {type === "revenue" && (
          <>
            <Field id="entry-channel" label="Canal de venda" error={message("salesChannelId")}>
              <NativeSelect id="entry-channel" {...register("salesChannelId")}>
                <option value="">Nenhum</option>
                {options.salesChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="entry-orders" label="Pedidos" error={message("orders")}>
              <Input
                id="entry-orders"
                inputMode="numeric"
                aria-invalid={invalid("orders")}
                {...register("orders")}
              />
            </Field>
          </>
        )}
        <Field id="entry-quantity" label="Quantidade" error={message("quantity")}>
          <Input
            id="entry-quantity"
            inputMode="decimal"
            aria-invalid={invalid("quantity")}
            {...register("quantity")}
          />
        </Field>
        <Field id="entry-quantity-unit" label="Unidade de medida" error={message("quantityUnit")}>
          <NativeSelect
            id="entry-quantity-unit"
            aria-invalid={invalid("quantityUnit")}
            {...register("quantityUnit")}
          >
            <option value="">Nenhuma</option>
            {legacyUnit !== "" && !QUANTITY_UNITS.some((unit) => unit === legacyUnit) && (
              <option value={legacyUnit}>{legacyUnit}</option>
            )}
            {QUANTITY_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="entry-unit" label="Unidade" error={message("unitId")}>
          <NativeSelect id="entry-unit" {...register("unitId")}>
            {options.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Salvar
        </Button>
        {entry.flags.length > 0 && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void send(true)}>
            Marcar como revisado
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
