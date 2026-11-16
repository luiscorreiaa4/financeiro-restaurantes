"use client";

import { parseBRLInput } from "@app/core";
import { type ClipboardEvent, type ComponentProps, useState } from "react";
import { Input } from "@/components/ui/input";
import { maskBRL } from "@/lib/input-masks";

type Props = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
  /** Centavos inteiros, ou `null` para campo vazio ou incompleto. */
  value: number | null;
  onChange: (cents: number | null) => void;
};

/** Texto com sempre dois decimais, só com divisão inteira (sem `float`). */
function formatCentsText(cents: number): string {
  const reais = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return maskBRL(`${reais},${fraction}`);
}

function centsOf(text: string): number | null {
  const parsed = parseBRLInput(text);
  return parsed.ok ? parsed.value : null;
}

/**
 * Campo de valor em reais com máscara brasileira. Emite centavos inteiros (RNF13.R1) e `null`
 * quando está vazio ou incompleto ("1.234,"). O texto digitado fica no campo; só é reescrito
 * quando o valor de fora muda para outro que não é o do texto atual.
 */
export function MoneyInput({ value, onChange, onBlur, ...rest }: Props) {
  const [text, setText] = useState(() => (value === null ? "" : formatCentsText(value)));
  // Valor de fora diferente do que o texto representa (ex.: "Recarregar" trouxe a versão atual).
  if (value !== centsOf(text) && !(value === null && text !== "" && centsOf(text) === null)) {
    setText(value === null ? "" : formatCentsText(value));
  }

  function commit(next: string) {
    setText(next);
    onChange(centsOf(next));
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    const parsed = parseBRLInput(pasted);
    if (!parsed.ok) return;
    event.preventDefault();
    commit(formatCentsText(parsed.value));
  }

  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(event) => commit(maskBRL(event.target.value))}
      onPaste={handlePaste}
      onBlur={(event) => {
        // Ao sair, completa os decimais ("12,5" vira "12,50").
        const cents = centsOf(text);
        if (cents !== null) setText(formatCentsText(cents));
        onBlur?.(event);
      }}
    />
  );
}
