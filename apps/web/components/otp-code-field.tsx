"use client";

import { ClipboardPaste } from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const OTP_LENGTH = 6;

/** Só dígitos, no máximo 6: "123 456" e "123-456" viram "123456". */
export function sanitizeOtp(text: string): string {
  return text.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export type OtpCodeFieldProps = {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** Chamado quando o código passa a ter 6 dígitos (digitado, editado ou colado). */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Aponta para a primeira caixa. */
  ref?: Ref<HTMLInputElement>;
};

const POSITIONS = Array.from({ length: OTP_LENGTH }, (_, index) => index);

// Altura de toque (RNF09). A largura vem da grade: seis colunas iguais, cabem em 360 px.
const BOX = "h-12 px-0 text-center text-lg tabular-nums md:text-lg";

/**
 * Código de 6 dígitos em seis caixas, cada uma um campo de verdade: dá para clicar numa e trocar só
 * aquele dígito. O valor é uma string só (os dígitos em ordem); apagar um dígito do meio puxa os
 * seguintes para a esquerda, então nunca há caixa vazia entre duas preenchidas.
 */
export function OtpCodeField({
  id,
  label = "Código de 6 dígitos",
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  describedBy,
  ref,
}: OtpCodeFieldProps) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  useImperativeHandle(ref, () => boxes.current[0] as HTMLInputElement, []);

  // Só depois de montar: no servidor não há área de transferência, e o HTML precisa bater.
  const [canPaste, setCanPaste] = useState(false);
  useEffect(() => {
    setCanPaste(typeof navigator.clipboard?.readText === "function");
  }, []);

  function focusBox(index: number) {
    boxes.current[Math.max(0, Math.min(index, OTP_LENGTH - 1))]?.focus();
  }

  /** Grava o novo código e avisa quando ele fecha os 6 dígitos. */
  function commit(next: string) {
    if (next === value) return;
    onChange(next);
    if (next.length === OTP_LENGTH) onComplete?.(next);
  }

  /** Escreve `digits` a partir da caixa `index`, sem deixar buraco no código. */
  function writeAt(index: number, digits: string, keepTail: boolean) {
    const start = Math.min(index, value.length);
    const tail = keepTail ? value.slice(start + digits.length) : "";
    commit(sanitizeOtp(value.slice(0, start) + digits + tail));
    focusBox(start + digits.length);
  }

  function removeAt(index: number) {
    commit(value.slice(0, index) + value.slice(index + 1));
  }

  function onBoxChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    if (raw === "") {
      if (index < value.length) removeAt(index);
      return;
    }
    // Com a caixa já preenchida, o texto novo traz o dígito antigo junto: vale o que foi digitado.
    const typed = (event.nativeEvent as InputEvent).data;
    const digits = typed && /^\d$/.test(typed) ? typed : sanitizeOtp(raw);
    if (digits === "") return; // letra ou símbolo: a caixa volta ao que era
    // Um dígito troca o da caixa; vários (preenchimento do sistema) entram a partir dela.
    writeAt(index, digits, digits.length === 1);
  }

  function onBoxKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "Backspace":
        event.preventDefault();
        if (index < value.length) {
          removeAt(index);
        } else if (index > 0) {
          removeAt(index - 1);
          focusBox(index - 1);
        }
        break;
      case "Delete":
        event.preventDefault();
        if (index < value.length) removeAt(index);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusBox(index - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        focusBox(Math.min(index + 1, value.length));
        break;
    }
  }

  function onBoxPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const digits = sanitizeOtp(event.clipboardData.getData("text/plain"));
    if (digits === "") return;
    // Um código inteiro colado em qualquer caixa troca o código todo.
    if (digits.length === OTP_LENGTH) {
      commit(digits);
      focusBox(OTP_LENGTH - 1);
    } else {
      writeAt(index, digits, false);
    }
  }

  async function pasteFromClipboard() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Permissão negada: a pessoa cola à mão numa das caixas.
    }
    const digits = sanitizeOtp(text);
    focusBox(digits === "" ? value.length : digits.length);
    if (digits !== "") commit(digits);
  }

  const boxInvalid = invalid ? true : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="grid max-w-xs grid-cols-6 gap-2">
        {POSITIONS.map((index) => (
          <Input
            key={index}
            id={index === 0 ? id : undefined}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            aria-label={index === 0 ? undefined : `Dígito ${index + 1} de ${OTP_LENGTH}`}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            inputMode="numeric"
            spellCheck={false}
            className={BOX}
            disabled={disabled}
            aria-invalid={boxInvalid}
            aria-describedby={describedBy}
            value={value[index] ?? ""}
            onChange={(event) => onBoxChange(index, event)}
            onKeyDown={(event) => onBoxKeyDown(index, event)}
            onPaste={(event) => onBoxPaste(index, event)}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => {
              // Caixa depois da próxima vazia: leva a pessoa para onde o próximo dígito entra.
              if (index > value.length) focusBox(value.length);
              else event.currentTarget.select();
            }}
          />
        ))}
      </div>
      {canPaste ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          disabled={disabled}
          onClick={pasteFromClipboard}
        >
          <ClipboardPaste aria-hidden="true" />
          Colar código
        </Button>
      ) : null}
    </div>
  );
}
