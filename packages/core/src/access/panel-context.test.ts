import { describe, expect, it } from "vitest";
import { ACTIONS, type Actor } from "../permissions";
import { ACCOUNT_STATUSES } from "../signup/signup-defaults";
import {
  accountAllows,
  allowedActions,
  formatContextValue,
  type PanelMembership,
  panelActor,
  parseContextValue,
  resolvePanelContext,
  startUnitOf,
  validateContextChoice,
} from "./panel-context";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function vinculo(over: Partial<PanelMembership> = {}): PanelMembership {
  return {
    membershipId: "m1",
    tenantId: T1,
    tenantName: "Empresa 1",
    accountStatus: "active",
    role: "owner",
    permissions: [],
    panelAccess: true,
    allUnits: true,
    unitIds: [A, B],
    defaultUnitId: null,
    preferredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("accountAllows: situação da conta", () => {
  it.each([
    ["active", "owner", true, true],
    ["active", "manager", true, true],
    ["read_only", "owner", true, false],
    ["read_only", "accountant", true, false],
    ["canceled", "owner", true, false],
    ["canceled", "manager", false, false],
    ["canceled", "accountant", false, false],
    ["closed", "owner", false, false],
    ["closed", "staff", false, false],
  ] as const)("%s para %s: leitura %s, escrita %s", (status, role, read, write) => {
    expect(accountAllows(status, role)).toEqual({ read, write });
  });

  it("cobre as quatro situações conhecidas", () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(accountAllows(status, "owner")).toHaveProperty("read");
    }
  });
});

describe("parseContextValue e formatContextValue", () => {
  it("aceita empresa e unidade em UUID", () => {
    expect(parseContextValue(`${T1}.${A}`)).toEqual({ tenantId: T1, unitId: A });
  });

  it("aceita empresa e todas as unidades", () => {
    expect(parseContextValue(`${T1}.all`)).toEqual({ tenantId: T1, unitId: "all" });
  });

  it.each([
    ["vazio", ""],
    ["sem ponto", "abc"],
    ["unidade vazia", `${T1}.`],
    ["três partes", `${T1}.${A}.x`],
    ["UUID em maiúsculas", `${A.toUpperCase()}.${A}`],
    ["all em maiúsculas", `${T1}.ALL`],
    ["com espaço", `${T1}. ${A}`],
    ["espaço no fim", `${T1}.all `],
  ])("recusa valor malformado: %s", (_nome, raw) => {
    expect(parseContextValue(raw)).toBeNull();
  });

  it.each([[undefined], [null]])("trata %s como ausente", (raw) => {
    expect(parseContextValue(raw)).toBeNull();
  });

  it("formata e volta ao mesmo valor", () => {
    for (const unitId of [A, "all"] as const) {
      const texto = formatContextValue({ tenantId: T1, unitId });
      expect(texto).toBe(`${T1}.${unitId}`);
      expect(parseContextValue(texto)).toEqual({ tenantId: T1, unitId });
    }
  });
});

describe("panelActor", () => {
  it("todas as unidades vira 'all'", () => {
    expect(panelActor(vinculo({ allUnits: true }))).toEqual({
      role: "owner",
      permissions: [],
      units: "all",
      panelAccess: true,
    });
  });

  it("unidades específicas viram a lista acessível", () => {
    const actor = panelActor(
      vinculo({ role: "manager", allUnits: false, unitIds: [A], permissions: ["VER_FOLHA"] }),
    );
    expect(actor.units).toEqual([A]);
    expect(actor.permissions).toEqual(["VER_FOLHA"]);
  });
});

