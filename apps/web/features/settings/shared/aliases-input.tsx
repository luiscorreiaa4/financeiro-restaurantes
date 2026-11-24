"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  label?: string;
  value: readonly string[];
  onChange: (aliases: string[]) => void;
  max: number;
  disabled?: boolean;
};

/** Apelidos separados por vírgula ("cartão, maquininha"). Quantidade e tamanho são do servidor. */
export function AliasesInput({ label = "Apelidos", value, onChange, max, disabled }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value.join(", ")}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) =>
          onChange(event.target.value.split(",").map((alias) => alias.trimStart()))
        }
      />
      <p className="text-xs text-muted-foreground">Separe por vírgula. Até {max} apelidos.</p>
    </div>
  );
}
