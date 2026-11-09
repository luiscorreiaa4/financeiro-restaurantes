"use client";

import {
  BRAZILIAN_STATES,
  REVENUE_RANGES,
  type RevenueRange,
  SEGMENTS,
  type Segment,
  type SignupFieldErrors,
  type SignupMode,
  TAX_REGIME_CHOICES,
  type TaxRegimeChoice,
  validateSignupInput,
} from "@app/core";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  type FieldErrors,
  FormAlert,
  SelectField,
  TextField,
  TOUCH,
} from "./form-fields";
import {
  CHECK_FIELDS,
  type CompanyPayload,
  createSignupApi,
  fieldErrorMessage,
  type SignupApi,
  signupErrorCode,
  signupErrorMessage,
  signupFieldErrors,
} from "./signup-api";

// Rótulos em português dos valores do core (RF01.R4, R5, R6). `Record` garante que nenhum falta.
const SEGMENT_LABELS: Record<Segment, string> = {
  restaurant: "Restaurante",
  bar: "Bar",
  snack_bar: "Lanchonete",
  pizzeria: "Pizzaria",
  bakery: "Padaria",
  cafe: "Cafeteria",
  burger_joint: "Hamburgueria",
  food_truck: "Food truck",
  other: "Outro",
};

const TAX_REGIME_LABELS: Record<TaxRegimeChoice, string> = {
  mei: "MEI",
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  not_sure: "Não sei",
};

const REVENUE_LABELS: Record<RevenueRange, string> = {
  up_to_30k: "Até R$ 30 mil",
  from_30k_to_100k: "De R$ 30 mil a R$ 100 mil",
  from_100k_to_300k: "De R$ 100 mil a R$ 300 mil",
  above_300k: "Acima de R$ 300 mil",
  prefer_not_to_say: "Prefiro não informar",
};

const options = <K extends string>(values: readonly K[], labels?: Record<K, string>) =>
  values.map((value) => ({ value, label: labels ? labels[value] : value }));

const SEGMENT_OPTIONS = options(SEGMENTS, SEGMENT_LABELS);
const TAX_REGIME_OPTIONS = options(TAX_REGIME_CHOICES, TAX_REGIME_LABELS);
const REVENUE_OPTIONS = options(REVENUE_RANGES, REVENUE_LABELS);
const UF_OPTIONS = options(BRAZILIAN_STATES);

export const TERMS_LABEL = "Li e aceito os Termos de Uso e a Política de Privacidade";

export type CompanyValues = {
  tradeName: string;
  legalName: string;
  cnpj: string;
  segment: string;
  taxRegime: string;
  revenueRange: string;
  unitName: string;
  /** Depois que o dono mexe no nome da unidade, o nome fantasia não o sobrescreve mais (R7). */
  unitNameEdited: boolean;
  city: string;
  uf: string;
  /** Sem valor pré-marcado (R13, CA06). */
  termsAccepted: boolean;
};

export const EMPTY_COMPANY: CompanyValues = {
  tradeName: "",
  legalName: "",
  cnpj: "",
  segment: "",
  taxRegime: "",
  revenueRange: "",
  unitName: "",
  unitNameEdited: false,
  city: "",
  uf: "",
  termsAccepted: false,
};

export type CompanyField = Exclude<keyof CompanyValues, "unitNameEdited">;

/** Caminho do campo no contrato da API, para ligar o erro ao campo certo. */
export const COMPANY_PATHS: Record<CompanyField, string> = {
  tradeName: "company.tradeName",
  legalName: "company.legalName",
  cnpj: "company.cnpj",
  segment: "company.segment",
  taxRegime: "company.taxRegime",
  revenueRange: "company.revenueRange",
  unitName: "unit.name",
  city: "unit.city",
  uf: "unit.uf",
  termsAccepted: "terms",
};

export function updateCompany(
  values: CompanyValues,
  field: CompanyField,
  value: string | boolean,
): CompanyValues {
  const next = { ...values, [field]: value };
  if (field === "tradeName" && !values.unitNameEdited) next.unitName = String(value);
  if (field === "unitName") next.unitNameEdited = true;
  return next;
}

