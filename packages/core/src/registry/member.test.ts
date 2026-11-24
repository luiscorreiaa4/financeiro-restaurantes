import { describe, expect, it } from "vitest";
import {
  buildInviteText,
  isAccessReduction,
  type MemberInput,
  type MemberState,
  maskEmail,
  maskPhone,
  planMemberCreate,
  planMemberUpdate,
} from "./member";

const U1 = "0190aaaa-0000-7000-8000-000000000001";
const U2 = "0190aaaa-0000-7000-8000-000000000002";
const NOW = new Date("2026-11-23T12:00:00Z");

const createCtx = {
  tenantUnitIds: [U1, U2],
  productPhoneE164: "+5511911112222",
  actorId: "actor-1",
  now: NOW,
};

const input = (over: Partial<MemberInput> = {}): MemberInput => ({
  displayName: "Fulano de Tal",
  phone: "(11) 98765-5647",
  email: null,
  role: "staff",
  allUnits: false,
  unitIds: [U1],
  defaultUnitId: null,
  panelAccess: false,
  permissions: [],
  ...over,
});

const member = (over: Partial<MemberState> = {}): MemberState => ({
  id: "m-1",
  userId: "u-1",
  displayName: "Fulano de Tal",
  phone: "+5511987655647",
  email: "fulano@dominio.com",
  role: "manager",
  allUnits: false,
  unitIds: [U1, U2],
  defaultUnitId: U1,
  panelAccess: true,
  permissions: [],
  status: "active",
  ...over,
});

const updateCtx = {
  activeOwnerIds: ["m-owner"],
  tenantUnitIds: [U1, U2],
  productPhoneE164: "+5511976543210" as string | null,
  actorId: "a",
  now: NOW,
};

describe("planMemberCreate", () => {
  it("CA01: com e sem o 9º dígito dão o mesmo celular", () => {
    const a = planMemberCreate(input({ phone: "11987655647" }), createCtx);
    const b = planMemberCreate(input({ phone: "+55 11 8765-5647" }), createCtx);
    if (!a.ok || !b.ok) throw new Error("esperava ok");
    expect(a.value.phone.e164).toBe("+5511987655647");
    expect(b.value.phone.e164).toBe(a.value.phone.e164);
    expect(a.value.phone.lookupCandidates).toContain("+551187655647");
    expect(a.value.membership.status).toBe("invited");
    expect(a.value.membership.defaultUnitId).toBe(U1);
    expect(a.value.membership.invitedBy).toBe("actor-1");
  });

  it("CA01: recusa celular estrangeiro", () => {
    const r = planMemberCreate(input({ phone: "+1 415 555 2671" }), createCtx);
    expect(r).toMatchObject({ ok: false, error: { code: "ForeignPhone" } });
  });

  it("CA01: recusa o número do produto, com ou sem o 9", () => {
    for (const phone of ["+5511987655647", "1187655647", "(11) 98765-5647"]) {
      const r = planMemberCreate(input({ phone }), {
        ...createCtx,
        productPhoneE164: "+5511987655647",
      });
      expect(r, phone).toMatchObject({ ok: false, error: { code: "ProductNumber" } });
    }
    const without9 = planMemberCreate(input({ phone: "1187655647" }), {
      ...createCtx,
      productPhoneE164: "+5511987655647",
    });
    expect(without9).toMatchObject({ ok: false, error: { code: "ProductNumber" } });
  });

  it("recusa celular inválido", () => {
    expect(planMemberCreate(input({ phone: "123" }), createCtx)).toMatchObject({
      ok: false,
      error: { code: "InvalidPhone" },
    });
  });

  it("RF05.R1: nome de 2 a 120 caracteres", () => {
    expect(planMemberCreate(input({ displayName: "A" }), createCtx).ok).toBe(false);
    expect(planMemberCreate(input({ displayName: "A".repeat(121) }), createCtx).ok).toBe(false);
    expect(planMemberCreate(input({ displayName: "  Ana  " }), createCtx).ok).toBe(true);
  });

  it("recusa e-mail malformado ou longo demais", () => {
    for (const email of ["sem-arroba", "a@", "a b@c.com", `${"a".repeat(250)}@b.com`]) {
      expect(planMemberCreate(input({ email }), createCtx), email).toMatchObject({
        ok: false,
        error: { code: "InvalidEmail" },
      });
    }
  });

  it("CA03: e-mail obrigatório com painel", () => {
    expect(planMemberCreate(input({ panelAccess: true }), createCtx)).toMatchObject({
      ok: false,
      error: { code: "EmailRequiredForPanel" },
    });
    expect(planMemberCreate(input({ panelAccess: true, email: "a@b.com" }), createCtx).ok).toBe(
      true,
    );
  });

  it("CA04: unidade padrão entre as de acesso; automática com uma só", () => {
    expect(
      planMemberCreate(input({ unitIds: [U1, U2], defaultUnitId: null }), createCtx),
    ).toMatchObject({ ok: false, error: { code: "DefaultUnitRequired" } });
    expect(planMemberCreate(input({ unitIds: [U1], defaultUnitId: U2 }), createCtx)).toMatchObject({
      ok: false,
      error: { code: "DefaultUnitOutsideAccess" },
    });
    expect(
      planMemberCreate(input({ unitIds: ["x-fora"], defaultUnitId: null }), createCtx),
    ).toMatchObject({ ok: false, error: { code: "UnitOutsideTenant" } });
  });

  it("dono precisa de todas as unidades", () => {
    expect(planMemberCreate(input({ role: "owner" }), createCtx)).toMatchObject({
      ok: false,
      error: { code: "OwnerNeedsAllUnits" },
    });
    expect(
      planMemberCreate(input({ role: "owner", allUnits: true, unitIds: [] }), createCtx).ok,
    ).toBe(true);
  });

  it("VER_FOLHA em lançador é recusado", () => {
    expect(planMemberCreate(input({ permissions: ["VER_FOLHA"] }), createCtx)).toMatchObject({
      ok: false,
      error: { code: "InvalidPermission" },
    });
    expect(
      planMemberCreate(input({ permissions: ["CONSULTAR_RELATORIOS_WHATSAPP"] }), createCtx).ok,
    ).toBe(true);
  });

  it("auditoria leva celular e e-mail mascarados, sem nome", () => {
    const r = planMemberCreate(
      input({ panelAccess: true, email: "fulano@dominio.com" }),
      createCtx,
    );
    if (!r.ok) throw new Error("esperava ok");
    const json = JSON.stringify(r.value.audit);
    expect(json).toContain("•••• 5647");
    expect(json).toContain("f•••@dominio.com");
    expect(json).not.toContain("Fulano");
    expect(json).not.toContain("987655647");
  });
});

