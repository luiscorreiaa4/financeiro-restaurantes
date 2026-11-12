import { type PanelMembership, resolvePanelContext } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthStore } from "../src/auth-store";
import { createDatabase, createPool, withTenant } from "../src/client";
import {
  createPanelAccessStore,
  createTenantUnitsReader,
  hasAnyActiveMembership,
} from "../src/panel-access-store";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

const PERMISSION_DENIED = "42501";

let db: TestDatabase;
let authPool: ReturnType<typeof createPool>;
let appPool: ReturnType<typeof createPool>;
let panelStore: ReturnType<typeof createPanelAccessStore>;
let authStore: ReturnType<typeof createAuthStore>;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  authPool = createPool(db.urls.auth);
  appPool = createPool(db.urls.app);
  panelStore = createPanelAccessStore(createDatabase(authPool));
  authStore = createAuthStore(createDatabase(authPool));
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
});

afterAll(async () => {
  await authPool?.end();
  await appPool?.end();
  await db?.stop();
});

async function newUser(): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into users (id, name, email) values ($1, 'Pessoa', $2)", [
    id,
    `${id}@ex.com`,
  ]);
  return id;
}

async function newTenant(status = "active", name = "Empresa"): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into tenants (id, name, status) values ($1, $2, $3)", [
    id,
    name,
    status,
  ]);
  return id;
}

async function newUnit(tenantId: string, name: string, status = "active"): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into units (id, tenant_id, name, status) values ($1, $2, $3, $4)", [
    id,
    tenantId,
    name,
    status,
  ]);
  return id;
}

interface MembershipOptions {
  role?: string;
  allUnits?: boolean;
  panelAccess?: boolean;
  status?: string;
  deactivated?: boolean;
  unitIds?: string[];
  permissions?: string[];
  preferredAt?: Date | null;
}

async function newMembership(
  tenantId: string,
  userId: string,
  o: MembershipOptions = {},
): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into memberships
       (id, tenant_id, user_id, role, all_units, panel_access, status, deactivated_at, permissions, preferred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      id,
      tenantId,
      userId,
      o.role ?? "owner",
      o.allUnits ?? false,
      o.panelAccess ?? false,
      o.status ?? "active",
      o.deactivated ? new Date("2026-11-01T00:00:00Z") : null,
      JSON.stringify(o.permissions ?? []),
      o.preferredAt ?? null,
    ],
  );
  for (const unitId of o.unitIds ?? []) {
    await db.admin.query(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantId, id, unitId],
    );
  }
  return id;
}