describe("resolvePanelContext", () => {
  it("sem vínculos, não há acesso", () => {
    expect(resolvePanelContext([], null)).toEqual({ ok: false, reason: "no_access" });
  });

  it("cookie válido é respeitado", () => {
    const r = resolvePanelContext([vinculo()], { tenantId: T1, unitId: A });
    expect(r).toMatchObject({
      ok: true,
      source: "cookie",
      context: { tenantId: T1, unitId: A, membershipId: "m1", accountStatus: "active" },
    });
  });

  it("cookie com todas as unidades vale para quem tem acesso a todas", () => {
    const r = resolvePanelContext([vinculo()], { tenantId: T1, unitId: "all" });
    expect(r).toMatchObject({ ok: true, source: "cookie", context: { unitId: "all" } });
  });

  it("sem cookie usa o fallback", () => {
    const r = resolvePanelContext([vinculo()], null);
    expect(r).toMatchObject({ ok: true, source: "fallback", context: { unitId: "all" } });
  });

  it("cookie de empresa sem vínculo vira invalid_cookie e cai no fallback por preferred_at", () => {
    const ms = [
      vinculo({ membershipId: "m1", tenantId: T1, preferredAt: new Date("2026-02-01") }),
      vinculo({ membershipId: "m2", tenantId: T2, preferredAt: new Date("2026-03-01") }),
    ];
    const r = resolvePanelContext(ms, { tenantId: T3, unitId: "all" });
    expect(r).toMatchObject({ ok: true, source: "invalid_cookie", context: { tenantId: T2 } });
  });

  it("empresa do cookie com vínculo desativado (ausente da lista) cai em outra", () => {
    const ms = [vinculo({ membershipId: "m1", tenantId: T1 })];
    const r = resolvePanelContext(ms, { tenantId: T2, unitId: A });
    expect(r).toMatchObject({ ok: true, source: "invalid_cookie", context: { tenantId: T1 } });
  });

  it("gerente com [A] e cookie all fica inválido e recebe A", () => {
    const m = vinculo({ role: "manager", allUnits: false, unitIds: [A] });
    const r = resolvePanelContext([m], { tenantId: T1, unitId: "all" });
    expect(r).toMatchObject({ ok: true, source: "invalid_cookie", context: { unitId: A } });
  });

  it("gerente com [A] e cookie B fica inválido e nunca recebe B", () => {
    const m = vinculo({ role: "manager", allUnits: false, unitIds: [A] });
    const r = resolvePanelContext([m], { tenantId: T1, unitId: B });
    expect(r).toMatchObject({ ok: true, source: "invalid_cookie", context: { unitId: A } });
  });

  it("empresa do cookie válida e unidade inválida mantém a empresa e recalcula a unidade", () => {
    const ms = [
      vinculo({
        membershipId: "m1",
        tenantId: T1,
        role: "manager",
        allUnits: false,
        unitIds: [A],
        preferredAt: new Date("2026-01-01"),
      }),
      vinculo({ membershipId: "m2", tenantId: T2, preferredAt: new Date("2026-06-01") }),
    ];
    const r = resolvePanelContext(ms, { tenantId: T1, unitId: B });
    expect(r).toMatchObject({
      ok: true,
      source: "invalid_cookie",
      context: { tenantId: T1, unitId: A, membershipId: "m1" },
    });
  });

  describe("unidade de fallback sem cookie", () => {
    it("dono com todas as unidades recebe all", () => {
      const r = resolvePanelContext([vinculo()], null);
      expect(r).toMatchObject({ ok: true, context: { unitId: "all" } });
    });

    it("gerente com unidade padrão acessível recebe a padrão", () => {
      const m = vinculo({ role: "manager", allUnits: false, unitIds: [A, B], defaultUnitId: B });
      expect(resolvePanelContext([m], null)).toMatchObject({ ok: true, context: { unitId: B } });
    });

    it("gerente com padrão fora do acesso recebe a menor unidade acessível", () => {
      const m = vinculo({ role: "manager", allUnits: false, unitIds: [C, B], defaultUnitId: A });
      expect(resolvePanelContext([m], null)).toMatchObject({ ok: true, context: { unitId: B } });
    });
  });

  describe("ordem do fallback global (DE-25)", () => {
    it("preferred_at mais recente vem antes, nulos por último", () => {
      const ms = [
        vinculo({ membershipId: "m1", tenantId: T1, preferredAt: null }),
        vinculo({ membershipId: "m2", tenantId: T2, preferredAt: new Date("2026-05-01") }),
        vinculo({ membershipId: "m3", tenantId: T3, preferredAt: new Date("2026-04-01") }),
      ];
      const r = resolvePanelContext(ms, null);
      expect(r).toMatchObject({ ok: true, context: { tenantId: T2 } });
      if (r.ok) expect(r.companies.map((c) => c.membershipId)).toEqual(["m2", "m3", "m1"]);
    });

    it("empate de preferred_at nulo vai para o createdAt mais antigo", () => {
      const ms = [
        vinculo({ membershipId: "m1", tenantId: T1, createdAt: new Date("2026-03-01") }),
        vinculo({ membershipId: "m2", tenantId: T2, createdAt: new Date("2026-01-01") }),
      ];
      expect(resolvePanelContext(ms, null)).toMatchObject({
        ok: true,
        context: { tenantId: T2 },
      });
    });

    it("empate total desempata pelo id do vínculo", () => {
      const ms = [
        vinculo({ membershipId: "m9", tenantId: T1 }),
        vinculo({ membershipId: "m2", tenantId: T2 }),
      ];
      expect(resolvePanelContext(ms, null)).toMatchObject({
        ok: true,
        context: { membershipId: "m2" },
      });
    });
  });

  describe("situação da conta no painel", () => {
    it("contador em empresa canceled some e cai na próxima", () => {
      const ms = [
        vinculo({
          membershipId: "m1",
          tenantId: T1,
          role: "accountant",
          accountStatus: "canceled",
        }),
        vinculo({ membershipId: "m2", tenantId: T2, role: "accountant" }),
      ];
      const r = resolvePanelContext(ms, { tenantId: T1, unitId: "all" });
      expect(r).toMatchObject({ ok: true, source: "invalid_cookie", context: { tenantId: T2 } });
      if (r.ok) expect(r.companies.map((c) => c.tenantId)).toEqual([T2]);
    });

    it("contador só com empresa canceled não tem acesso", () => {
      const m = vinculo({ role: "accountant", accountStatus: "canceled" });
      expect(resolvePanelContext([m], null)).toEqual({ ok: false, reason: "no_access" });
    });

    it("dono em empresa canceled ainda entra", () => {
      const m = vinculo({ accountStatus: "canceled" });
      expect(resolvePanelContext([m], null)).toMatchObject({ ok: true });
    });

    it("closed some para todos, inclusive o dono", () => {
      for (const role of ["owner", "manager", "staff", "accountant"] as const) {
        const m = vinculo({ role, accountStatus: "closed" });
        expect(resolvePanelContext([m], null)).toEqual({ ok: false, reason: "no_access" });
      }
    });
  });

  it("lançador sem panelAccess não entra", () => {
    const m = vinculo({ role: "staff", panelAccess: false, allUnits: false });
    expect(resolvePanelContext([m], null)).toEqual({ ok: false, reason: "no_access" });
  });

  it("lançador com panelAccess entra", () => {
    const m = vinculo({ role: "staff", panelAccess: true, allUnits: false });
    expect(resolvePanelContext([m], null)).toMatchObject({ ok: true });
  });

  it("vínculo sem unidade acessível ativa fica fora de companies", () => {
    const ms = [
      vinculo({ membershipId: "m1", tenantId: T1, unitIds: [], allUnits: true }),
      vinculo({ membershipId: "m2", tenantId: T2 }),
    ];
    const r = resolvePanelContext(ms, { tenantId: T1, unitId: "all" });
    expect(r).toMatchObject({ ok: true, source: "invalid_cookie", context: { tenantId: T2 } });
    if (r.ok) expect(r.companies.map((c) => c.membershipId)).toEqual(["m2"]);
  });

  it("vínculo único sem unidade acessível não tem acesso", () => {
    const m = vinculo({ unitIds: [] });
    expect(resolvePanelContext([m], null)).toEqual({ ok: false, reason: "no_access" });
  });

  it("companies exclui as filtradas e mantém as válidas", () => {
    const ms = [
      vinculo({ membershipId: "m1", tenantId: T1 }),
      vinculo({ membershipId: "m2", tenantId: T2, accountStatus: "closed" }),
      vinculo({ membershipId: "m3", tenantId: T3, role: "staff", panelAccess: false }),
    ];
    const r = resolvePanelContext(ms, null);
    expect(r.ok && r.companies.map((c) => c.membershipId)).toEqual(["m1"]);
  });

  it("o actor do contexto reflete o vínculo e a situação da conta é repassada", () => {
    const m = vinculo({
      accountStatus: "read_only",
      role: "accountant",
      allUnits: false,
      unitIds: [A],
    });
    const r = resolvePanelContext([m], null);
    expect(r).toMatchObject({
      ok: true,
      context: {
        accountStatus: "read_only",
        actor: { role: "accountant", units: [A] },
      },
    });
  });
});