describe("planMemberUpdate", () => {
  it("CA06: não rebaixa o último dono ativo", () => {
    const owner = member({ id: "m-owner", role: "owner", allUnits: true, unitIds: [] });
    const r = planMemberUpdate(owner, { role: "manager" }, updateCtx);
    expect(r).toMatchObject({ ok: false, error: { code: "LastActiveOwner" } });
  });

  it("rebaixa dono quando há outro dono ativo", () => {
    const owner = member({ id: "m-owner", role: "owner", allUnits: true, unitIds: [] });
    const r = planMemberUpdate(
      owner,
      { role: "manager", allUnits: false, unitIds: [U1], defaultUnitId: U1 },
      { ...updateCtx, activeOwnerIds: ["m-owner", "m-owner-2"] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reducesAccess).toBe(true);
  });

  it("troca de celular devolve candidatos e só quando muda", () => {
    const same = planMemberUpdate(member(), { phone: "11 8765-5647" }, updateCtx);
    if (!same.ok) throw new Error("esperava ok");
    expect(same.value.phoneChange).toBeNull();
    const other = planMemberUpdate(member(), { phone: "11 91234-5678" }, updateCtx);
    if (!other.ok) throw new Error("esperava ok");
    expect(other.value.phoneChange?.e164).toBe("+5511912345678");
    expect(other.value.after.phone).toBe("+5511912345678");
  });

  it("recusa trocar o celular para o número do produto, com ou sem o 9", () => {
    const withNine = planMemberUpdate(member(), { phone: "(11) 97654-3210" }, updateCtx);
    expect(withNine).toMatchObject({ ok: false, error: { code: "ProductNumber" } });
    const withoutNine = planMemberUpdate(member(), { phone: "1176543210" }, updateCtx);
    expect(withoutNine).toMatchObject({ ok: false, error: { code: "ProductNumber" } });
  });

  it("recusa trocar o celular para número estrangeiro", () => {
    expect(planMemberUpdate(member(), { phone: "+1 415 555 2671" }, updateCtx)).toMatchObject({
      ok: false,
      error: { code: "ForeignPhone" },
    });
  });

  it("CA06: falha fechado se o dono atual não vier em activeOwnerIds", () => {
    const owner = member({ id: "m-owner", role: "owner", allUnits: true, unitIds: [] });
    const r = planMemberUpdate(owner, { role: "manager" }, { ...updateCtx, activeOwnerIds: [] });
    expect(r).toMatchObject({ ok: false, error: { code: "LastActiveOwner" } });
  });

  it("promover a dono funciona mesmo sem outros donos na lista", () => {
    const r = planMemberUpdate(
      member(),
      { role: "owner", allUnits: true, unitIds: [] },
      { ...updateCtx, activeOwnerIds: [] },
    );
    expect(r.ok).toBe(true);
  });

  it("recusa e-mail malformado ou longo demais na troca", () => {
    for (const email of ["sem-arroba", "a@", "a b@c.com", `${"a".repeat(250)}@b.com`]) {
      expect(planMemberUpdate(member(), { email }, updateCtx), email).toMatchObject({
        ok: false,
        error: { code: "InvalidEmail" },
      });
    }
  });

  it("troca de e-mail aparece em emailChange", () => {
    const r = planMemberUpdate(member(), { email: " Novo@Dominio.com " }, updateCtx);
    if (!r.ok) throw new Error("esperava ok");
    expect(r.value.emailChange).toBe("novo@dominio.com");
  });

  it("trocar o celular ou o e-mail conta como redução de acesso (encerra as sessões)", () => {
    const phone = planMemberUpdate(member(), { phone: "(11) 91234-5678" }, updateCtx);
    const email = planMemberUpdate(member(), { email: "outro@dominio.com" }, updateCtx);
    const name = planMemberUpdate(member(), { displayName: "Só o nome" }, updateCtx);
    if (!phone.ok || !email.ok || !name.ok) throw new Error("esperava ok");
    expect(phone.value.reducesAccess).toBe(true);
    expect(email.value.reducesAccess).toBe(true);
    expect(name.value.reducesAccess).toBe(false);
  });

  it("com vínculo em outra empresa, a auditoria não leva o e-mail", () => {
    const r = planMemberUpdate(
      member({ email: "pessoa@dominio.com" }),
      { displayName: "Novo Nome" },
      { ...updateCtx, sharedContact: true },
    );
    if (!r.ok) throw new Error("esperava ok");
    expect(r.value.audit.metadata.before?.email).toBeNull();
    expect(r.value.audit.metadata.after?.email).toBeNull();
    const plain = planMemberUpdate(
      member({ email: "pessoa@dominio.com" }),
      { displayName: "Novo Nome" },
      updateCtx,
    );
    if (!plain.ok) throw new Error("esperava ok");
    expect(plain.value.audit.metadata.after?.email).toBe("p•••@dominio.com");
  });

  it("retirar o e-mail de quem tem painel é recusado", () => {
    expect(planMemberUpdate(member(), { email: null }, updateCtx)).toMatchObject({
      ok: false,
      error: { code: "EmailRequiredForPanel" },
    });
  });

  it("promoção não reduz acesso", () => {
    const r = planMemberUpdate(
      member({ role: "staff", panelAccess: false }),
      { role: "manager" },
      updateCtx,
    );
    if (!r.ok) throw new Error("esperava ok");
    expect(r.value.reducesAccess).toBe(false);
  });
});

describe("isAccessReduction", () => {
  const base = member({ permissions: ["EXPORTAR_DADOS", "VER_FOLHA"] });
  it("papel abaixo", () => expect(isAccessReduction(base, { ...base, role: "staff" })).toBe(true));
  it("unidade retirada", () =>
    expect(isAccessReduction(base, { ...base, unitIds: [U1] })).toBe(true));
  it("TODAS para lista", () =>
    expect(
      isAccessReduction({ ...base, allUnits: true, unitIds: [] }, { ...base, unitIds: [U1] }),
    ).toBe(true));
  it("painel retirado", () =>
    expect(isAccessReduction(base, { ...base, panelAccess: false })).toBe(true));
  it("permissão retirada", () =>
    expect(isAccessReduction(base, { ...base, permissions: ["VER_FOLHA"] })).toBe(true));
  it("desativação", () =>
    expect(isAccessReduction(base, { ...base, status: "deactivated" })).toBe(true));
  it("promoção e acréscimos não reduzem", () => {
    const staff = member({ role: "staff", panelAccess: false, unitIds: [U1], permissions: [] });
    expect(isAccessReduction(staff, { ...staff, role: "manager" })).toBe(false);
    expect(isAccessReduction(staff, { ...staff, unitIds: [U1, U2], panelAccess: true })).toBe(
      false,
    );
    expect(isAccessReduction(staff, { ...staff, allUnits: true, unitIds: [] })).toBe(false);
  });
  it("sem mudança não reduz", () => expect(isAccessReduction(base, { ...base })).toBe(false));
});

describe("máscaras e convite", () => {
  it("maskPhone mostra só os 4 últimos dígitos", () =>
    expect(maskPhone("+5511987655647")).toBe("•••• 5647"));
  it("maskEmail mostra a primeira letra e o domínio", () =>
    expect(maskEmail("fulano@dominio.com")).toBe("f•••@dominio.com"));
  it("convite cita a empresa, manda dizer Oi e não traz número", () => {
    const text = buildInviteText("Ana", "Bar do Zé");
    expect(text).toContain("Bar do Zé");
    expect(text).toContain("Oi");
    expect(text).not.toMatch(/\d{8}/);
  });
});
