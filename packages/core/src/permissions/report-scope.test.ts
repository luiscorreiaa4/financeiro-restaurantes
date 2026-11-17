import { describe, expect, it } from "vitest";
import type { Actor, AdditionalPermission, Role } from "./permissions";
import { reportScopeFor } from "./report-scope";

const UNIT_A = "unit-a";
const UNIT_B = "unit-b";
const UNIT_C = "unit-c";

function actor(
  role: Role,
  extra: { permissions?: readonly AdditionalPermission[]; units?: "all" | readonly string[] } = {},
): Actor {
  return {
    role,
    permissions: extra.permissions ?? [],
    units: extra.units ?? (role === "owner" || role === "accountant" ? "all" : [UNIT_A, UNIT_B]),
    panelAccess: true,
  };
}

describe("recorte do dashboard (RF27.R5, RF06.R5)", () => {
  it("lançador recebe PermissionDenied", () => {
    const result = reportScopeFor({ actor: actor("staff"), activeUnitId: "all" });
    expect(result).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "staff", action: "report:view" },
    });
  });

  it("gerente sem VER_FOLHA não vê folha", () => {
    const result = reportScopeFor({ actor: actor("manager"), activeUnitId: "all" });
    expect(result.ok && result.value.canSeePayroll).toBe(false);
  });

  it("gerente com VER_FOLHA vê folha", () => {
    const result = reportScopeFor({
      actor: actor("manager", { permissions: ["VER_FOLHA"] }),
      activeUnitId: "all",
    });
    expect(result.ok && result.value.canSeePayroll).toBe(true);
  });

  it("dono e contador veem folha", () => {
    for (const role of ["owner", "accountant"] as const) {
      const result = reportScopeFor({ actor: actor(role), activeUnitId: "all" });
      expect(result.ok && result.value.canSeePayroll).toBe(true);
    }
  });

  it("gerente com o seletor em todas recebe as unidades dele", () => {
    const result = reportScopeFor({ actor: actor("manager"), activeUnitId: "all" });
    expect(result.ok && result.value.unitIds).toEqual([UNIT_A, UNIT_B]);
  });

  it("gerente com acesso a uma unidade e seletor em todas recebe só ela", () => {
    const result = reportScopeFor({
      actor: actor("manager", { units: [UNIT_A] }),
      activeUnitId: "all",
    });
    expect(result.ok && result.value.unitIds).toEqual([UNIT_A]);
  });

  it("gerente pedindo unidade fora do acesso recebe PermissionDenied", () => {
    const result = reportScopeFor({
      actor: actor("manager"),
      activeUnitId: UNIT_A,
      requestedUnitIds: [UNIT_A, UNIT_C],
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "manager", action: "report:view" },
    });
  });

  it("ator sem nenhuma unidade com o seletor em todas recebe PermissionDenied, nunca lista vazia", () => {
    const semUnidade = { ...actor("manager"), units: [] as readonly string[] };
    expect(reportScopeFor({ actor: semUnidade, activeUnitId: "all" })).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "manager", action: "report:view" },
    });
  });

  it("unidade ativa fora do acesso é recusada", () => {
    const result = reportScopeFor({ actor: actor("manager"), activeUnitId: UNIT_C });
    expect(result.ok).toBe(false);
  });

  it("dono com o seletor em todas recebe all", () => {
    const result = reportScopeFor({ actor: actor("owner"), activeUnitId: "all" });
    expect(result.ok && result.value.unitIds).toBe("all");
  });

  it("filtro pedido prevalece sobre o seletor, e filtro vazio cai no seletor", () => {
    const requested = reportScopeFor({
      actor: actor("manager"),
      activeUnitId: UNIT_A,
      requestedUnitIds: [UNIT_B],
    });
    expect(requested.ok && requested.value.unitIds).toEqual([UNIT_B]);
    const empty = reportScopeFor({
      actor: actor("manager"),
      activeUnitId: UNIT_B,
      requestedUnitIds: [],
    });
    expect(empty.ok && empty.value.unitIds).toEqual([UNIT_B]);
  });
});