async function authError(sql: string): Promise<string | undefined> {
  try {
    await authPool.query(sql);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("migration 0017: leitura do app_auth por coluna (DD-31)", () => {
  it("app_auth lê nome e situação da empresa, não o cnpj", async () => {
    const { rows } = await authPool.query("select id, name, status from tenants where id = $1", [
      a.tenantId,
    ]);
    expect(rows).toEqual([{ id: a.tenantId, name: "Restaurante A", status: "active" }]);
    expect(await authError("select cnpj from tenants")).toBe(PERMISSION_DENIED);
    expect(await authError("select * from tenants")).toBe(PERMISSION_DENIED);
    expect(await authError("select legal_name from tenants")).toBe(PERMISSION_DENIED);
  });

  it("o Drizzle gera só as colunas pedidas e funciona sob GRANT de colunas (passo 1)", async () => {
    const { tenants } = await import("../schema");
    const { eq } = await import("drizzle-orm");
    const drizzleDb = createDatabase(authPool);
    const rows = await drizzleDb
      .select({ id: tenants.id, name: tenants.name, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, a.tenantId));
    expect(rows).toEqual([{ id: a.tenantId, name: "Restaurante A", status: "active" }]);
  });

  it("app_auth lê id, tenant_id e status de units, não o name", async () => {
    const { rows } = await authPool.query("select id, tenant_id, status from units where id = $1", [
      a.unitId,
    ]);
    expect(rows).toEqual([{ id: a.unitId, tenant_id: a.tenantId, status: "active" }]);
    expect(await authError("select name from units")).toBe(PERMISSION_DENIED);
    expect(await authError("select cnpj from units")).toBe(PERMISSION_DENIED);
  });

  it("app_auth só lê (não grava) em tenants, units e membership_units", async () => {
    expect(await authError("update tenants set name = 'x'")).toBe(PERMISSION_DENIED);
    expect(await authError("delete from units")).toBe(PERMISSION_DENIED);
    expect(await authError("delete from membership_units")).toBe(PERMISSION_DENIED);
  });
});

describe("listPanelMemberships", () => {
  it("traz só vínculos ativos com painel, com unitIds, de todas as empresas do usuário e de nenhum outro usuário", async () => {
    const user = await newUser();
    const other = await newUser();
    const t1 = await newTenant("active", "Empresa Um");
    const t2 = await newTenant("read_only", "Empresa Dois");
    const t3 = await newTenant("active", "Empresa Três");
    const u1 = await newUnit(t1, "Loja 1");
    const u2 = await newUnit(t2, "Loja 2");
    const u3 = await newUnit(t3, "Loja 3");
    const preferredAt = new Date("2026-11-05T10:00:00Z");
    const owner = await newMembership(t1, user, { role: "owner", allUnits: true, preferredAt });
    const accountant = await newMembership(t2, user, {
      role: "accountant",
      unitIds: [u2],
      permissions: ["EXPORTAR_DADOS"],
    });
    // Fora: lançador sem painel, vínculo desativado, convidado e vínculo de outro usuário.
    await newMembership(t3, user, { role: "staff", panelAccess: false, unitIds: [u3] });
    const t4 = await newTenant();
    await newUnit(t4, "Loja 4");
    await newMembership(t4, user, { role: "owner", allUnits: true, deactivated: true });
    const t5 = await newTenant();
    await newUnit(t5, "Loja 5");
    await newMembership(t5, user, { role: "owner", allUnits: true, status: "invited" });
    await newMembership(t1, other, { role: "owner", allUnits: true });

    const result = await panelStore.listPanelMemberships(user);

    expect(result.map((m) => m.membershipId).sort()).toEqual([owner, accountant].sort());
    const byTenant = new Map(result.map((m) => [m.tenantId, m]));
    expect(byTenant.get(t1)).toEqual({
      membershipId: owner,
      tenantId: t1,
      tenantName: "Empresa Um",
      accountStatus: "active",
      role: "owner",
      permissions: [],
      panelAccess: false,
      allUnits: true,
      unitIds: [u1],
      defaultUnitId: null,
      preferredAt,
      createdAt: expect.any(Date),
    } satisfies PanelMembership);
    expect(byTenant.get(t2)).toMatchObject({
      accountStatus: "read_only",
      role: "accountant",
      permissions: ["EXPORTAR_DADOS"],
      allUnits: false,
      unitIds: [u2],
      preferredAt: null,
    });
    expect(await panelStore.listPanelMemberships(uuidv7())).toEqual([]);
  });

  it("lançador com painel liberado entra na lista", async () => {
    const user = await newUser();
    const t = await newTenant();
    const u = await newUnit(t, "Loja");
    await newMembership(t, user, { role: "staff", panelAccess: true, unitIds: [u] });
    const result = await panelStore.listPanelMemberships(user);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: "staff", panelAccess: true, unitIds: [u] });
  });

  it("unitIds exclui unidade inativa; com all_units traz todas as ativas", async () => {
    const user = await newUser();
    const manager = await newUser();
    const t = await newTenant();
    const active1 = await newUnit(t, "Ativa 1");
    const active2 = await newUnit(t, "Ativa 2");
    const inactive = await newUnit(t, "Inativa", "inactive");
    await newMembership(t, user, { role: "owner", allUnits: true });
    const t2 = await newTenant();
    const x = await newUnit(t2, "X");
    const y = await newUnit(t2, "Y", "inactive");
    await newMembership(t, manager, { role: "manager", unitIds: [active1, inactive] });
    await newMembership(t2, manager, { role: "manager", unitIds: [x, y] });

    const [ownerRow] = await panelStore.listPanelMemberships(user);
    expect([...(ownerRow?.unitIds ?? [])].sort()).toEqual([active1, active2].sort());

    const managerRows = await panelStore.listPanelMemberships(manager);
    const byTenant = new Map(managerRows.map((m) => [m.tenantId, m]));
    expect(byTenant.get(t)?.unitIds).toEqual([active1]);
    expect(byTenant.get(t2)?.unitIds).toEqual([x]);
  });

  it("as unidades de uma empresa não vazam para o vínculo de outra", async () => {
    const user = await newUser();
    const manager = await newUser();
    await newMembership(a.tenantId, user, { role: "owner", allUnits: true });
    await newMembership(b.tenantId, manager, { role: "manager", unitIds: [b.unitId] });
    const [row] = await panelStore.listPanelMemberships(user);
    expect(row?.unitIds).toEqual([a.unitId]);
    const [managerRow] = await panelStore.listPanelMemberships(manager);
    expect(managerRow?.unitIds).toEqual([b.unitId]);
  });
});

