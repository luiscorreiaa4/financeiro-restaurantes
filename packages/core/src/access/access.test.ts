import { describe, expect, it } from "vitest";
import { type AccessInput, ensureActiveOwner, validateAccess } from "./access";

const U1 = "unit-1";
const U2 = "unit-2";
const U3 = "unit-3";

function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    role: "manager",
    allUnits: false,
    unitIds: [U1, U2],
    defaultUnitId: U1,
    tenantUnitIds: [U1, U2, U3],
    panelAccess: false,
    email: null,
    permissions: [],
    ...overrides,
  };
}

describe("validateAccess: unidades de acesso e unidade padrão (RF05.R5, R6)", () => {
  it("aceita lista de unidades com padrão dentro dela", () => {
    expect(validateAccess(input())).toEqual({
      ok: true,
      value: {
        allUnits: false,
        unitIds: [U1, U2],
        defaultUnitId: U1,
        panelAccess: false,
        permissions: [],
      },
    });
  });

  it("recusa unidade padrão fora das unidades de acesso (RF05.CA04)", () => {
    const result = validateAccess(input({ defaultUnitId: U3 }));
    expect(result).toEqual({
      ok: false,
      error: { code: "DefaultUnitOutsideAccess", unitId: U3 },
    });
  });

  it("com uma única unidade de acesso, a padrão é preenchida sozinha", () => {
    const result = validateAccess(input({ unitIds: [U2], defaultUnitId: null }));
    expect(result).toMatchObject({ ok: true, value: { defaultUnitId: U2 } });
  });

  it("com várias unidades e sem padrão, recusa", () => {
    const result = validateAccess(input({ defaultUnitId: null }));
    expect(result).toEqual({ ok: false, error: { code: "DefaultUnitRequired" } });
  });

  it("recusa lista vazia", () => {
    const result = validateAccess(input({ unitIds: [], defaultUnitId: null }));
    expect(result).toEqual({ ok: false, error: { code: "NoUnitAccess" } });
  });

  it("recusa unidade que não é da empresa", () => {
    const result = validateAccess(input({ unitIds: [U1, "outra-empresa"] }));
    expect(result).toEqual({
      ok: false,
      error: { code: "UnitOutsideTenant", unitId: "outra-empresa" },
    });
  });

  it("TODAS ignora a lista e aceita padrão nulo ou de qualquer unidade da empresa", () => {
    const all = validateAccess(input({ allUnits: true, unitIds: [U1], defaultUnitId: null }));
    expect(all).toMatchObject({ ok: true, value: { allUnits: true, unitIds: [] } });
    const withDefault = validateAccess(input({ allUnits: true, defaultUnitId: U3 }));
    expect(withDefault).toMatchObject({ ok: true, value: { defaultUnitId: U3 } });
  });

  it("TODAS com padrão de outra empresa, recusa", () => {
    const result = validateAccess(input({ allUnits: true, defaultUnitId: "outra-empresa" }));
    expect(result).toMatchObject({ ok: false, error: { code: "UnitOutsideTenant" } });
  });

  it("o Dono tem sempre TODAS", () => {
    const result = validateAccess(input({ role: "owner", allUnits: false }));
    expect(result).toEqual({ ok: false, error: { code: "OwnerNeedsAllUnits" } });
  });

  it("o contador vê todas as unidades e sempre tem acesso ao painel", () => {
    const result = validateAccess(
      input({ role: "accountant", allUnits: true, panelAccess: false, email: "c@escritorio.com" }),
    );
    expect(result).toMatchObject({ ok: true, value: { allUnits: true, panelAccess: true } });
  });

  it("contador sem TODAS, recusa", () => {
    const result = validateAccess(input({ role: "accountant", email: "c@escritorio.com" }));
    expect(result).toEqual({ ok: false, error: { code: "AccountantNeedsAllUnits" } });
  });
});

describe("validateAccess: painel e permissões (RF05.R3, R7)", () => {
  it("acesso ao painel sem e-mail, recusa (RF05.CA03)", () => {
    const result = validateAccess(input({ panelAccess: true, email: null }));
    expect(result).toEqual({ ok: false, error: { code: "EmailRequiredForPanel" } });
  });

  it("acesso ao painel com e-mail, aceita", () => {
    const result = validateAccess(input({ panelAccess: true, email: "g@restaurante.com" }));
    expect(result).toMatchObject({ ok: true, value: { panelAccess: true } });
  });

  it("contador sem e-mail, recusa", () => {
    const result = validateAccess(input({ role: "accountant", allUnits: true, email: null }));
    expect(result).toEqual({ ok: false, error: { code: "EmailRequiredForPanel" } });
  });

  it("permissão adicional fora do papel, recusa", () => {
    const result = validateAccess(input({ permissions: ["CONSULTAR_RELATORIOS_WHATSAPP"] }));
    expect(result).toMatchObject({ ok: false, error: { code: "InvalidPermission" } });
  });
});

describe("ensureActiveOwner (RF05.Obs3, RF05.CA06)", () => {
  const owners = [
    { id: "m1", role: "owner", status: "active" },
    { id: "m2", role: "manager", status: "active" },
  ] as const;

  it("bloqueia rebaixar o único Dono ativo", () => {
    expect(ensureActiveOwner(owners, { membershipId: "m1", role: "manager" })).toEqual({
      ok: false,
      error: { code: "LastActiveOwner" },
    });
  });

  it("bloqueia desativar o único Dono ativo", () => {
    const result = ensureActiveOwner(owners, { membershipId: "m1", status: "deactivated" });
    expect(result).toMatchObject({ ok: false, error: { code: "LastActiveOwner" } });
  });

  it("permite rebaixar quando outro Dono ativo existe", () => {
    const two = [...owners, { id: "m3", role: "owner", status: "active" }] as const;
    expect(ensureActiveOwner(two, { membershipId: "m1", role: "manager" }).ok).toBe(true);
  });

  it("Dono convidado ou desativado não conta como ativo", () => {
    const list = [
      { id: "m1", role: "owner", status: "active" },
      { id: "m3", role: "owner", status: "invited" },
      { id: "m4", role: "owner", status: "deactivated" },
    ] as const;
    expect(ensureActiveOwner(list, { membershipId: "m1", role: "staff" }).ok).toBe(false);
  });

  it("alterar quem não é Dono sempre pode", () => {
    expect(ensureActiveOwner(owners, { membershipId: "m2", role: "staff" }).ok).toBe(true);
  });
});
