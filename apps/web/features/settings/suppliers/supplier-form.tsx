"use client";

import type { SupplierPatchInput, SupplierSettings } from "@app/core/contracts";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AliasesInput } from "../shared/aliases-input";
import { ReadOnlyNotice } from "../shared/read-only-notice";
import { type SettingsErrorText, settingsErrorText } from "../shared/settings-errors";

const ALIASES_MAX = 10;

const ERRORS = {
  "name.invalid": "O nome precisa ter entre 2 e 120 caracteres.",
  "document.invalid": "Documento inválido. Confira os dígitos do CPF ou do CNPJ.",
  "aliases.too_many": "Há apelidos demais (até 10).",
  "aliases.too_long": "Um dos apelidos é grande demais.",
  name_taken: "Já existe um fornecedor com este nome ou apelido.",
  document_taken: "Já existe um fornecedor com este documento.",
};

type Props = {
  supplier: SupplierSettings;
  canManage: boolean;
  onSubmit: (patch: SupplierPatchInput) => Promise<unknown>;
  onDone: () => void;
};

/** Edição de fornecedor (RF10): só o que mudou vai ao servidor. CPF já chega mascarado ou inteiro. */
export function SupplierForm({ supplier, canManage, onSubmit, onDone }: Props) {
  const [name, setName] = useState(supplier.name);
  const [document, setDocument] = useState(supplier.document ?? "");
  const [aliases, setAliases] = useState<string[]>(supplier.aliases);
  const [status, setStatus] = useState(supplier.status);
  const [error, setError] = useState<SettingsErrorText | null>(null);
  const sending = useRef(false);
  const maskedCpf = supplier.document?.includes("•") === true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || !canManage) return;
    const cleanAliases = aliases.map((alias) => alias.trim()).filter((alias) => alias !== "");
    const patch: SupplierPatchInput = {};
    if (name.trim() !== supplier.name) patch.name = name.trim();
    if (!maskedCpf && document.trim() !== (supplier.document ?? "")) {
      patch.document = document.trim() === "" ? null : document.trim();
    }
    if (JSON.stringify(cleanAliases) !== JSON.stringify(supplier.aliases)) {
      patch.aliases = cleanAliases;
    }
    if (status !== supplier.status) patch.status = status;
    if (Object.keys(patch).length === 0) return onDone();
    sending.current = true;
    setError(null);
    try {
      await onSubmit(patch);
      onDone();
    } catch (e) {
      setError(settingsErrorText(e, ERRORS));
    } finally {
      sending.current = false;
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {!canManage && <ReadOnlyNotice />}
      <div className="flex flex-col gap-1">
        <Label htmlFor="sup-name">Nome</Label>
        <Input
          id="sup-name"
          value={name}
          disabled={!canManage}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sup-document">CPF ou CNPJ</Label>
        <Input
          id="sup-document"
          value={document}
          disabled={!canManage || maskedCpf}
          autoComplete="off"
          onChange={(event) => setDocument(event.target.value)}
        />
        {maskedCpf && (
          <p className="text-xs text-muted-foreground">
            O CPF aparece parcialmente para o seu perfil e não pode ser editado aqui.
          </p>
        )}
      </div>
      <AliasesInput value={aliases} max={ALIASES_MAX} disabled={!canManage} onChange={setAliases} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="sup-status">Situação</Label>
        <select
          id="sup-status"
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          value={status}
          disabled={!canManage}
          onChange={(event) => setStatus(event.target.value as "active" | "inactive")}
        >
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </select>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {canManage && (
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