describe("validateContextChoice", () => {
  it("devolve o contexto quando empresa e unidade valem", () => {
    expect(validateContextChoice([vinculo()], { tenantId: T1, unitId: A })).toMatchObject({
      tenantId: T1,
      unitId: A,
      membershipId: "m1",
    });
  });

  it("aceita all para quem tem todas as unidades", () => {
    expect(validateContextChoice([vinculo()], { tenantId: T1, unitId: "all" })).toMatchObject({
      unitId: "all",
    });
  });

  it.each([
    ["empresa sem vínculo", { tenantId: T2, unitId: A }, {}],
    [
      "all para gerente com unidades específicas",
      { tenantId: T1, unitId: "all" },
      { role: "manager", allUnits: false, unitIds: [A] },
    ],
    [
      "unidade fora do acesso",
      { tenantId: T1, unitId: B },
      { role: "manager", allUnits: false, unitIds: [A] },
    ],
    ["unidade inativa (fora de unitIds)", { tenantId: T1, unitId: C }, {}],
    ["empresa closed", { tenantId: T1, unitId: A }, { accountStatus: "closed" }],
    [
      "contador em empresa canceled",
      { tenantId: T1, unitId: A },
      { role: "accountant", accountStatus: "canceled" },
    ],
    ["lançador sem painel", { tenantId: T1, unitId: A }, { role: "staff", panelAccess: false }],
    ["vínculo sem unidades", { tenantId: T1, unitId: "all" }, { unitIds: [] }],
  ] as const)("devolve null: %s", (_nome, choice, over) => {
    expect(validateContextChoice([vinculo(over as Partial<PanelMembership>)], choice)).toBeNull();
  });
});

