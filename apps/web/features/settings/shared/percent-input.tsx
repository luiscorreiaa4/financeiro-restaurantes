"use client";

import { formatBp, parsePercentToBp } from "@app/core";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  label: string;
  /** Pontos-base (320 = 3,20 %), ou `null` com o campo vazio ou inválido. */
  value: number | null;
  onChange: (bp: number | null) => void;
  disabled?: boolean;
  readOnly?: boolean;
};

const INVALID_MESSAGE = "Informe um percentual entre 0 e 100, com até duas casas.";

/** Texto do campo a partir do valor: "3,20" (sem o sinal de %). */
function textOf(bp: number | null): string {
  return bp === null ? "" : formatBp(bp).replace(" %", "");
}

/**
 * Campo de percentual ("3,2" vale 3,20 %). A conversão é do `core` (`parsePercentToBp`): a tela
 * não faz conta, só guarda o texto digitado e emite pontos-base inteiros (RF08.R3, CA05).
 */
export function PercentInput({ label, value, onChange, disabled, readOnly }: Props) {
  const id = useId();
  const [text, setText] = useState(() => textOf(value));
  const [invalid, setInvalid] = useState(false);

  // Só ressincroniza quando o valor de fora muda para outro que não é o do texto atual
  // (ex.: formulário recarregado); digitar não dispara isso.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const parsed = parsePercentToBp(text);
    if (value !== (parsed.ok ? parsed.value : null)) {
      setText(textOf(value));
      setInvalid(false);
    }
  }

  function handleChange(next: string) {
    setText(next);
    const result = parsePercentToBp(next);
    if (next.trim() === "") {
      setInvalid(false);
      onChange(null);
      return;
    }
    setInvalid(!result.ok);
    onChange(result.ok ? result.value : null);
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => handleChange(event.target.value)}
      />
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {INVALID_MESSAGE}
        </p>
      )}
    </div>
  );
}
