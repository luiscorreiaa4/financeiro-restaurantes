"use client";

import { dreGroupLabel } from "@app/core";
import type { CategoryNode, CategorySettings, SubcategoryInput } from "@app/core/contracts";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AliasesInput } from "../shared/aliases-input";
import { CATEGORY_KIND_LABELS, CATEGORY_NATURE_LABELS } from "../shared/catalog-labels";
import { ReadOnlyNotice } from "../shared/read-only-notice";
import { type SettingsErrorText, settingsErrorText } from "../shared/settings-errors";
import type { SettingsScope } from "../shared/use-settings";

const SUPPORT_WORDS_MAX = 30;

const ERRORS = {
  "name.invalid": "O nome precisa ter entre 2 e 60 caracteres.",
  "name.duplicate": "Já existe uma subcategoria com este nome nesta categoria.",
};

type Props = {
  scope: SettingsScope;
  /** Categoria do sistema sob a qual a subcategoria vive (herança exibida, pai nunca editável). */
  parent: CategoryNode;
  initial: CategorySettings | null;
  onSubmit: (
    body: Omit<SubcategoryInput, "parentId"> & { status?: "active" | "inactive" },
  ) => Promise<unknown>;
  onDone: () => void;
};

/** Subcategoria (RF07): tipo, grupo, sensível e "exige quantidade" vêm do pai e só são exibidos. */
export function SubcategoryForm({ scope, parent, initial, onSubmit, onDone }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [nature, setNature] = useState<"fixed" | "variable" | null>(
    initial ? initial.nature : parent.nature,
  );
  const [words, setWords] = useState<string[]>(initial?.supportWords ?? []);
  const [status, setStatus] = useState<"active" | "inactive">(initial?.status ?? "active");
  const [error, setError] = useState<SettingsErrorText | null>(null);
  const sending = useRef(false);
  const locked = !scope.canManage || (initial !== null && initial.origin === "system");
  const isExpense = parent.kind === "expense";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || locked) return;
    sending.current = true;
    setError(null);
    try {
      const cleaned = words.map((word) => word.trim()).filter((word) => word !== "");
      await onSubmit({
        name: name.trim(),
        ...(isExpense ? { nature } : {}),
        supportWords: cleaned,
        ...(initial ? { status } : {}),
      });
      onDone();
    } catch (e) {
      setError(settingsErrorText(e, ERRORS));
    } finally {
      sending.current = false;
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {locked && <ReadOnlyNotice />}
      <div className="rounded-lg border p-3 text-sm">
        <p className="font-medium">Herdado de {parent.name}</p>
        <ul className="mt-1 text-muted-foreground">
          <li>Tipo: {CATEGORY_KIND_LABELS[parent.kind]}</li>
          <li>Grupo do DRE: {dreGroupLabel(parent.dreGroup)}</li>
          {parent.requiresQuantity && <li>Exige quantidade e unidade nos lançamentos</li>}
        </ul>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={parent.isSensitive} disabled readOnly />
          Categoria sensível (folha)
        </label>
        {parent.isSensitive && (
          <p className="text-xs text-muted-foreground">
            Subcategoria de categoria sensível é sempre sensível e não pode ser desmarcada.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sub-name">Nome</Label>
        <Input
          id="sub-name"
          value={name}
          disabled={locked}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {isExpense && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="sub-nature">Natureza</Label>
          <select
            id="sub-nature"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
            value={nature ?? ""}
            disabled={locked}
            onChange={(event) =>
              setNature(
                event.target.value === "" ? null : (event.target.value as "fixed" | "variable"),
              )
            }
          >
            <option value="">Sem natureza</option>
            {(["fixed", "variable"] as const).map((value) => (
              <option key={value} value={value}>
                {CATEGORY_NATURE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      )}
      <AliasesInput
        label="Palavras de apoio"
        value={words}
        max={SUPPORT_WORDS_MAX}
        disabled={locked}
        onChange={setWords}
      />
      {initial && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="sub-status">Situação</Label>
          <select
            id="sub-status"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
            value={status}
            disabled={locked}
            onChange={(event) => setStatus(event.target.value as "active" | "inactive")}
          >
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error.conflict
            ? "Já existe uma subcategoria com este nome nesta categoria."
            : error.message}
        </p>
      )}
      {!locked && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit">Salvar</Button>
        </div>
      )}
    </form>
  );
}
