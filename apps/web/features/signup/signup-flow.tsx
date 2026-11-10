"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { OtpCodeField } from "@/components/otp-code-field";
import { Button } from "@/components/ui/button";
import {
  COMPANY_PATHS,
  CONFLICT_FIELDS,
  type CompanyField,
  CompanyFields,
  type CompanyValues,
  EMPTY_COMPANY,
  TermsField,
  toCompanyPayload,
  toFieldMessages,
  updateCompany,
  useFocusFirstInvalid,
  validateLocally,
  withoutError,
} from "./company-form";
import { type FieldErrors, FormAlert, TextField, TOUCH } from "./form-fields";
import {
  CHECK_FIELDS,
  createSignupApi,
  type SignupApi,
  type SignupPayload,
  signupErrorCode,
  signupErrorMessage,
  signupFieldErrors,
} from "./signup-api";

/** Reenvio liberado 60 s depois de cada envio (RF01.R10). A API também limita. */
export const SIGNUP_RESEND_SECONDS = 60;

// Igual para e-mail novo, já cadastrado ou limitado: a tela nunca revela quem tem conta (RF02.R1).
const CODE_SENT =
  "Se este e-mail puder ser usado no cadastro, você vai receber um código de 6 dígitos. Confira também a caixa de spam.";
const WRONG_CODE = "Código incorreto ou vencido. Confira os 6 dígitos ou peça um novo código.";
const INCOMPLETE_CODE = "Digite os 6 dígitos do código.";
const PASSWORDS_DIFFER = "As senhas não conferem.";

type Owner = { name: string; phone: string; password: string; passwordConfirm: string };
const EMPTY_OWNER: Owner = { name: "", phone: "", password: "", passwordConfirm: "" };
const OWNER_PATHS: Record<keyof Owner, string> = {
  name: "owner.name",
  phone: "owner.phone",
  password: "owner.password",
  passwordConfirm: "owner.passwordConfirm",
};

type Props = {
  api?: SignupApi;
  /** Depois de criar a conta (já logado). O padrão é abrir /bem-vindo (página inteira). */
  onDone?: () => void;
};

/**
 * Autocadastro do dono (F1b, RF01): e-mail e código primeiro; depois um formulário único com
 * dono, empresa, primeira unidade e aceite. Ao concluir a API já abre a sessão.
 */
