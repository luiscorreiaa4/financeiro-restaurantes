import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mensagens por campo, já em português. A chave é o caminho do campo (`company.cnpj`, ...). */
export type FieldErrors = Partial<Record<string, string>>;

/** Altura confortável para o toque no celular (RNF09). */
export const TOUCH = "h-11";

const errorId = (id: string) => `${id}-error`;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={errorId(id)} className="text-sm text-destructive">
      {message}
    </p>
  );
}

function invalidProps(id: string, message?: string) {
  return message ? { "aria-invalid": true, "aria-describedby": errorId(id) } : {};
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
} & Omit<ComponentProps<"input">, "id" | "value" | "onChange">;

export function TextField({ id, label, value, onChange, error, hint, ...rest }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className={TOUCH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...invalidProps(id, error)}
        {...rest}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
}: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${TOUCH} w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm`}
        {...invalidProps(id, error)}
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

type CheckboxFieldProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
  children?: ReactNode;
};

export function CheckboxField({
  id,
  label,
  checked,
  onChange,
  error,
  disabled,
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
          {...invalidProps(id, error)}
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