export function toCompanyPayload(values: CompanyValues): CompanyPayload {
  return {
    company: {
      tradeName: values.tradeName,
      legalName: values.legalName,
      cnpj: values.cnpj,
      segment: values.segment,
      taxRegime: values.taxRegime,
      revenueRange: values.revenueRange,
    },
    unit: { name: values.unitName, city: values.city, uf: values.uf },
    terms: { accepted: values.termsAccepted },
  };
}

/** Códigos do core viram mensagens em português. */
export function toFieldMessages(errors: SignupFieldErrors): FieldErrors {
  const messages: FieldErrors = {};
  for (const [path, code] of Object.entries(errors)) {
    if (code) messages[path] = fieldErrorMessage(code);
  }
  return messages;
}

/** Mesmas regras da API, antes de enviar: o erro aparece na hora e nada do que foi digitado some. */
export function validateLocally(payload: unknown, mode: SignupMode): FieldErrors {
  const result = validateSignupInput(payload, mode);
  return result.ok ? {} : toFieldMessages(result.error);
}

/** Leva o foco ao primeiro campo marcado depois de uma tentativa de envio. */
export function useFocusFirstInvalid(errors: FieldErrors) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  return formRef;
}

/** Erros de conflito (409) marcam o campo com um texto curto; a mensagem completa vai no alerta. */
export const CONFLICT_FIELDS: Record<string, { path: string; message: string }> = {
  CNPJ_TAKEN: { path: "company.cnpj", message: "CNPJ já cadastrado." },
  PHONE_TAKEN: { path: "owner.phone", message: "Celular já em uso." },
};

type CompanyFieldsProps = {
  idPrefix: string;
  values: CompanyValues;
  errors: FieldErrors;
  disabled?: boolean;
  onChange: (field: CompanyField, value: string | boolean) => void;
};

/** Empresa e primeira unidade: comuns ao cadastro e a "Criar outra empresa". */
export function CompanyFields({
  idPrefix,
  values,
  errors,
  disabled,
  onChange,
}: CompanyFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const err = (field: CompanyField) => errors[COMPANY_PATHS[field]];
  return (
    <>
      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Empresa</legend>
        <TextField
          id={id("trade-name")}
          label="Nome fantasia"
          autoComplete="organization"
          value={values.tradeName}
          onChange={(v) => onChange("tradeName", v)}
          error={err("tradeName")}
        />
        <TextField
          id={id("legal-name")}
          label="Razão social (opcional)"
          value={values.legalName}
          onChange={(v) => onChange("legalName", v)}
          error={err("legalName")}
        />
        <TextField
          id={id("cnpj")}
          label="CNPJ (opcional)"
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          value={values.cnpj}
          onChange={(v) => onChange("cnpj", v)}
          error={err("cnpj")}
        />
        <SelectField
          id={id("segment")}
          label="Segmento"
          placeholder="Escolha o segmento"
          options={SEGMENT_OPTIONS}
          value={values.segment}
          onChange={(v) => onChange("segment", v)}
          error={err("segment")}
        />
        <SelectField
          id={id("tax-regime")}
          label="Regime tributário (opcional)"
          placeholder="Não informar"
          options={TAX_REGIME_OPTIONS}
          value={values.taxRegime}
          onChange={(v) => onChange("taxRegime", v)}
          error={err("taxRegime")}
        />
        <SelectField
          id={id("revenue-range")}
          label="Faixa de faturamento mensal (opcional)"
          placeholder="Não informar"
          options={REVENUE_OPTIONS}
          value={values.revenueRange}
          onChange={(v) => onChange("revenueRange", v)}
          error={err("revenueRange")}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Primeira unidade</legend>
        <TextField
          id={id("unit-name")}
          label="Nome da unidade"
          hint="É o nome que aparece nas confirmações do WhatsApp."
          value={values.unitName}
          onChange={(v) => onChange("unitName", v)}
          error={err("unitName")}
        />
        <TextField
          id={id("city")}
          label="Município"
          autoComplete="address-level2"
          value={values.city}
          onChange={(v) => onChange("city", v)}
          error={err("city")}
        />
        <SelectField
          id={id("uf")}
          label="Estado (UF)"
          placeholder="Escolha o estado"
          options={UF_OPTIONS}
          value={values.uf}
          onChange={(v) => onChange("uf", v)}
          error={err("uf")}
        />
      </fieldset>
    </>
  );
}

