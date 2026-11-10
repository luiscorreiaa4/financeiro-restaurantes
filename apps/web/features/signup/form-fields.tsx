"use client";

import { normalizeCityKey } from "@app/core";
import { Eye, EyeOff } from "lucide-react";
import {
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyMask, type Mask } from "@/lib/input-masks";

/** Mensagens por campo, já em português. A chave é o caminho do campo (`company.cnpj`, ...). */
export type FieldErrors = Partial<Record<string, string>>;

/** Altura confortável para o toque no celular (RNF09). */
export const TOUCH = "h-11";

const errorId = (id: string) => `${id}-error`;
const hintId = (id: string) => `${id}-hint`;

/** Avisa o leitor de tela quando faltam poucos caracteres para o limite. */
const COUNTER_ANNOUNCE_FROM = 10;

/**
 * O contêiner do erro existe sempre: uma região `aria-live` só é anunciada se já estava na página
 * antes de ganhar texto. O texto "Erro:" só aparece para o leitor de tela.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {message ? (
        <p id={errorId(id)} className="text-sm text-destructive">
          <span className="sr-only">Erro: </span>
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** `aria-*` do campo: inválido, obrigatório e descrição (dica, erro e o que a tela quiser somar). */
function fieldA11y(
  id: string,
  options: { hint?: boolean; error?: string; required?: boolean; extraDescribedBy?: string },
) {
  const described = [
    options.extraDescribedBy,
    options.hint ? hintId(id) : undefined,
    options.error ? errorId(id) : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-invalid": options.error ? true : undefined,
    "aria-required": options.required ? true : undefined,
    "aria-describedby": described || undefined,
  };
}

function Hint({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={hintId(id)} className="text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** "12 / 100" para a vista; o leitor de tela só ouve quando o limite está perto. */
function CharCounter({ length, max }: { length: number; max: number }) {
  const remaining = max - length;
  return (
    <>
      <p aria-hidden="true" className="text-right text-xs text-muted-foreground tabular-nums">
        {length} / {max}
      </p>
      <span aria-live="polite" className="sr-only">
        {remaining <= COUNTER_ANNOUNCE_FROM
          ? `Restam ${remaining} ${remaining === 1 ? "caractere" : "caracteres"}`
          : ""}
      </span>
    </>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  /** Campo obrigatório (`aria-required`). Os opcionais dizem "(opcional)" no rótulo. */
  required?: boolean;
  /** Formata enquanto o usuário digita ou cola (CNPJ, celular). */
  mask?: Mask;
} & Omit<ComponentProps<"input">, "id" | "value" | "onChange" | "required" | "ref">;

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  mask,
  maxLength,
  "aria-describedby": extraDescribedBy,
  "aria-invalid": ariaInvalid,
  ...rest
}: TextFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Depois de a máscara reescrever o texto, devolve o cursor para onde o usuário estava.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    const input = inputRef.current;
    if (caret !== null && input && document.activeElement === input) {
      input.setSelectionRange(caret, caret);
    }
  });

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!mask) {
      onChange(event.target.value);
      return;
    }
    const target = event.target;
    const result = applyMask(
      mask,
      value,
      target.value,
      target.selectionStart ?? target.value.length,
    );
    pendingCaret.current = result.caret;
    onChange(result.value);
    // Se o texto mascarado for igual ao anterior o React não redesenha, e o cursor ficaria no fim.
    rerender();
  }

  const a11y = fieldA11y(id, { hint: Boolean(hint), error, required, extraDescribedBy });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={inputRef}
        id={id}
        className={TOUCH}
        value={value}
        onChange={handleChange}
        maxLength={maxLength}
        {...a11y}
        aria-invalid={a11y["aria-invalid"] ?? ariaInvalid}
        {...rest}
      />
      <Hint id={id}>{hint}</Hint>
      {maxLength ? <CharCounter length={value.length} max={maxLength} /> : null}
      <FieldError id={id} message={error} />
    </div>
  );
}

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  /** Nome do botão; precisa ser diferente quando há dois campos de senha na tela. */
  toggleLabel?: string;
  autoComplete?: string;
  /** Texto de exemplo em palavras: pontinhos parecem uma senha já preenchida. */
  placeholder?: string;
  disabled?: boolean;
  onBlur?: () => void;
};

/** Senha com botão para mostrar ou ocultar (botão de alternância, com `aria-pressed`). */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  toggleLabel = "Mostrar senha",
  autoComplete = "new-password",
  placeholder,
  disabled,
  onBlur,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          className={`${TOUCH} pr-12`}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          {...fieldA11y(id, { hint: Boolean(hint), error, required })}
        />
        <button
          type="button"
          aria-label={toggleLabel}
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <Icon aria-hidden="true" className="size-5" />
        </button>
      </div>
      <Hint id={id}>{hint}</Hint>
      <FieldError id={id} message={error} />
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  autoComplete?: string;
  onBlur?: () => void;
};

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  disabled,
  required,
  autoComplete,
  onBlur,
}: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={`${TOUCH} w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm`}
        {...fieldA11y(id, { error, required })}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError id={id} message={error} />
    </div>
  );
}

type ComboboxFieldProps = {
  id: string;
  label: string;
  /** Item escolhido, ou "" quando nada foi escolhido. Só entra valor que está em `options`. */
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder: string;
  /** Texto quando o que o usuário digitou não casa com nenhum item. */
  emptyMessage: string;
  error?: string;
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  onBlur?: () => void;
};

/** Busca sem acento nem caixa: "sao jo" acha "São José". */
const matchesSearch = (item: string, query: string) =>
  normalizeCityKey(item).includes(normalizeCityKey(query));

/**
 * Lista com busca por digitação que só aceita um item da lista (DD-29): o texto digitado sem
 * escolher uma opção não vira valor. O `id` fica no campo de texto, que é quem o rótulo nomeia.
 */
export function ComboboxField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  emptyMessage,
  error,
  hint,
  disabled,
  required,
  onBlur,
}: ComboboxFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Combobox
        items={options}
        value={value === "" ? null : value}
        onValueChange={(next) => onChange(next ?? "")}
        filter={matchesSearch}
        disabled={disabled}
        autoHighlight
      >
        <ComboboxInput
          id={id}
          className={TOUCH}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          onBlur={onBlur}
          {...fieldA11y(id, { hint: Boolean(hint), error, required })}
        />
        <ComboboxContent>
          <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item} className="min-h-11 text-base md:text-sm">
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Hint id={id}>{hint}</Hint>
      <FieldError id={id} message={error} />
    </div>
  );
}

type CheckboxFieldProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  children?: ReactNode;
};

export function CheckboxField({
  id,
  label,
  checked,
  onChange,
  error,
  disabled,
  required,
  children,
}: CheckboxFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-11 items-center gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5 shrink-0 accent-primary"
          {...fieldA11y(id, { error, required })}
        />
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
      </div>
      {children}
      <FieldError id={id} message={error} />
    </div>
  );
}

/** Alerta geral do formulário (anunciado pelo leitor de tela). */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
