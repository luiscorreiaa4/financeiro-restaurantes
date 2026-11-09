import { describe, expect, it } from "vitest";
import { accessibleUnitIds, resolveSender, type SenderMembership, senderToActor } from "./sender";

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
    status: "active",
    allUnits: true,
    unitIds: [],
    defaultUnitId: null,
    permissions: [],
    panelAccess: true,
    tenantUnitIds: [],
    tenantUnits: [],
    preferredAt: null,
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

  it("vínculo com situação desativada é tratado como desconhecido (RF05.CA05)", () => {
    expect(resolveSender([membership({ status: "deactivated" })])).toEqual({ kind: "unknown" });
  });

  it("quem só tem vínculo de contador é desconhecido: o contador não usa o WhatsApp (DD-03, DE-26)", () => {
    const result = resolveSender([membership({ role: "accountant" })]);
    expect(result).toEqual({ kind: "unknown" });
  });

  it("contador em uma empresa e lançador em outra: vale a outra, e o contador some da lista", () => {
    const result = resolveSender([
      membership({ membershipId: "m1", tenantId: TENANT_A, role: "accountant" }),
      membership({
        membershipId: "m2",
        tenantId: TENANT_B,
        tenantName: "Restaurante B",
        role: "staff",
        createdAt: new Date("2026-03-01T12:00:00Z"),
      }),
    ]);
    expect(result).toMatchObject({ kind: "known", tenantCount: 1 });
    if (result.kind === "known") {
      expect(result.sender.tenantId).toBe(TENANT_B);
      expect(result.activeMemberships.map((m) => m.membershipId)).toEqual(["m2"]);
    }
  });

  it("vínculo convidado já é conhecido: a primeira mensagem o ativa (RF05.CA07)", () => {
    const result = resolveSender([membership({ status: "invited" })]);
    expect(result).toMatchObject({ kind: "known" });
  });

  describe("empresa escolhida por trocar empresa (DE-25)", () => {
    const old = membership({
      membershipId: "m-antigo",
      tenantId: TENANT_A,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const recent = membership({
      membershipId: "m-novo",
      tenantId: TENANT_B,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });

    it("o vínculo escolhido por último vale mais que o mais antigo", () => {
      const chosen = { ...recent, preferredAt: new Date("2026-04-01T00:00:00Z") };
      const result = resolveSender([old, chosen]);
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-novo");
      else expect.unreachable();
    });

    it("entre duas escolhas vale a mais recente", () => {
      const a = { ...old, preferredAt: new Date("2026-04-01T00:00:00Z") };
      const b = { ...recent, preferredAt: new Date("2026-05-01T00:00:00Z") };
      const result = resolveSender([a, b]);
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-novo");
      else expect.unreachable();
    });

    it("sem nenhuma escolha continua valendo o mais antigo (DE-07)", () => {
      const result = resolveSender([recent, old]);
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-antigo");
      else expect.unreachable();
    });

    it("a escolha de um vínculo desativado não vale", () => {
      const chosen = {
        ...recent,
        preferredAt: new Date("2026-04-01T00:00:00Z"),
        deactivatedAt: new Date("2026-04-02T00:00:00Z"),
      };
      const result = resolveSender([old, chosen]);
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-antigo");
      else expect.unreachable();
    });

    it("devolve os vínculos ativos para o comando trocar empresa", () => {
      const result = resolveSender([old, recent]);
      if (result.kind === "known") {
        expect(result.activeMemberships.map((m) => m.membershipId)).toEqual(["m-antigo", "m-novo"]);
      } else expect.unreachable();
    });
  });

  describe("empresa e unidade citadas no texto (RF11.R5)", () => {
    const unitA = { id: "uA", name: "Matriz", aliases: ["centro"], status: "active" as const };
    const unitB = { id: "uB", name: "Praia", aliases: ["litoral"], status: "active" as const };
    const a = membership({
      membershipId: "m-a",
      tenantId: TENANT_A,
      tenantName: "Bistrô Centro",
      tenantUnitIds: ["uA"],
      tenantUnits: [unitA],
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const b = membership({
      membershipId: "m-b",
      tenantId: TENANT_B,
      tenantName: "Bistrô Praia",
      tenantUnitIds: ["uB"],
      tenantUnits: [unitB],
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    it("a mensagem que cita a unidade da outra empresa vai para ela", () => {
      const result = resolveSender([a, b], { text: "gastei 50 no litoral" });
      expect(result).toMatchObject({
        kind: "known",
        tenantCount: 2,
        citedUnitId: "uB",
        defaultUnitId: "uB",
      });
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-b");
    });

    it("sem texto (áudio e foto) vale a empresa padrão", () => {
      const result = resolveSender([a, b], { text: null });
      expect(result).toMatchObject({ kind: "known", citedUnitId: null });
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-a");
    });

    it("com uma só empresa o texto não troca nada", () => {
      const result = resolveSender([a], { text: "gastei 50 no litoral" });
      expect(result).toMatchObject({ kind: "known", citedUnitId: null });
    });

    it("a citação vale mais que a empresa escolhida por trocar empresa", () => {
      const chosenA = { ...a, preferredAt: new Date("2026-04-01T00:00:00Z") };
      const result = resolveSender([chosenA, b], { text: "50 no litoral" });
      if (result.kind === "known") expect(result.sender.membershipId).toBe("m-b");
      else expect.unreachable();
    });
  });

  describe("unidade padrão (RF05.R6)", () => {
    it("unidade padrão fora das unidades de acesso nunca é usada", () => {
      const result = resolveSender([
        membership({
          allUnits: false,
          unitIds: ["u1", "u2"],
          defaultUnitId: "u9",
          tenantUnitIds: ["u1", "u2", "u9"],
        }),
      ]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: null });
    });

    it("padrão fora do acesso cai na única unidade acessível", () => {
      const result = resolveSender([
        membership({
          allUnits: false,
          unitIds: ["u1"],
          defaultUnitId: "u9",
          tenantUnitIds: ["u1", "u9"],
        }),
      ]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: "u1" });
    });

    it("usa a unidade padrão do vínculo", () => {
      const result = resolveSender([
        membership({
          allUnits: false,
          unitIds: ["u1", "u2"],
          defaultUnitId: "u2",
          tenantUnitIds: ["u1", "u2", "u3"],
        }),
      ]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: "u2" });
    });

    it("com uma única unidade de acesso, ela é a padrão", () => {
      const result = resolveSender([
        membership({ allUnits: false, unitIds: ["u1"], tenantUnitIds: ["u1", "u2"] }),
      ]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: "u1" });
    });

    it("todas as unidades de um restaurante com uma só unidade usam essa unidade", () => {
      const result = resolveSender([membership({ tenantUnitIds: ["u1"] })]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: "u1" });
    });

    it("todas as unidades de um restaurante com várias ficam sem unidade padrão", () => {
      const result = resolveSender([membership({ tenantUnitIds: ["u1", "u2"] })]);
      expect(result).toMatchObject({ kind: "known", defaultUnitId: null });
    });
  });
});

