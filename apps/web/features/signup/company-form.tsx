"use client";

import {
  BRAZILIAN_STATES,
  loadMunicipalities,
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
import { CNPJ_MASK, PHONE_MASK } from "@/lib/input-masks";
import {
  CheckboxField,
  ComboboxField,
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
  // O município de outro estado não vale (DD-29): quem muda a UF escolhe o município de novo.
  if (field === "uf" && value !== values.uf) next.city = "";
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

/**
 * Mesmas regras da API, antes de enviar: o erro aparece na hora e nada do que foi digitado some.
 * `cities` é a lista da UF escolhida; enquanto ela não chega, a API é quem confere o município.
 */
export function validateLocally(
  payload: unknown,
  mode: SignupMode,
  cities?: readonly string[],
): FieldErrors {
  const result = validateSignupInput(payload, mode, { cities });
  return result.ok ? {} : toFieldMessages(result.error);
}

export type MunicipalitiesState = {
  /** `idle`: sem UF escolhida ainda. */
  status: "idle" | "loading" | "ready" | "error";
  cities: readonly string[] | undefined;
  retry: () => void;
};

type Loaded = { uf: string; cities?: readonly string[] };

/**
 * Lista oficial de municípios da UF escolhida (DD-29). Vem do pacote, em um pedaço por UF, então
 * não depende de rede externa; só falha se o próprio pedaço não baixar (aí o usuário tenta de novo).
 */
export function useMunicipalities(uf: string): MunicipalitiesState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const valid = (BRAZILIAN_STATES as readonly string[]).includes(uf);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` só força nova tentativa.
  useEffect(() => {
    if (!valid) return;
    let active = true;
    loadMunicipalities(uf).then(
      (cities) => active && setLoaded({ uf, cities }),
      () => active && setLoaded({ uf }),
    );
    return () => {
      active = false;
    };
  }, [uf, valid, attempt]);

  // Uma lista carregada para outra UF não vale: some assim que a UF muda.
  const current = loaded?.uf === uf ? loaded : null;
  const retry = () => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  };
  if (!valid) return { status: "idle", cities: undefined, retry };
  if (current === null) return { status: "loading", cities: undefined, retry };
  if (current.cities === undefined) return { status: "error", cities: undefined, retry };
  return { status: "ready", cities: current.cities, retry };
}

/**
 * Leva o foco ao primeiro campo marcado depois de uma tentativa de envio. Só roda quando a tela
 * chama `focusFirstInvalid()`: a validação ao sair do campo não pode roubar o foco de quem está
 * indo para o próximo campo.
 */
export function useFocusFirstInvalid() {
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);
  return { formRef, focusFirstInvalid: () => setAttempt((n) => n + 1) };
}

/** Resultado da validação de um campo só (ao sair dele): entra o erro novo, sai o que já passou. */
export function withFieldValidation(
  current: FieldErrors,
  validated: FieldErrors,
  path: string,
): FieldErrors {
  const message = validated[path];
  return message ? { ...current, [path]: message } : withoutError(current, path);
}

/** Campo de celular (WhatsApp) do cadastro e de "Criar outra empresa": mesma máscara e mesmos atributos. */
export function PhoneField({
  id,
  hint,
  value,
  onChange,
  onBlur,
  error,
}: {
  id: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
}) {
  return (
    <TextField
      id={id}
      label="Celular (WhatsApp)"
      required
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      mask={PHONE_MASK}
      placeholder="(11) 98765-4321"
      hint={hint}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      error={error}
    />
  );
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
  /** Municípios da UF escolhida (`useMunicipalities`); a tela também usa a lista para validar. */
  municipalities: MunicipalitiesState;
  onChange: (field: CompanyField, value: string | boolean) => void;
  /** Chamado quando o campo perde o foco: a tela valida só aquele campo. */
  onBlurField?: (field: CompanyField) => void;
};

// Limites de tamanho do RF01 (R1, R2, R7). O contador mostra quanto falta.
const TRADE_NAME_MAX = 100;
const LEGAL_NAME_MAX = 150;
const UNIT_NAME_MAX = 60;

const NO_CITIES: readonly string[] = [];
const CITY_PLACEHOLDERS: Record<MunicipalitiesState["status"], string> = {
  idle: "Escolha o estado primeiro",
  loading: "Carregando municípios…",
  ready: "Digite para buscar. Ex: Campinas",
  error: "Não foi possível carregar",
};
const CITY_HINTS: Record<MunicipalitiesState["status"], string | undefined> = {
  idle: "Escolha o estado (UF) para ver os municípios.",
  loading: undefined,
  ready: "Escolha o município na lista.",
  error: "Não conseguimos carregar a lista de municípios. Confira a conexão.",
};

/** Empresa e primeira unidade: comuns ao cadastro e a "Criar outra empresa". */
export function CompanyFields({
  idPrefix,
  values,
  errors,
  disabled,
  municipalities,
  onChange,
  onBlurField,
}: CompanyFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const err = (field: CompanyField) => errors[COMPANY_PATHS[field]];
  const blur = (field: CompanyField) => () => onBlurField?.(field);
  return (
    <>
      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Empresa</legend>
        <TextField
          id={id("trade-name")}
          label="Nome fantasia"
          required
          autoComplete="organization"
          placeholder="Ex: Cantina da Nonna"
          maxLength={TRADE_NAME_MAX}
          value={values.tradeName}
          onChange={(v) => onChange("tradeName", v)}
          onBlur={blur("tradeName")}
          error={err("tradeName")}
        />
        <TextField
          id={id("legal-name")}
          label="Razão social (opcional)"
          autoComplete="off"
          placeholder="Ex: Cantina da Nonna Alimentos LTDA"
          maxLength={LEGAL_NAME_MAX}
          value={values.legalName}
          onChange={(v) => onChange("legalName", v)}
          onBlur={blur("legalName")}
          error={err("legalName")}
        />
        <TextField
          id={id("cnpj")}
          label="CNPJ (opcional)"
          mask={CNPJ_MASK}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="00.000.000/0000-00"
          hint="Pode ter letras e números: a pontuação entra sozinha."
          value={values.cnpj}
          onChange={(v) => onChange("cnpj", v)}
          onBlur={blur("cnpj")}
          error={err("cnpj")}
        />
        <SelectField
          id={id("segment")}
          label="Segmento"
          required
          placeholder="Escolha o segmento"
          options={SEGMENT_OPTIONS}
          value={values.segment}
          onChange={(v) => onChange("segment", v)}
          onBlur={blur("segment")}
          error={err("segment")}
        />
        <SelectField
          id={id("tax-regime")}
          label="Regime tributário (opcional)"
          placeholder="Não informar"
          options={TAX_REGIME_OPTIONS}
          value={values.taxRegime}
          onChange={(v) => onChange("taxRegime", v)}
          onBlur={blur("taxRegime")}
          error={err("taxRegime")}
        />
        <SelectField
          id={id("revenue-range")}
          label="Faixa de faturamento mensal (opcional)"
          placeholder="Não informar"
          options={REVENUE_OPTIONS}
          value={values.revenueRange}
          onChange={(v) => onChange("revenueRange", v)}
          onBlur={blur("revenueRange")}
          error={err("revenueRange")}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Primeira unidade</legend>
        <TextField
          id={id("unit-name")}
          label="Nome da unidade"
          required
          placeholder="Ex: Matriz, Unidade Centro ou Filial Shopping"
          maxLength={UNIT_NAME_MAX}
          hint="É o nome que aparece nas confirmações do WhatsApp."
          value={values.unitName}
          onChange={(v) => onChange("unitName", v)}
          onBlur={blur("unitName")}
          error={err("unitName")}
        />
        <SelectField
          id={id("uf")}
          label="Estado (UF)"
          required
          autoComplete="address-level1"
          placeholder="Escolha o estado"
          options={UF_OPTIONS}
          value={values.uf}
          onChange={(v) => onChange("uf", v)}
          onBlur={blur("uf")}
          error={err("uf")}
        />
        <ComboboxField
          id={id("city")}
          label="Município"
          required
          placeholder={CITY_PLACEHOLDERS[municipalities.status]}
          emptyMessage="Nenhum município encontrado neste estado."
          hint={CITY_HINTS[municipalities.status]}
          options={municipalities.cities ?? NO_CITIES}
          disabled={municipalities.status !== "ready"}
          value={values.city}
          onChange={(v) => onChange("city", v)}
          onBlur={blur("city")}
          error={err("city")}
        />
        {municipalities.status === "error" ? (
          <Button type="button" variant="outline" className={TOUCH} onClick={municipalities.retry}>
            Tentar de novo
          </Button>
        ) : null}
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
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const municipalities = useMunicipalities(values.uf);

  function change(field: CompanyField, value: string | boolean) {
    setValues((current) => updateCompany(current, field, value));
    setErrors((current) => withoutError(current, COMPANY_PATHS[field]));
  }

  /** Mesmas regras do envio, para todos os campos; quem chama escolhe o que mostrar. */
  function validateAll(): FieldErrors {
    const payload = { owner: needsPhone ? { phone } : {}, ...toCompanyPayload(values) };
    const local = validateLocally(payload, "existing_user", municipalities.cities);
    if (needsPhone && phone.trim() === "")
      local["owner.phone"] = fieldErrorMessage("phone_required");
    return local;
  }

  /** Ao sair do campo: valida só ele (o aceite dos termos só é cobrado no envio). */
  function blurPath(path: string) {
    const validated = validateAll();
    setErrors((current) => withFieldValidation(current, validated, path));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || done) return;
    const payload = { owner: needsPhone ? { phone } : {}, ...toCompanyPayload(values) };
    const local = validateAll();
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setAlert(CHECK_FIELDS);
      focusFirstInvalid();
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
      focusFirstInvalid();
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
          <PhoneField
            id="company-owner-phone"
            hint="O dono da empresa precisa de um celular para lançar pelo WhatsApp."
            value={phone}
            onChange={(v) => {
              setPhone(v);
              setErrors((current) => withoutError(current, "owner.phone"));
            }}
            onBlur={() => blurPath("owner.phone")}
            error={errors["owner.phone"]}
          />
        </fieldset>
      ) : null}

      <CompanyFields
        idPrefix="company"
        values={values}
        errors={errors}
        disabled={pending || done}
        municipalities={municipalities}
        onChange={change}
        onBlurField={(field) => blurPath(COMPANY_PATHS[field])}
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
