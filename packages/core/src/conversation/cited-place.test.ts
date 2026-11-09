import { describe, expect, it } from "vitest";
import { matchCitedPlace } from "./cited-place";
import type { SenderMembership } from "./sender";

const TENANT_A = "0190a1b2-0000-7000-8000-00000000000a";
const TENANT_B = "0190a1b2-0000-7000-8000-00000000000b";

type Unit = SenderMembership["tenantUnits"][number];

const unit = (id: string, name: string, aliases: string[], status: Unit["status"] = "active") =>
  ({ id, name, aliases, status }) satisfies Unit;

function membership(overrides: Partial<SenderMembership>): SenderMembership {
  return {
    membershipId: "m",
    tenantId: TENANT_A,
    tenantName: "Restaurante",
    userId: "u",
    userName: "Dono",
    role: "owner",
    status: "active",
    allUnits: true,
    unitIds: [],
    defaultUnitId: null,
    permissions: [],
    panelAccess: true,
    tenantUnitIds: [],
    tenantUnits: [],
    preferredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: null,
    ...overrides,
  };
}

const centro = membership({
  membershipId: "m-centro",
  tenantId: TENANT_A,
  tenantName: "Bistrô Centro",
  tenantUnitIds: ["uA"],
  tenantUnits: [unit("uA", "Matriz", ["centro"])],
});
const praia = membership({
  membershipId: "m-praia",
  tenantId: TENANT_B,
  tenantName: "Bistrô Praia",
  tenantUnitIds: ["uB"],
  tenantUnits: [unit("uB", "Praia", ["litoral"])],
});

describe("matchCitedPlace", () => {
  it("o apelido de uma unidade da outra empresa leva a mensagem para ela", () => {
    expect(matchCitedPlace("gastei 50 no litoral", [centro, praia], centro)).toEqual({
      membership: praia,
      unitId: "uB",
    });
  });

  it("ignora caixa, acento e pontuação", () => {
    expect(matchCitedPlace("Gastei 50 no LITORAL!", [centro, praia], centro)?.membership).toBe(
      praia,
    );
    expect(matchCitedPlace("gastei 50 em Bistrô Praia.", [centro, praia], centro)?.membership).toBe(
      praia,
    );
  });

  it("só casa palavra inteira", () => {
    expect(matchCitedPlace("litoralzinho 50", [centro, praia], centro)).toBeNull();
  });

  it("apelido que existe nas duas empresas é ambíguo e não troca nada", () => {
    const praiaComCentro = membership({
      ...praia,
      tenantUnits: [unit("uB", "Praia", ["litoral", "centro"])],
    });
    expect(matchCitedPlace("gastei 50 no centro", [centro, praiaComCentro], centro)).toBeNull();
  });

  it("citar a unidade da própria empresa padrão não troca de empresa", () => {
    expect(matchCitedPlace("gastei 50 no centro", [centro, praia], centro)).toEqual({
      membership: centro,
      unitId: "uA",
    });
  });

  it("unidade a que o vínculo não tem acesso não conta", () => {
    const restrito = membership({
      ...praia,
      allUnits: false,
      unitIds: ["uOutra"],
      tenantUnitIds: ["uB", "uOutra"],
      tenantUnits: [unit("uB", "Praia", ["litoral"]), unit("uOutra", "Cozinha", [])],
    });
    expect(matchCitedPlace("gastei 50 no litoral", [centro, restrito], centro)).toBeNull();
  });

  it("unidade inativa não conta", () => {
    const inativa = membership({
      ...praia,
      tenantUnits: [unit("uB", "Praia", ["litoral"], "inactive")],
    });
    expect(matchCitedPlace("gastei 50 no litoral", [centro, inativa], centro)).toBeNull();
  });

  it("sem citação não troca nada", () => {
    expect(matchCitedPlace("paguei 200 de carne", [centro, praia], centro)).toBeNull();
  });

  it("duas empresas citadas na mesma mensagem é ambíguo", () => {
    expect(matchCitedPlace("50 no litoral e 30 no centro", [centro, praia], centro)).toBeNull();
  });
});