describe("accessibleUnitIds", () => {
  it("TODAS vale para todas as unidades do restaurante, inclusive as novas", () => {
    expect(accessibleUnitIds(membership({ tenantUnitIds: ["u1", "u2"] }))).toEqual(["u1", "u2"]);
  });

  it("lista vale só para as unidades listadas", () => {
    const sender = membership({ allUnits: false, unitIds: ["u1"], tenantUnitIds: ["u1", "u2"] });
    expect(accessibleUnitIds(sender)).toEqual(["u1"]);
  });
});

describe("senderToActor", () => {
  it("vínculo com TODAS vale para todas as unidades", () => {
    const actor = senderToActor(membership({ role: "manager" }));
    expect(actor).toMatchObject({ role: "manager", units: "all", permissions: [] });
  });

  it("vínculo com lista vale só para as unidades dela", () => {
    const actor = senderToActor(membership({ role: "staff", allUnits: false, unitIds: ["u1"] }));
    expect(actor.units).toEqual(["u1"]);
  });

  it("leva as permissões adicionais e a liberação do painel", () => {
    const actor = senderToActor(
      membership({ role: "manager", permissions: ["VER_FOLHA"], panelAccess: false }),
    );
    expect(actor).toMatchObject({ permissions: ["VER_FOLHA"], panelAccess: false });
  });
});
