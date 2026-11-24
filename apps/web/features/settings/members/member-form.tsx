"use client";

import { type AdditionalPermission, PERMISSIONS_BY_ROLE } from "@app/core";
import type {
  MemberSettings,
  MemberSettingsInput,
  MemberSettingsPatch,
  UnitSettings,
} from "@app/core/contracts";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReadOnlyNotice } from "../shared/read-only-notice";
import { type SettingsErrorText, settingsErrorText } from "../shared/settings-errors";
import { MEMBER_ERRORS, PERMISSION_LABELS, ROLE_LABELS } from "./member-labels";

type Role = MemberSettingsInput["role"];

type Values = {
  displayName: string;
  phone: string;
  email: string;
  role: Role;
  allUnits: boolean;
  unitIds: string[];
  defaultUnitId: string | null;
  panelAccess: boolean;
  permissions: AdditionalPermission[];
};

const EMPTY: Values = {
  displayName: "",
  phone: "",
  email: "",
  role: "staff",
  allUnits: false,
  unitIds: [],
  defaultUnitId: null,
  panelAccess: false,
  permissions: [],
};

function valuesOf(member: MemberSettings): Values {
  return {
    displayName: member.displayName,
    phone: member.phone ?? "",
    email: member.email ?? "",
    role: member.role,
    allUnits: member.allUnits,
    unitIds: [...member.unitIds],
    defaultUnitId: member.defaultUnitId,
    panelAccess: member.panelAccess,
    permissions: [...member.permissions],
  };
}

/** Erro local antes de enviar (CA03): painel liberado exige e-mail. */
export function localMemberError(values: Pick<Values, "panelAccess" | "email">): string | null {
  if (values.panelAccess && values.email.trim() === "")
    return MEMBER_ERRORS["email.required"] ?? null;
  return null;
}

/** Só o que mudou vai no PATCH; celular novo leva a confirmação (RF05). */
function buildPatch(before: Values, after: Values, confirmed: boolean): MemberSettingsPatch {
  const patch: MemberSettingsPatch = {};
  if (after.displayName !== before.displayName) patch.displayName = after.displayName;
  if (after.phone.trim() !== before.phone) {
    patch.phone = after.phone.trim();
    if (confirmed) patch.confirmPhoneChange = true;
  }
  if (after.email.trim() !== before.email) patch.email = after.email.trim() || null;
  if (after.role !== before.role) patch.role = after.role;
  if (
    after.allUnits !== before.allUnits ||
    [...after.unitIds].sort().join() !== [...before.unitIds].sort().join()
  ) {
    patch.allUnits = after.allUnits;
    patch.unitIds = after.allUnits ? [] : after.unitIds;
  }
  if (after.defaultUnitId !== before.defaultUnitId) patch.defaultUnitId = after.defaultUnitId;
  if (after.panelAccess !== before.panelAccess) patch.panelAccess = after.panelAccess;
  if ([...after.permissions].sort().join() !== [...before.permissions].sort().join()) {
    patch.permissions = after.permissions;
  }
  // Painel novo ou papel que sobe: a API exige o e-mail explícito (RF05, anti-sequestro de conta).
  const elevated = patch.role === "manager" || patch.role === "owner";
  if ((patch.panelAccess === true || elevated) && after.email.trim() !== "") {
    patch.email = after.email.trim();
  }
  return patch;
}

type Props = {
  scope: { canManage: boolean };
  /** Nulo = cadastro novo. */
  initial: MemberSettings | null;
  units: readonly UnitSettings[];
  onCreate: (body: MemberSettingsInput) => Promise<unknown>;
  onUpdate: (id: string, body: MemberSettingsPatch) => Promise<unknown>;
  onDone: () => void;
};

