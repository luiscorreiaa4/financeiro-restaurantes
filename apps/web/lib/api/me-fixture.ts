import type { FullMe, RestrictedMe } from "./me-contract";

const TENANT = "0190a000-0000-7000-8000-000000000001";
const UNIT = "0190a000-0000-7000-8000-0000000000a1";

/** Fixture de `/api/me` para testes: dono com uma empresa e uma unidade, contexto vindo do cookie. */
export function meFixture(overrides: Partial<FullMe> = {}): FullMe {
  return {
    access: "full",
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

/** Fixture de `/api/me` restrito: sem empresa nem contexto. */
export function restrictedMeFixture(overrides: Partial<RestrictedMe> = {}): RestrictedMe {
  return {
    access: "restricted",
    reason: "owner_no_unit",
    userId: "u1",
    name: "Dono",
    email: "dono@demo.dev",
    ...overrides,
  };
}