describe("hasActiveMembership (DD-31)", () => {
  it("falso quando a única empresa está closed", async () => {
    const user = await newUser();
    const t = await newTenant("closed");
    await newUnit(t, "Loja");
    await newMembership(t, user, { role: "owner", allUnits: true });
    expect(await authStore.hasActiveMembership(user)).toBe(false);
  });

  it("falso para gerente em empresa canceled e verdadeiro para owner", async () => {
    const owner = await newUser();
    const manager = await newUser();
    const t = await newTenant("canceled");
    const u = await newUnit(t, "Loja");
    await newMembership(t, owner, { role: "owner", allUnits: true });
    await newMembership(t, manager, { role: "manager", unitIds: [u] });
    expect(await authStore.hasActiveMembership(owner)).toBe(true);
    expect(await authStore.hasActiveMembership(manager)).toBe(false);
  });

  it("falso quando o vínculo não tem nenhuma unidade ativa", async () => {
    const user = await newUser();
    const t = await newTenant();
    const inactive = await newUnit(t, "Fechada", "inactive");
    await newMembership(t, user, { role: "manager", unitIds: [inactive] });
    expect(await authStore.hasActiveMembership(user)).toBe(false);
  });

  it("concorda com resolvePanelContext(listPanelMemberships) em todas as personas", async () => {
    interface Persona {
      tenantStatus: string;
      role: string;
      panelAccess?: boolean;
      allUnits?: boolean;
      deactivated?: boolean;
      status?: string;
      unitStatus?: string;
      withUnits?: boolean;
    }
    const personas: Persona[] = [];
    for (const tenantStatus of ["active", "read_only", "canceled", "closed"]) {
      for (const role of ["owner", "manager", "staff", "accountant"]) {
        for (const panelAccess of [false, true]) {
          for (const allUnits of [false, true]) {
            for (const unitStatus of ["active", "inactive"]) {
              personas.push({ tenantStatus, role, panelAccess, allUnits, unitStatus });
            }
          }
        }
      }
    }
    personas.push(
      { tenantStatus: "active", role: "owner", allUnits: true, deactivated: true },
      { tenantStatus: "active", role: "owner", allUnits: true, status: "invited" },
      { tenantStatus: "active", role: "manager", withUnits: false },
    );

    let allowed = 0;
    let denied = 0;
    for (const p of personas) {
      const user = await newUser();
      const t = await newTenant(p.tenantStatus);
      const u = await newUnit(t, "Loja", p.unitStatus ?? "active");
      await newMembership(t, user, {
        role: p.role,
        panelAccess: p.panelAccess ?? false,
        allUnits: p.allUnits ?? false,
        deactivated: p.deactivated ?? false,
        status: p.status ?? "active",
        unitIds: p.allUnits || p.withUnits === false ? [] : [u],
      });
      const expected = (await authStore.panelEntry(user)).kind === "full";
      expect(await authStore.hasActiveMembership(user), JSON.stringify(p)).toBe(expected);
      // A entrada completa também concorda com a regra pura do painel.
      expect(resolvePanelContext(await panelStore.listPanelMemberships(user), null).ok).toBe(
        expected,
      );
      if (expected) allowed++;
      else denied++;
    }
    // O cenário precisa exercitar os dois lados.
    expect(allowed).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
  });
});