describe("allowedActions", () => {
  const actor = (over: Partial<Actor>): Actor => ({
    role: "owner",
    permissions: [],
    units: "all",
    panelAccess: true,
    ...over,
  });

  it("dono pode gerenciar a assinatura", () => {
    expect(allowedActions(actor({}))).toContain("subscription:manage");
  });

  it("lançador com painel tem só entry:* e panel:access", () => {
    const acoes = allowedActions(actor({ role: "staff", units: [A] }));
    expect(acoes.length).toBeGreaterThan(0);
    for (const a of acoes) expect(a === "panel:access" || a.startsWith("entry:")).toBe(true);
    expect(acoes).toContain("panel:access");
  });

  it("lançador sem painel não tem panel:access", () => {
    expect(allowedActions(actor({ role: "staff", panelAccess: false }))).not.toContain(
      "panel:access",
    );
  });

  it("contador não edita lançamentos", () => {
    const acoes = allowedActions(actor({ role: "accountant" }));
    expect(acoes).not.toContain("entry:edit");
    expect(acoes).toContain("entry:view");
  });

  it("segue a ordem de ACTIONS", () => {
    const acoes = allowedActions(actor({}));
    expect(acoes).toEqual(ACTIONS.filter((a) => acoes.includes(a)));
    expect(ACTIONS).toHaveLength(18);
  });
});

describe("startUnitOf", () => {
  it("vínculo com todas as unidades começa em 'all'", () => {
    expect(startUnitOf(vinculo({ allUnits: true, unitIds: [A, B] }))).toBe("all");
  });

  it("começa na unidade padrão quando ela é acessível", () => {
    expect(startUnitOf(vinculo({ allUnits: false, unitIds: [A, B], defaultUnitId: B }))).toBe(B);
  });

  it("sem padrão acessível, começa na de menor id", () => {
    expect(startUnitOf(vinculo({ allUnits: false, unitIds: [C, B], defaultUnitId: A }))).toBe(B);
    expect(startUnitOf(vinculo({ allUnits: false, unitIds: [C, B], defaultUnitId: null }))).toBe(B);
  });
});