/** Formulário de colaborador (RF05): papel, unidades de acesso, painel e permissões do papel. */
export function MemberForm({ scope, initial, units, onCreate, onUpdate, onDone }: Props) {
  const original = initial === null ? EMPTY : valuesOf(initial);
  const [values, setValues] = useState<Values>(original);
  const [confirmPhone, setConfirmPhone] = useState(false);
  const [error, setError] = useState<SettingsErrorText | null>(null);
  const sending = useRef(false);
  const locked = !scope.canManage;
  const activeUnits = units.filter((u) => u.status === "active");
  const phoneChanged = initial !== null && values.phone.trim() !== original.phone;
  const emailHidden = initial !== null && initial.email === undefined;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function changeRole(role: Role) {
    setValues((current) => ({
      ...current,
      role,
      allUnits: role === "owner" ? true : current.allUnits,
      // Permissão que não vale para o novo papel sai (PERMISSIONS_BY_ROLE).
      permissions: current.permissions.filter((p) => PERMISSIONS_BY_ROLE[role].includes(p)),
    }));
  }

  function toggleUnit(unitId: string, checked: boolean) {
    setValues((current) => {
      const unitIds = checked
        ? [...current.unitIds, unitId]
        : current.unitIds.filter((id) => id !== unitId);
      // Com uma só unidade, ela é a padrão (CA04).
      const defaultUnitId =
        unitIds.length === 1
          ? (unitIds[0] ?? null)
          : unitIds.includes(current.defaultUnitId ?? "")
            ? current.defaultUnitId
            : null;
      return { ...current, unitIds, defaultUnitId };
    });
  }

  function togglePermission(permission: AdditionalPermission, checked: boolean) {
    setValues((current) => ({
      ...current,
      permissions: checked
        ? [...current.permissions, permission]
        : current.permissions.filter((p) => p !== permission),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || locked) return;
    const local = localMemberError(values);
    if (local !== null) {
      setError({ message: local, conflict: false });
      return;
    }
    if (phoneChanged && !confirmPhone) {
      setError({ message: "Confirme a troca de celular para continuar.", conflict: false });
      return;
    }
    sending.current = true;
    setError(null);
    try {
      const all = values.role === "owner" || values.allUnits;
      if (initial === null) {
        await onCreate({
          displayName: values.displayName.trim(),
          phone: values.phone.trim(),
          email: values.email.trim() === "" ? null : values.email.trim(),
          role: values.role,
          allUnits: all,
          unitIds: all ? [] : values.unitIds,
          defaultUnitId: values.defaultUnitId,
          panelAccess: values.panelAccess,
          permissions: values.permissions,
        });
      } else {
        await onUpdate(
          initial.id,
          buildPatch(original, { ...values, allUnits: all }, confirmPhone),
        );
      }
      onDone();
    } catch (e) {
      setError(settingsErrorText(e, MEMBER_ERRORS));
    } finally {
      sending.current = false;
    }
  }

  const available = PERMISSIONS_BY_ROLE[values.role];
  const allUnits = values.role === "owner" || values.allUnits;
  const selectClass = "h-9 rounded-lg border border-input bg-transparent px-2 text-sm";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {locked && (
        <ReadOnlyNotice reason="Você só pode consultar os colaboradores. Quem altera é o dono." />
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="member-name">Nome</Label>
        <Input
          id="member-name"
          value={values.displayName}
          disabled={locked}
          onChange={(e) => set("displayName", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="member-phone">Celular (com DDD)</Label>
        <Input
          id="member-phone"
          inputMode="tel"
          value={locked && initial ? initial.phoneMasked : values.phone}
          disabled={locked}
          onChange={(e) => set("phone", e.target.value)}
        />
        {phoneChanged && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmPhone}
              onChange={(e) => setConfirmPhone(e.target.checked)}
            />
            <span>Entendo que o número antigo deixa de ser reconhecido.</span>
          </label>
        )}
      </div>
      {!(locked && emailHidden) && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="member-email">E-mail {values.panelAccess ? "" : "(opcional)"}</Label>
          <Input
            id="member-email"
            type="email"
            value={values.email}
            disabled={locked}
            placeholder={emailHidden ? "Não exibido" : undefined}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="member-role">Papel</Label>
        <select
          id="member-role"
          className={selectClass}
          value={values.role}
          disabled={locked}
          onChange={(e) => changeRole(e.target.value as Role)}
        >
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-2" disabled={locked}>
        <legend className="text-sm font-medium">Unidades de acesso</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allUnits}
            disabled={locked || values.role === "owner"}
            onChange={(e) => set("allUnits", e.target.checked)}
          />
          Todas as unidades
        </label>
        {!allUnits &&
          activeUnits.map((unit) => (
            <label key={unit.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.unitIds.includes(unit.id)}
                onChange={(e) => toggleUnit(unit.id, e.target.checked)}
              />
              {unit.name}
            </label>
          ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label htmlFor="member-default-unit">Unidade padrão</Label>
        <select
          id="member-default-unit"
          className={selectClass}
          value={values.defaultUnitId ?? ""}
          disabled={locked}
          onChange={(e) => set("defaultUnitId", e.target.value === "" ? null : e.target.value)}
        >
          <option value="">Escolha…</option>
          {activeUnits
            .filter((u) => allUnits || values.unitIds.includes(u.id))
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.panelAccess}
          disabled={locked}
          onChange={(e) => set("panelAccess", e.target.checked)}
        />
        Acesso ao painel
      </label>
      {available.length > 0 && (
        <fieldset className="flex flex-col gap-2" disabled={locked}>
          <legend className="text-sm font-medium">Permissões adicionais</legend>
          {available.map((permission) => (
            <label key={permission} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.permissions.includes(permission)}
                onChange={(e) => togglePermission(permission, e.target.checked)}
              />
              {PERMISSION_LABELS[permission]}
            </label>
          ))}
        </fieldset>
      )}
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
