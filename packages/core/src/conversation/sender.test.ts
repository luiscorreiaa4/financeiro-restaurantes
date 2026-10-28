import { describe, expect, it } from "vitest";
import { resolveSender, type SenderMembership } from "./sender";

const TENANT_A = "0190a1b2-0000-7000-8000-00000000000a";
const TENANT_B = "0190a1b2-0000-7000-8000-00000000000b";

function membership(overrides: Partial<SenderMembership> = {}): SenderMembership {
  return {
    membershipId: "0190a1b2-1000-7000-8000-000000000001",
    tenantId: TENANT_A,
    tenantName: "Restaurante A",
    userId: "0190a1b2-2000-7000-8000-000000000001",
    userName: "Dono",
    role: "owner",
    unitId: null,
    tenantUnitIds: [],
    createdAt: new Date("2026-01-10T12:00:00Z"),
    deactivatedAt: null,
    ...overrides,
  };
}

describe("resolveSender", () => {
  it("telefone sem nenhum vínculo é desconhecido", () => {
    expect(resolveSender([])).toEqual({ kind: "unknown" });
  });

  it("usuário com vínculo ativo é conhecido, com o papel do vínculo", () => {
    const result = resolveSender([membership({ role: "manager" })]);
    expect(result).toMatchObject({ kind: "known", tenantCount: 1 });
    if (result.kind === "known") expect(result.sender.role).toBe("manager");
  });

  it("usuário só com vínculo desativado é tratado como desconhecido", () => {
    const result = resolveSender([membership({ deactivatedAt: new Date("2026-02-01T00:00:00Z") })]);
    expect(result).toEqual({ kind: "unknown" });
  });

  it("ignora o vínculo desativado e usa o ativo de outro restaurante", () => {
    const result = resolveSender([
      membership({ tenantId: TENANT_A, deactivatedAt: new Date("2026-02-01T00:00:00Z") }),
      membership({ membershipId: "m2", tenantId: TENANT_B, tenantName: "Restaurante B" }),
    ]);
    expect(result).toMatchObject({ kind: "known", tenantCount: 1 });
    if (result.kind === "known") expect(result.sender.tenantId).toBe(TENANT_B);
  });

  it("em dois restaurantes ativos, vale o vínculo mais antigo e informa que são dois", () => {
    const result = resolveSender([
      membership({
        membershipId: "m-novo",
        tenantId: TENANT_B,
        createdAt: new Date("2026-03-01T00:00:00Z"),
      }),
      membership({
        membershipId: "m-antigo",
        tenantId: TENANT_A,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ]);
    expect(result).toMatchObject({ kind: "known", tenantCount: 2 });
    if (result.kind === "known") expect(result.sender.membershipId).toBe("m-antigo");
  });

  it("vínculos criados no mesmo instante desempatam pelo id, sempre da mesma forma", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const a = membership({ membershipId: "m-a", tenantId: TENANT_A, createdAt: same });
    const b = membership({ membershipId: "m-b", tenantId: TENANT_B, createdAt: same });
    const first = resolveSender([a, b]);
    const second = resolveSender([b, a]);
    expect(first).toEqual(second);
    if (first.kind === "known") expect(first.sender.membershipId).toBe("m-a");
  });

  it("dois vínculos no mesmo restaurante contam como um restaurante", () => {
    const result = resolveSender([
      membership({ membershipId: "m1" }),
      membership({ membershipId: "m2" }),
    ]);
    expect(result).toMatchObject({ kind: "known", tenantCount: 1 });
  });

  describe("unidade padrão", () => {
    it("vínculo preso a uma unidade usa essa unidade", () => {
      const result = resolveSender([membership({ unitId: "u1", tenantUnitIds: ["u1", "u2"] })]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: "u1" });
    });

    it("vínculo para todas as unidades de um restaurante com uma só unidade usa essa unidade", () => {
      const result = resolveSender([membership({ unitId: null, tenantUnitIds: ["u1"] })]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: "u1" });
    });

    it("vínculo para todas as unidades de um restaurante com várias fica sem unidade padrão", () => {
      const result = resolveSender([membership({ unitId: null, tenantUnitIds: ["u1", "u2"] })]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: null });
    });
  });
});
