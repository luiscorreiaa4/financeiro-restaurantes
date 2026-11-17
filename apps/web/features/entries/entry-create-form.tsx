"use client";

import { QUANTITY_UNITS } from "@app/core";
import {
  type EntryDetail,
  type EntryOptions,
  entryCreateBodySchema,
  entryInvalidSchema,
} from "@app/core/contracts";
import Link from "next/link";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import { formatCents } from "@/lib/format";
import {
  activeUnits,
  buildCreateBody,
  type CreateFormValues,
  categoriesFor,
  createLocalErrors,
  defaultChannelFor,
  initialCreateValues,
  keepForNext,
  newRequestId,
} from "./create-form-values";
import { isAlreadySubmitted } from "./entries-api";
import { DOMAIN_ERRORS, FALLBACK_ERROR } from "./entry-form";
import { Field, NativeSelect } from "./entry-form-fields";
import type { FormField } from "./form-patch";
import { SupplierField } from "./supplier-field";
import { useCreateEntry } from "./use-entries";

const FORBIDDEN_MESSAGE = "Você não tem permissão para lançar nesta unidade.";
const READ_ONLY_MESSAGE = "Conta somente leitura: não é possível lançar.";
const ALREADY_SUBMITTED_MESSAGE = "Este lançamento já foi enviado, mas você não pode mais vê-lo.";

