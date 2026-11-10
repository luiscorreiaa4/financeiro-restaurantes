import type { Me } from "./me-contract";

const TENANT = "0190a000-0000-7000-8000-000000000001";
const UNIT = "0190a000-0000-7000-8000-0000000000a1";

/** Fixture de `/api/me` para testes: dono com uma empresa e uma unidade, contexto vindo do cookie. */
export function meFixture(overrides: Partial<Me> = {}): Me {
  return {
    userId: "u1",
    name: "Dono",
    email: "dono@demo.dev",
    companies: [
      {
        tenantId: TENANT,
        name: "Bistrô Demo",
        role: "owner",
        accountStatus: "active",
        startUnitId: "all",
      },
    ],
    context: {
      tenantId: TENANT,
      unitId: "all",
      role: "owner",
      permissions: [],
      allUnits: true,
      unitIds: [UNIT],
      accountStatus: "active",
      allowedActions: ["entry:view", "report:view", "export:data", "catalog:view", "panel:access"],
    },
    contextSource: "cookie",
    ...overrides,
  };
}
