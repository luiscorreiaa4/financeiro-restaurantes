"use client";

import { BRAZILIAN_STATES, loadMunicipalities, timezoneForUf, UNIT_ALIASES_MAX } from "@app/core";
import type { SalesChannelSettings, UnitSettings, UnitSettingsInput } from "@app/core/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AliasesInput } from "../shared/aliases-input";
import { ReadOnlyNotice } from "../shared/read-only-notice";
import { type SettingsErrorText, settingsErrorText } from "../shared/settings-errors";
import type { SettingsScope } from "../shared/use-settings";

export type LoadCities = (uf: string) => Promise<readonly string[]>;

const UNIT_ERRORS: Record<string, string> = {
  "name.invalid": "O nome precisa ter entre 2 e 60 caracteres.",
  "aliases.invalid": "Cada apelido precisa ter até 30 caracteres.",
  "aliases.too_many": "Use até 5 apelidos.",
  "cnpj.invalid": "CNPJ inválido.",
  "city.invalid": "Escolha um município da lista.",
  "city.required": "Informe o município.",
  "uf.invalid": "Escolha a UF.",
  "timezone.invalid": "Fuso horário inválido.",
  unknown_reference: "O canal padrão escolhido não está disponível. Escolha outro.",
  name_taken: "Já existe uma unidade com este nome ou apelido.",
};

type Props = {
  scope: SettingsScope;
  initial: UnitSettings | null;
  /** Canais ativos e que não são "Não informado": os únicos que podem ser o padrão (DD-08). */
  channels: readonly SalesChannelSettings[];
  onSubmit: (body: UnitSettingsInput) => Promise<unknown>;
  onDone: () => void;
  loadCities?: LoadCities;
};

const EMPTY: UnitSettingsInput = {
  name: "",
  aliases: [],
  cnpj: null,
  uf: "SP",
  city: "",
  timezone: timezoneForUf("SP"),
  status: "active",
  defaultSalesChannelId: null,
};

/** Formulário de unidade (RF04). Município pela lista IBGE e fuso sugerido pela UF (editável). */
export function UnitForm({
  scope,
  initial,
  channels,
  onSubmit,
  onDone,
  loadCities = loadMunicipalities,
}: Props) {
  const [values, setValues] = useState<UnitSettingsInput>(() => {
    if (initial === null) return EMPTY;
    const { id: _id, onlyUnitMemberCount: _count, ...rest } = initial;
    return { ...rest, uf: rest.uf ?? "SP", city: rest.city ?? "" };
  });
  const [cities, setCities] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<SettingsErrorText | null>(null);
  const sending = useRef(false);
  const locked = !scope.canManage;

  useEffect(() => {
    let active = true;
    setCities(null);
    loadCities(values.uf).then(
      (list) => active && setCities(list),
      () => active && setCities(null),
    );
    return () => {
      active = false;
    };
  }, [values.uf, loadCities]);

  function set<K extends keyof UnitSettingsInput>(key: K, value: UnitSettingsInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function changeUf(uf: string) {
    // O fuso acompanha a UF enquanto a pessoa não o tiver editado para outro valor.
    const suggested = timezoneForUf(values.uf);
    setValues((current) => ({
      ...current,
      uf: uf as UnitSettingsInput["uf"],
      city: "",
      timezone: current.timezone === suggested ? timezoneForUf(uf) : current.timezone,
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || locked) return;
    sending.current = true;
    setError(null);
    try {
      await onSubmit({ ...values, cnpj: values.cnpj?.trim() ? values.cnpj : null });
      onDone();
    } catch (e) {
      setError(settingsErrorText(e, UNIT_ERRORS));
    } finally {
      sending.current = false;
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {locked && <ReadOnlyNotice />}
      <div className="flex flex-col gap-1">
        <Label htmlFor="unit-name">Nome</Label>
        <Input
          id="unit-name"
          value={values.name}
          disabled={locked}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <AliasesInput
        value={values.aliases}
        max={UNIT_ALIASES_MAX}
        disabled={locked}
        onChange={(a) => set("aliases", a)}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="unit-cnpj">CNPJ (opcional)</Label>
        <Input
          id="unit-cnpj"
          value={values.cnpj ?? ""}
          disabled={locked}
          onChange={(e) => set("cnpj", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="unit-uf">UF</Label>
          <select
            id="unit-uf"
            className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={values.uf}
            disabled={locked}
            onChange={(e) => changeUf(e.target.value)}
          >
            {BRAZILIAN_STATES.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label htmlFor="unit-city">Município</Label>
          {cities === null ? (
            <Input
              id="unit-city"
              value={values.city}
              disabled={locked}
              onChange={(e) => set("city", e.target.value)}
            />
          ) : (
            <select
              id="unit-city"
              className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
              value={values.city}
              disabled={locked}
              onChange={(e) => set("city", e.target.value)}
            >
              <option value="">Escolha…</option>
              {values.city !== "" && !cities.includes(values.city) && (
                <option value={values.city}>{values.city}</option>
              )}
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="unit-tz">Fuso horário</Label>
        <Input
          id="unit-tz"
          value={values.timezone}
          disabled={locked}
          onChange={(e) => set("timezone", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Trocar o fuso não altera a data dos lançamentos já feitos.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="unit-channel">Canal padrão da receita</Label>
        <select
          id="unit-channel"
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={values.defaultSalesChannelId ?? ""}
          disabled={locked}
          onChange={(e) =>
            set("defaultSalesChannelId", e.target.value === "" ? null : e.target.value)
          }
        >
          <option value="">Nenhum</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
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