export function TermsField({
  id,
  checked,
  error,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CheckboxField
      id={id}
      label={TERMS_LABEL}
      checked={checked}
      error={error}
      disabled={disabled}
      onChange={onChange}
    >
      <p className="text-sm text-muted-foreground">
        Leia os{" "}
        <Link href="/termos" target="_blank" className="underline underline-offset-4">
          Termos de Uso
        </Link>{" "}
        e a{" "}
        <Link href="/privacidade" target="_blank" className="underline underline-offset-4">
          Política de Privacidade
        </Link>
        .
      </p>
    </CheckboxField>
  );
}

/** Tira o erro do campo que o usuário acabou de mexer. */
export function withoutError(errors: FieldErrors, path: string): FieldErrors {
  if (!(path in errors)) return errors;
  const { [path]: _removed, ...rest } = errors;
  return rest;
}

type Props = {
  api?: SignupApi;
  /** Depois de criar. O padrão é abrir a tela de boas-vindas (página inteira). */
  onDone?: () => void;
};

/**
 * "Criar outra empresa" (F1b, RF01): o usuário logado vira Dono de uma empresa nova.
 * Sem e-mail nem senha. O celular só aparece quando a API responde `phone_required`
 * (o `/api/me` não diz se o usuário tem celular).
 */
export function CompanyForm({ api, onDone }: Props) {
  const [client] = useState<SignupApi>(() => api ?? createSignupApi());
  const [values, setValues] = useState<CompanyValues>(EMPTY_COMPANY);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useFocusFirstInvalid(errors);

  function change(field: CompanyField, value: string | boolean) {
    setValues((current) => updateCompany(current, field, value));
    setErrors((current) => withoutError(current, COMPANY_PATHS[field]));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || done) return;
    const payload = { owner: needsPhone ? { phone } : {}, ...toCompanyPayload(values) };
    const local = validateLocally(payload, "existing_user");
    if (needsPhone && phone.trim() === "")
      local["owner.phone"] = fieldErrorMessage("phone_required");
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setAlert(CHECK_FIELDS);
      return;
    }

    setPending(true);
    setAlert(null);
    try {
      await client.submitCompany(payload);
      setDone(true);
      if (onDone) onDone();
      else window.location.assign("/bem-vindo");
    } catch (cause) {
      const fields = signupFieldErrors(cause);
      if (fields["owner.phone"]) setNeedsPhone(true);
      const messages = toFieldMessages(fields);
      const conflict = CONFLICT_FIELDS[signupErrorCode(cause) ?? ""];
      if (conflict) {
        messages[conflict.path] = conflict.message;
        if (conflict.path === "owner.phone") setNeedsPhone(true);
      }
      setErrors(messages);
      setAlert(signupErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="flex w-full max-w-md flex-col gap-6"
    >
      {needsPhone ? (
        <fieldset className="flex flex-col gap-4" disabled={pending || done}>
          <legend className="mb-2 text-base font-semibold">Responsável</legend>
          <TextField
            id="company-owner-phone"
            label="Celular (WhatsApp)"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            hint="O dono da empresa precisa de um celular para lançar pelo WhatsApp."
            value={phone}
            onChange={(v) => {
              setPhone(v);
              setErrors((current) => withoutError(current, "owner.phone"));
            }}
            error={errors["owner.phone"]}
          />
        </fieldset>
      ) : null}

      <CompanyFields
        idPrefix="company"
        values={values}
        errors={errors}
        disabled={pending || done}
        onChange={change}
      />

      <TermsField
        id="company-terms"
        checked={values.termsAccepted}
        error={errors.terms}
        disabled={pending || done}
        onChange={(checked) => change("termsAccepted", checked)}
      />

      <FormAlert message={alert} />

      <Button type="submit" className={`${TOUCH} w-full`} disabled={pending || done}>
        Criar empresa
      </Button>
    </form>
  );
}