/** Formulário de lançamento manual (RF26): "Salvar" e "Salvar e lançar outro" (Obs2). */
export function EntryCreateForm({
  options,
  today,
  unitId,
  onSaved,
}: {
  options: EntryOptions;
  /** Hoje como data de negócio (`AAAA-MM-DD`). */
  today: string;
  /** Unidade do seletor da casca; "all" quando são todas. */
  unitId: string;
  /** Depois de "Salvar": a tela leva o usuário ao lançamento criado. */
  onSaved: (saved: EntryDetail) => void;
}) {
  const form = useForm<CreateFormValues>({
    defaultValues: initialCreateValues(options, { unitId, today }),
  });
  const { control, register, setError, clearErrors, setValue, watch, formState } = form;
  const errors = formState.errors;
  const create = useCreateEntry();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<EntryDetail | null>(null);
  // Muda a cada "lançar outro": refaz o campo de fornecedor, que guarda o texto digitado.
  const [round, setRound] = useState(0);
  // Chave da tentativa: só troca depois de um envio que deu certo (RF26.R3).
  const requestId = useRef<string | null>(null);
  // Trava síncrona: dois cliques no mesmo instante chegam antes de o React desabilitar o botão.
  const sending = useRef(false);
  // A data de pagamento acompanha a competência até o usuário mexer nela (RF26.R2).
  const paidTouched = useRef(false);

  const type = watch("type");
  const categoryId = watch("categoryId");
  const needsQuantity = options.categories.find((item) => item.id === categoryId)?.requiresQuantity;
  const busy = create.isPending;

  function onTypeChange(next: CreateFormValues["type"]) {
    const current = form.getValues();
    const compatible = categoriesFor(options, next).some((item) => item.id === current.categoryId);
    if (!compatible) setValue("categoryId", "");
    if (next === "expense") {
      setValue("salesChannelId", "");
      setValue("orders", "");
    } else if (current.salesChannelId === "") {
      setValue("salesChannelId", defaultChannelFor(options, current.unitId));
    }
  }

  // Quantidade e unidade de medida só existem na categoria que as exige: sai da tela, sai do corpo.
  function onCategoryChange(next: string) {
    if (options.categories.find((item) => item.id === next)?.requiresQuantity) return;
    setValue("quantity", "");
    setValue("quantityUnit", "");
  }

  function onUnitChange(next: string) {
    const current = form.getValues();
    if (current.type === "revenue" && current.salesChannelId === "") {
      setValue("salesChannelId", defaultChannelFor(options, next));
    }
  }

  function showApiError(error: unknown) {
    if (isAlreadySubmitted(error)) {
      setFormError(ALREADY_SUBMITTED_MESSAGE);
      return;
    }
    if (!(error instanceof ApiError)) {
      setFormError(FALLBACK_ERROR);
      return;
    }
    const body = error.body as { code?: unknown } | undefined;
    if (error.status === 422) {
      const invalid = entryInvalidSchema.safeParse(error.body);
      if (invalid.success) {
        const known = DOMAIN_ERRORS[invalid.data.reason];
        const field = (invalid.data.field ?? known?.field ?? null) as FormField | null;
        const message = known?.message ?? FALLBACK_ERROR;
        if (field) setError(field, { message });
        else setFormError(message);
        return;
      }
    }
    if (error.status === 403) {
      setFormError(body?.code === "account_read_only" ? READ_ONLY_MESSAGE : FORBIDDEN_MESSAGE);
      return;
    }
    // `context_changed` (empresa ou unidade trocada em outra aba): o digitado fica como está.
    setFormError(body?.code === "context_changed" ? error.message : FALLBACK_ERROR);
  }

  async function send(another: boolean) {
    if (sending.current) return;
    clearErrors();
    setFormError(null);
    setNotice(null);
    const values = form.getValues();
    const problems = createLocalErrors(values, options);
    for (const [field, message] of Object.entries(problems)) {
      setError(field as FormField, { message });
    }
    if (Object.keys(problems).length > 0) return;
    requestId.current ??= newRequestId();
    const parsed = entryCreateBodySchema.safeParse(buildCreateBody(values, requestId.current));
    if (!parsed.success) {
      setFormError("Confira os campos preenchidos.");
      return;
    }
    sending.current = true;
    try {
      const saved = await create.mutateAsync(parsed.data);
      requestId.current = null;
      if (another) {
        setNotice(saved);
        form.reset(keepForNext(values, options));
        paidTouched.current = false;
        setRound((n) => n + 1);
        document.getElementById("create-amount")?.focus();
      } else {
        onSaved(saved);
      }
    } catch (error) {
      showApiError(error);
    } finally {
      sending.current = false;
    }
  }

  const invalid = (field: FormField) => (errors[field] ? true : undefined);
  const message = (field: FormField) => errors[field]?.message;
  const units = activeUnits(options);

  return (
    <form
      noValidate
      className="flex max-w-2xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send(false);
      }}
    >
      {notice && (
        <div role="status" className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
          <p>
            {notice.type === "revenue" ? "Receita" : "Despesa"} de {formatCents(notice.amountCents)}{" "}
            salva (líquido {formatCents(notice.netCents)}){" "}
            <Link
              href={`/lancamentos?entry=${encodeURIComponent(notice.id)}`}
              className="underline"
            >
              Abrir
            </Link>
          </p>
          <p>Descrição registrada: {notice.description}</p>
          {notice.flags.includes("possible_duplicate") && (
            <p>Parece repetido: já existe um lançamento igual nas últimas 24 h</p>
          )}
          {notice.flags.includes("old_date") && <p>Data com mais de 60 dias</p>}
        </div>
      )}
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <Field id="create-type" label="Tipo" error={message("type")}>
        <NativeSelect
          id="create-type"
          {...register("type", { onChange: (event) => onTypeChange(event.target.value) })}
        >
          <option value="expense">Despesa</option>
          <option value="revenue">Receita</option>
        </NativeSelect>
      </Field>
      <Field id="create-amount" label="Valor" error={message("amountCents")}>
        <Controller
          control={control}
          name="amountCents"
          render={({ field }) => (
            <MoneyInput
              id="create-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={invalid("amountCents")}
            />
          )}
        />
      </Field>
      <Field id="create-description" label="Descrição" error={message("description")}>
        <Input
          id="create-description"
          maxLength={200}
          aria-invalid={invalid("description")}
          {...register("description")}
        />
      </Field>
      <Field id="create-occurred" label="Data de competência" error={message("occurredOn")}>
        <Input
          id="create-occurred"
          type="date"
          aria-invalid={invalid("occurredOn")}
          {...register("occurredOn", {
            onChange: (event) => {
              if (!paidTouched.current) setValue("paidOn", event.target.value);
            },
          })}
        />
      </Field>
      <Field id="create-category" label="Categoria" error={message("categoryId")}>
        <NativeSelect
          id="create-category"
          aria-invalid={invalid("categoryId")}
          {...register("categoryId", { onChange: (event) => onCategoryChange(event.target.value) })}
        >
          <option value="">Escolha…</option>
          {categoriesFor(options, type).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="create-unit" label="Unidade" error={message("unitId")}>
        <NativeSelect
          id="create-unit"
          aria-invalid={invalid("unitId")}
          {...register("unitId", { onChange: (event) => onUnitChange(event.target.value) })}
        >
          <option value="">Escolha…</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="create-supplier" label="Fornecedor" error={message("supplier")}>
        <Controller
          control={control}
          name="supplier"
          render={({ field }) => (
            <SupplierField
              key={round}
              id="create-supplier"
              suppliers={options.suppliers}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </Field>
      <Field id="create-payment" label="Forma de pagamento" error={message("paymentMethodId")}>
        <NativeSelect id="create-payment" {...register("paymentMethodId")}>
          <option value="">Nenhuma</option>
          {options.paymentMethods
            .filter((method) => method.active !== false)
            .map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      {type === "revenue" && (
        <>
          <Field id="create-channel" label="Canal de venda" error={message("salesChannelId")}>
            <NativeSelect
              id="create-channel"
              aria-invalid={invalid("salesChannelId")}
              {...register("salesChannelId")}
            >
              <option value="">Escolha…</option>
              {options.salesChannels
                .filter((channel) => channel.active !== false)
                .map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field id="create-orders" label="Pedidos" error={message("orders")}>
            <Input
              id="create-orders"
              inputMode="numeric"
              aria-invalid={invalid("orders")}
              {...register("orders")}
            />
          </Field>
        </>
      )}
      {needsQuantity && (
        <>
          <Field id="create-quantity" label="Quantidade" error={message("quantity")}>
            <Input
              id="create-quantity"
              inputMode="decimal"
              aria-invalid={invalid("quantity")}
              {...register("quantity")}
            />
          </Field>
          <Field
            id="create-quantity-unit"
            label="Unidade de medida"
            error={message("quantityUnit")}
          >
            <NativeSelect id="create-quantity-unit" {...register("quantityUnit")}>
              <option value="">Escolha…</option>
              {QUANTITY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </>
      )}
      <Field id="create-paid" label="Data de pagamento" error={message("paidOn")}>
        <Input
          id="create-paid"
          type="date"
          aria-invalid={invalid("paidOn")}
          {...register("paidOn", {
            onChange: () => {
              paidTouched.current = true;
            },
          })}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Salvar
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void send(true)}>
          Salvar e lançar outro
        </Button>
      </div>
    </form>
  );
}