describe("panelEntry (DD-33, A4)", () => {
  it("dono sem unidade ativa: restrito owner_no_unit", async () => {
    const user = await newUser();
    const t = await newTenant();
    await newMembership(t, user, { role: "owner", allUnits: true });
    expect(await authStore.panelEntry(user)).toEqual({
      kind: "restricted",
      reason: "owner_no_unit",
    });
    expect(await authStore.hasActiveMembership(user)).toBe(false);
  });

  it("dono com a empresa A sem unidade e a B normal: full", async () => {
    const user = await newUser();
    const ta = await newTenant();
    const tb = await newTenant();
    await newUnit(tb, "Loja");
    await newMembership(ta, user, { role: "owner", allUnits: true });
    await newMembership(tb, user, { role: "owner", allUnits: true });
    expect(await authStore.panelEntry(user)).toEqual({ kind: "full" });
  });

  it("só vínculo desativado: restrito no_membership", async () => {
    const user = await newUser();
    const t = await newTenant();
    await newUnit(t, "Loja");
    await newMembership(t, user, { role: "owner", allUnits: true, deactivated: true });
    expect(await authStore.panelEntry(user)).toEqual({
      kind: "restricted",
      reason: "no_membership",
    });
  });

  it("só vínculo invited: restrito no_membership", async () => {
    const user = await newUser();
    const t = await newTenant();
    await newUnit(t, "Loja");
    await newMembership(t, user, { role: "owner", allUnits: true, status: "invited" });
    expect(await authStore.panelEntry(user)).toEqual({
      kind: "restricted",
      reason: "no_membership",
    });
  });

  it("usuário sem nenhum vínculo: restrito no_membership", async () => {
    expect(await authStore.panelEntry(await newUser())).toEqual({
      kind: "restricted",
      reason: "no_membership",
    });
  });

  it("gerente sem unidade ativa: recusado ask_owner", async () => {
    const user = await newUser();
    const t = await newTenant();
    const inactive = await newUnit(t, "Fechada", "inactive");
    await newMembership(t, user, { role: "manager", unitIds: [inactive] });
    expect(await authStore.panelEntry(user)).toEqual({ kind: "refused", reason: "ask_owner" });
  });

  it("lançador ativo sem painel: recusado no_access", async () => {
    const user = await newUser();
    const t = await newTenant();
    const u = await newUnit(t, "Loja");
    await newMembership(t, user, { role: "staff", panelAccess: false, unitIds: [u] });
    expect(await authStore.panelEntry(user)).toEqual({ kind: "refused", reason: "no_access" });
  });

  it("dono de empresa closed: recusado no_access", async () => {
    const user = await newUser();
    const t = await newTenant("closed");
    await newUnit(t, "Loja");
    await newMembership(t, user, { role: "owner", allUnits: true });
    expect(await authStore.panelEntry(user)).toEqual({ kind: "refused", reason: "no_access" });
  });

  it("hasAnyActiveMembership lê só vínculos ativos e não desativados", async () => {
    const t = await newTenant();
    const none = await newUser();
    const active = await newUser();
    const off = await newUser();
    const inv = await newUser();
    await newMembership(t, active, { role: "staff" });
    await newMembership(t, off, { role: "staff", deactivated: true });
    await newMembership(t, inv, { role: "staff", status: "invited" });
    const d = createDatabase(authPool);
    expect(await hasAnyActiveMembership(d, none)).toBe(false);
    expect(await hasAnyActiveMembership(d, active)).toBe(true);
    expect(await hasAnyActiveMembership(d, off)).toBe(false);
    expect(await hasAnyActiveMembership(d, inv)).toBe(false);
  });
});

describe("createTenantUnitsReader", () => {
  it("listActiveUnits sob withTenant(A) não vê unidade de B (RNF02.CA01) e vem ordenada por nome", async () => {
    const t = await newTenant();
    await newUnit(t, "Zeta");
    await newUnit(t, "Alfa");
    await newUnit(t, "Inativa", "inactive");
    const appDb = createDatabase(appPool);
    const reader = createTenantUnitsReader();

    const forA = await withTenant(appDb, a.tenantId, (tx) => reader.listActiveUnits(tx));
    expect(forA).toEqual([{ id: a.unitId, name: "Matriz" }]);
    expect(forA.some((u) => u.id === b.unitId)).toBe(false);

    const forT = await withTenant(appDb, t, (tx) => reader.listActiveUnits(tx));
    expect(forT.map((u) => u.name)).toEqual(["Alfa", "Zeta"]);
  });
});