export function SignupFlow({ api, onDone }: Props) {
  const [client] = useState<SignupApi>(() => api ?? createSignupApi());
  // Passo 1: e-mail e código.
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [receipt, setReceipt] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  // Trava síncrona: o sexto dígito e o botão podem disparar juntos, e o código tem poucas tentativas.
  const confirmingRef = useRef(false);
  // Passo 2: formulário. Fica guardado mesmo se for preciso confirmar o e-mail de novo.
  const [owner, setOwner] = useState<Owner>(EMPTY_OWNER);
  const [company, setCompany] = useState<CompanyValues>(EMPTY_COMPANY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useFocusFirstInvalid(errors);

  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  // O campo fica travado durante o envio; ao liberar (código recusado), o foco volta para ele.
  useEffect(() => {
    if (codeSent && !blocked && !sending) codeRef.current?.focus();
  }, [codeSent, blocked, sending]);

  function resetCode() {
    setCodeSent(false);
    setCode("");
    setBlocked(false);
    setSecondsLeft(0);
  }

  function changeEmail(value: string) {
    setEmail(value);
    // Outro e-mail pede outro código: volta ao envio.
    if (codeSent) resetCode();
    setCodeError(null);
  }

  async function sendCode() {
    if (sending) return;
    setSending(true);
    setCodeError(null);
    try {
      await client.requestCode(email.trim());
      setCodeSent(true);
      setBlocked(false);
      setCode("");
      setSecondsLeft(SIGNUP_RESEND_SECONDS);
    } catch (cause) {
      setCodeError(signupErrorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  /** Recebe o código por argumento quando vem do sexto dígito: o estado ainda não atualizou. */
  async function confirmCode(value: string = code) {
    if (sending || blocked || confirmingRef.current) return;
    if (value.length !== 6) {
      setCodeError(INCOMPLETE_CODE);
      return;
    }
    confirmingRef.current = true;
    setSending(true);
    setCodeError(null);
    try {
      // Uma chamada por código completo ou clique, nunca repetida: o código aceito não vale de novo.
      const result = await client.verifyCode(email.trim(), value);
      setReceipt(result.receipt);
      setAlert(null);
    } catch (cause) {
      const failure = signupErrorCode(cause);
      if (failure === "INVALID_CODE") {
        setCodeError(WRONG_CODE);
      } else {
        setCodeError(signupErrorMessage(cause));
        if (failure === "TOO_MANY_ATTEMPTS") {
          setBlocked(true);
          setCode("");
        }
      }
    } finally {
      confirmingRef.current = false;
      setSending(false);
    }
  }

  async function onEmailSubmit(event: FormEvent) {
    event.preventDefault();
    if (codeSent) await confirmCode();
    else await sendCode();
  }

  function changeOwner(field: keyof Owner, value: string) {
    setOwner((current) => ({ ...current, [field]: value }));
    setErrors((current) => withoutError(current, OWNER_PATHS[field]));
  }

  function changeCompany(field: CompanyField, value: string | boolean) {
    setCompany((current) => updateCompany(current, field, value));
    setErrors((current) => withoutError(current, COMPANY_PATHS[field]));
  }

  async function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || done || receipt === null) return;
    const normalizedEmail = email.trim();
    const payload: SignupPayload = {
      receipt,
      email: normalizedEmail,
      owner: {
        name: owner.name,
        email: normalizedEmail,
        phone: owner.phone,
        password: owner.password,
      },
      ...toCompanyPayload(company),
    };
    const local = validateLocally(payload, "new_user");
    if (owner.password !== "" && owner.password !== owner.passwordConfirm) {
      local["owner.passwordConfirm"] = PASSWORDS_DIFFER;
    }
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setAlert(CHECK_FIELDS);
      return;
    }

    setSubmitting(true);
    setAlert(null);
    try {
      await client.submitSignup(payload);
      setDone(true);
      if (onDone) onDone();
      else window.location.assign("/bem-vindo");
    } catch (cause) {
      const failure = signupErrorCode(cause);
      if (failure === "RECEIPT_INVALID") {
        // Comprovante vencido ou usado: confirma o e-mail de novo, sem perder o formulário.
        setReceipt(null);
        resetCode();
        setCodeError(signupErrorMessage(cause));
        return;
      }
      const messages = toFieldMessages(signupFieldErrors(cause));
      const conflict = CONFLICT_FIELDS[failure ?? ""];
      if (conflict) messages[conflict.path] = conflict.message;
      setErrors(messages);
      setAlert(signupErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt === null) {
    const codeInvalid = codeSent && codeError !== null && !blocked ? true : undefined;
    return (
      <form onSubmit={onEmailSubmit} noValidate className="flex w-full max-w-md flex-col gap-4">
        <TextField
          id="signup-email"
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={changeEmail}
          aria-invalid={!codeSent && codeError ? true : undefined}
          aria-describedby={!codeSent && codeError ? "signup-code-alert" : undefined}
        />

        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {codeSent ? CODE_SENT : null}
        </p>

        {codeSent ? (
          <OtpCodeField
            id="signup-code"
            ref={codeRef}
            value={code}
            onChange={setCode}
            onComplete={confirmCode}
            disabled={blocked || sending}
            invalid={codeInvalid}
            describedBy={codeInvalid ? "signup-code-alert" : undefined}
          />
        ) : null}

        {codeError ? (
          <p id="signup-code-alert" role="alert" className="text-sm text-destructive">
            {codeError}
          </p>
        ) : null}

        <Button type="submit" className={`${TOUCH} w-full`} disabled={sending || blocked}>
          {codeSent ? "Confirmar código" : "Enviar código"}
        </Button>

        {codeSent ? (
          <Button
            type="button"
            variant="outline"
            className={`${TOUCH} w-full`}
            disabled={sending || counting}
            onClick={sendCode}
          >
            {counting ? `Reenviar código em ${secondsLeft} s` : "Reenviar código"}
          </Button>
        ) : null}
      </form>
    );
  }

  const locked = submitting || done;
  return (
    <form
      ref={formRef}
      onSubmit={onFormSubmit}
      noValidate
      className="flex w-full max-w-md flex-col gap-6"
    >
      <p className="text-sm text-muted-foreground">
        E-mail confirmado: <span className="font-medium break-all text-foreground">{email}</span>
      </p>

      <fieldset className="flex flex-col gap-4" disabled={locked}>
        <legend className="mb-2 text-base font-semibold">Responsável</legend>
        <TextField
          id="signup-owner-name"
          label="Nome completo"
          autoComplete="name"
          value={owner.name}
          onChange={(v) => changeOwner("name", v)}
          error={errors["owner.name"]}
        />
        <TextField
          id="signup-owner-phone"
          label="Celular (WhatsApp)"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          hint="É o número que vai lançar pelo WhatsApp."
          value={owner.phone}
          onChange={(v) => changeOwner("phone", v)}
          error={errors["owner.phone"]}
        />
        <TextField
          id="signup-owner-password"
          label="Senha (opcional)"
          type="password"
          autoComplete="new-password"
          hint="Sem senha, você entra com um código enviado por e-mail."
          value={owner.password}
          onChange={(v) => changeOwner("password", v)}
          error={errors["owner.password"]}
        />
        <TextField
          id="signup-owner-password-confirm"
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          value={owner.passwordConfirm}
          onChange={(v) => changeOwner("passwordConfirm", v)}
          error={errors["owner.passwordConfirm"]}
        />
      </fieldset>

      <CompanyFields
        idPrefix="signup"
        values={company}
        errors={errors}
        disabled={locked}
        onChange={changeCompany}
      />

      <TermsField
        id="signup-terms"
        checked={company.termsAccepted}
        error={errors.terms}
        disabled={locked}
        onChange={(checked) => changeCompany("termsAccepted", checked)}
      />

      <FormAlert message={alert} />

      <Button type="submit" className={`${TOUCH} w-full`} disabled={locked}>
        Criar conta
      </Button>
    </form>
  );
}
