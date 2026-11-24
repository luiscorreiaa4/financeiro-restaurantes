import { type MemberState, planMemberUpdate } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createMemberDirectory } from "../src/member-directory";
import { createMembersRepo, type MemberScope } from "../src/members-repo";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
});

afterAll(async () => {
  await db?.stop();
});

const repo = () => createMembersRepo(createDatabase(db.app));
const directory = () => createMemberDirectory(createDatabase(db.auth));
const OWNER_SCOPE: MemberScope = { unitIds: "all", includeContact: true };
const NOW = new Date("2026-11-24T12:00:00.000Z");

let counter = 0;
const newPhone = () => `+55119${String(60000000 + ++counter)}`;

const draft = (overrides: Record<string, unknown> = {}) => ({
  displayName: "Fulano",
  role: "staff" as const,
  allUnits: false,
  unitIds: [] as string[],
  defaultUnitId: null as string | null,
  panelAccess: false,
  permissions: [] as never[],
  status: "invited" as const,
  invitedBy: a.userId,
  invitedAt: NOW,
  ...overrides,
});

const auditDraft = {
  action: "member.invite",
  target: null,
  metadata: { after: { phone: "•••• 0000", email: null } },
};

async function addMember(
  t: TenantFixture,
  overrides: Record<string, unknown> = {},
  email: string | null = null,
) {
  const phone = newPhone();
  const userId = await directory().createUser({ name: "Nome do usuário", phoneE164: phone, email });
  const result = await repo().insert(t.tenantId, userId, {
    membership: draft(overrides),
    audit: auditDraft,
  });
  return { userId, phone, ...result };
}

async function newUnit(t: TenantFixture, name: string): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, $3)", [
    id,
    t.tenantId,
    name,
  ]);
  return id;
}

async function addOwner(t: TenantFixture): Promise<{ id: string }> {
  const userId = uuidv7();
  const id = uuidv7();
  await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Dono 2', $2)", [
    userId,
    newPhone(),
  ]);
  await db.admin.query(
    "insert into memberships (id, tenant_id, user_id, role, all_units) values ($1, $2, $3, 'owner', true)",
    [id, t.tenantId, userId],
  );
  return { id };
}

describe("insert", () => {
  it("grava o vínculo convidado com nome, unidades e auditoria", async () => {
    const unit = await newUnit(a, "Filial insert");
    const m = await addMember(a, {
      displayName: "Maria da Cozinha",
      unitIds: [unit],
      defaultUnitId: unit,
      invitedBy: a.userId,
    });
    expect(m.created).toBe(true);
    const got = await repo().get(a.tenantId, m.id, OWNER_SCOPE);
    expect(got).toMatchObject({
      id: m.id,
      displayName: "Maria da Cozinha",
      role: "staff",
      status: "invited",
      allUnits: false,
      unitIds: [unit],
      defaultUnitId: unit,
      phone: m.phone,
      invitedAt: NOW.toISOString(),
      deactivatedAt: null,
    });
    const audit = await db.admin.query(
      "select actor_id, action, target, metadata from audit_log where tenant_id = $1 and target = $2",
      [a.tenantId, m.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_id: a.userId, action: "member.invite" });
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(m.phone);
  });

  it("vínculo já existente: created false, sem sobrescrever nada e sem nova auditoria", async () => {
    const first = await addMember(a, { displayName: "Original" });
    const again = await repo().insert(a.tenantId, first.userId, {
      membership: draft({ displayName: "Outro nome", role: "manager", allUnits: true }),
      audit: auditDraft,
    });
    expect(again).toEqual({ created: false, id: first.id });
    expect(await repo().get(a.tenantId, first.id, OWNER_SCOPE)).toMatchObject({
      displayName: "Original",
      role: "staff",
      allUnits: false,
    });
    const audit = await db.admin.query(
      "select 1 from audit_log where tenant_id = $1 and target = $2",
      [a.tenantId, first.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("Review Focus 1: celular que já é dono em B vira só um vínculo em A, sem mexer em B", async () => {
    const before = await db.admin.query(
      "select m.display_name, u.name from memberships m join users u on u.id = m.user_id where m.tenant_id = $1 and m.user_id = $2",
      [b.tenantId, b.userId],
    );
    const found = await directory().findUserByPhone([b.phone]);
    expect(found?.id).toBe(b.userId);
    const result = await repo().insert(a.tenantId, b.userId, {
      membership: draft({ displayName: "Nome em A" }),
      audit: auditDraft,
    });
    expect(result.created).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["created", "id"]);
    const after = await db.admin.query(
      "select m.display_name, u.name from memberships m join users u on u.id = m.user_id where m.tenant_id = $1 and m.user_id = $2",
      [b.tenantId, b.userId],
    );
    expect(after.rows).toEqual(before.rows);
    const inA = await db.admin.query(
      "select display_name from memberships where tenant_id = $1 and user_id = $2",
      [a.tenantId, b.userId],
    );
    expect(inA.rows).toEqual([{ display_name: "Nome em A" }]);
    expect(await directory().hasMembershipElsewhere(b.userId, a.tenantId)).toBe(true);
  });

  it("recusa unidade de outra empresa (chave composta)", async () => {
    const foreignUnit = await newUnit(b, "Unidade de B");
    const userId = await directory().createUser({
      name: "X",
      phoneE164: newPhone(),
      email: null,
    });
    await expect(
      repo().insert(a.tenantId, userId, {
        membership: draft({ unitIds: [foreignUnit], defaultUnitId: foreignUnit }),
        audit: auditDraft,
      }),
    ).rejects.toThrow();
    const left = await db.admin.query(
      "select 1 from memberships where tenant_id = $1 and user_id = $2",
      [a.tenantId, userId],
    );
    expect(left.rows).toHaveLength(0);
  });
});

describe("list e get", () => {
  it("gerente só vê vínculos com acesso às unidades dele e sem celular inteiro nem e-mail", async () => {
    const t = await createTenant(db.admin, "Restaurante Lista");
    const u1 = await newUnit(t, "U1");
    const u2 = await newUnit(t, "U2");
    const s1 = await addMember(
      t,
      { displayName: "Staff U1", unitIds: [u1], defaultUnitId: u1 },
      "s1@exemplo.com",
    );
    const s2 = await addMember(
      t,
      { displayName: "Staff U2", unitIds: [u2], defaultUnitId: u2 },
      "s2@exemplo.com",
    );
    const all = await addMember(t, { displayName: "Staff todas", allUnits: true });

    const scope: MemberScope = { unitIds: [u1], includeContact: false };
    const rows = await repo().list(t.tenantId, scope, {});
    const names = rows.map((r) => r.displayName);
    expect(names).toContain("Staff U1");
    expect(names).toContain("Staff todas");
    expect(names).not.toContain("Staff U2");
    for (const row of rows) {
      expect(row.phone).toBeUndefined();
      expect(row.email).toBeUndefined();
      expect(row.phoneMasked).toMatch(/^•••• \d{4}$/);
    }
    expect(await repo().get(t.tenantId, s2.id, scope)).toBeNull();
    const own = await repo().get(t.tenantId, s1.id, scope);
    expect(own?.phone).toBeUndefined();
    expect(own?.email).toBeUndefined();
    expect(own?.phoneMasked).toBe(`•••• ${s1.phone.slice(-4)}`);
    expect((await repo().get(t.tenantId, all.id, scope))?.id).toBe(all.id);
  });

  it("dono: lista com celular mascarado e e-mail; get com o celular inteiro", async () => {
    const t = await createTenant(db.admin, "Restaurante Dono");
    const m = await addMember(t, { displayName: "Com contato" }, "contato@exemplo.com");
    const rows = await repo().list(t.tenantId, OWNER_SCOPE, {});
    const row = rows.find((r) => r.id === m.id);
    expect(row?.phone).toBeUndefined();
    expect(row?.phoneMasked).toBe(`•••• ${m.phone.slice(-4)}`);
    expect(row?.email).toBe("contato@exemplo.com");
    const full = await repo().get(t.tenantId, m.id, OWNER_SCOPE);
    expect(full?.phone).toBe(m.phone);
    expect(full?.email).toBe("contato@exemplo.com");
  });

  it("filtros: nome, final do celular, papel, unidade e situação; display_name vale sobre users.name", async () => {
    const t = await createTenant(db.admin, "Restaurante Filtro");
    const u1 = await newUnit(t, "F1");
    const x = await addMember(t, {
      displayName: "Zelador Xavier",
      unitIds: [u1],
      defaultUnitId: u1,
    });
    const y = await addMember(t, { displayName: "Garçom Yuri", role: "manager", allUnits: true });
    const byName = await repo().list(t.tenantId, OWNER_SCOPE, { search: "xavier" });
    expect(byName.map((r) => r.id)).toEqual([x.id]);
    const byPhone = await repo().list(t.tenantId, OWNER_SCOPE, { search: y.phone.slice(-4) });
    expect(byPhone.map((r) => r.id)).toContain(y.id);
    expect(
      (await repo().list(t.tenantId, OWNER_SCOPE, { role: "manager" })).map((r) => r.id),
    ).toContain(y.id);
    expect(
      (await repo().list(t.tenantId, OWNER_SCOPE, { role: "staff" })).map((r) => r.id),
    ).not.toContain(y.id);
    const byUnit = await repo().list(t.tenantId, OWNER_SCOPE, { unitId: u1 });
    expect(byUnit.map((r) => r.id).sort()).toEqual(
      [x.id, y.id, ...byUnit.filter((r) => r.role === "owner").map((r) => r.id)].sort(),
    );
    const invited = await repo().list(t.tenantId, OWNER_SCOPE, { status: "invited" });
    expect(invited.map((r) => r.id).sort()).toEqual([x.id, y.id].sort());
    expect(await repo().list(t.tenantId, OWNER_SCOPE, { search: "Nome do usuário" })).toEqual([]);
  });

  it("A nunca lê vínculo de B", async () => {
    const inB = await db.admin.query(
      "select id from memberships where tenant_id = $1 and role = 'owner'",
      [b.tenantId],
    );
    const idB = inB.rows[0].id as string;
    expect(await repo().get(a.tenantId, idB, OWNER_SCOPE)).toBeNull();
    const rows = await repo().list(a.tenantId, OWNER_SCOPE, {});
    expect(rows.map((r) => r.id)).not.toContain(idB);
  });
});

describe("update", () => {
  const stepFor =
    (patch: Parameters<typeof planMemberUpdate>[1], tenantUnitIds: string[]) =>
    (before: MemberState, activeOwnerIds: string[]) =>
      planMemberUpdate(before, patch, {
        activeOwnerIds,
        tenantUnitIds,
        productPhoneE164: null,
        actorId: a.userId,
        now: NOW,
      });

  it("grava o depois (nome, papel, unidades) e a auditoria, e devolve o resultado do passo", async () => {
    const t = await createTenant(db.admin, "Restaurante Update");
    const u1 = await newUnit(t, "G1");
    const u2 = await newUnit(t, "G2");
    const m = await addMember(t, { displayName: "Antes", unitIds: [u1], defaultUnitId: u1 });
    const result = await repo().update(
      t.tenantId,
      m.id,
      stepFor({ displayName: "Depois", role: "manager", unitIds: [u1, u2] }, [u1, u2, t.unitId]),
      t.userId,
    );
    expect(result?.ok).toBe(true);
    const got = await repo().get(t.tenantId, m.id, OWNER_SCOPE);
    expect(got).toMatchObject({ displayName: "Depois", role: "manager", allUnits: false });
    expect([...(got?.unitIds ?? [])].sort()).toEqual([u1, u2].sort());
    const audit = await db.admin.query(
      "select actor_id, metadata from audit_log where tenant_id = $1 and target = $2 and action = 'member.update'",
      [t.tenantId, m.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(t.userId);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(m.phone);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain("Depois");
  });

  it("erro de domínio não grava nada e id de outra empresa devolve null", async () => {
    const t = await createTenant(db.admin, "Restaurante Erro");
    const m = await addMember(t, { displayName: "Intacto" });
    const failed = await repo().update(
      t.tenantId,
      m.id,
      stepFor({ displayName: "x" }, [t.unitId]),
      t.userId,
    );
    expect(failed?.ok).toBe(false);
    expect((await repo().get(t.tenantId, m.id, OWNER_SCOPE))?.displayName).toBe("Intacto");
    const foreign = await repo().update(
      a.tenantId,
      m.id,
      stepFor({ displayName: "Invasor" }, [a.unitId]),
      a.userId,
    );
    expect(foreign).toBeNull();
  });

  it("o passo recebe celular e e-mail do usuário e os donos ativos", async () => {
    const t = await createTenant(db.admin, "Restaurante Estado");
    const m = await addMember(t, {}, "estado@exemplo.com");
    let seen: { before: MemberState; owners: string[] } | null = null;
    await repo().update(
      t.tenantId,
      m.id,
      (before, owners) => {
        seen = { before, owners };
        return planMemberUpdate(
          before,
          {},
          {
            activeOwnerIds: owners,
            tenantUnitIds: [t.unitId],
            productPhoneE164: null,
            actorId: t.userId,
            now: NOW,
          },
        );
      },
      t.userId,
    );
    expect(seen).not.toBeNull();
    const s = seen as unknown as { before: MemberState; owners: string[] };
    expect(s.before.phone).toBe(m.phone);
    expect(s.before.email).toBe("estado@exemplo.com");
    expect(s.owners).toHaveLength(1);
  });

  it("Review Focus 4: dois donos rebaixam um ao outro em paralelo e um falha com LastActiveOwner", async () => {
    const t = await createTenant(db.admin, "Restaurante Corrida");
    const second = await addOwner(t);
    const first = (
      await db.admin.query(
        "select id from memberships where tenant_id = $1 and role = 'owner' and id <> $2",
        [t.tenantId, second.id],
      )
    ).rows[0].id as string;
    const demote = stepFor(
      { role: "manager", allUnits: false, unitIds: [t.unitId], defaultUnitId: t.unitId },
      [t.unitId],
    );
    // Determinístico: uma conexão admin segura os donos travados enquanto as duas atualizações
    // chegam; sem o FOR UPDATE do repositório, as duas leriam os dois donos e ambas passariam.
    const holder = await db.admin.connect();
    await holder.query("begin");
    await holder.query(
      "select 1 from memberships where tenant_id = $1 and role = 'owner' for update",
      [t.tenantId],
    );
    const pending = Promise.all([
      repo().update(t.tenantId, first, demote, t.userId),
      repo().update(t.tenantId, second.id, demote, t.userId),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await holder.query("commit");
    holder.release();
    const results = await pending;
    const oks = results.filter((r) => r?.ok === true).length;
    const failures = results.filter((r) => r?.ok === false);
    expect(oks).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ error: { code: "LastActiveOwner" } });
    const owners = await db.admin.query(
      "select 1 from memberships where tenant_id = $1 and role = 'owner'",
      [t.tenantId],
    );
    expect(owners.rows).toHaveLength(1);
  });
});

describe("setStatus", () => {
  it("desativa e reativa: invited sem opt-in, active com opt-in, com auditoria", async () => {
    const t = await createTenant(db.admin, "Restaurante Status");
    const noOptIn = await addMember(t, {});
    const withOptIn = await addMember(t, {});
    await db.admin.query(
      `insert into whatsapp_opt_ins (id, tenant_id, user_id, source, inbound_message_id)
       values ($1, $2, $3, 'first_message', $4)`,
      [uuidv7(), t.tenantId, withOptIn.userId, t.inboundMessageId],
    );

    for (const m of [noOptIn, withOptIn]) {
      const off = await repo().setStatus(t.tenantId, m.id, "deactivated", t.userId);
      expect(off).toMatchObject({ ok: true, value: { id: m.id, status: "deactivated" } });
      const row = await db.admin.query(
        "select status, deactivated_at from memberships where id = $1",
        [m.id],
      );
      expect(row.rows[0].status).toBe("deactivated");
      expect(row.rows[0].deactivated_at).not.toBeNull();
    }
    const on1 = await repo().setStatus(t.tenantId, noOptIn.id, "reactivate", t.userId);
    expect(on1).toMatchObject({ ok: true, value: { status: "invited", deactivatedAt: null } });
    const on2 = await repo().setStatus(t.tenantId, withOptIn.id, "reactivate", t.userId);
    expect(on2).toMatchObject({ ok: true, value: { status: "active", deactivatedAt: null } });
    const audit = await db.admin.query(
      "select action from audit_log where tenant_id = $1 and action like 'member.%activate' or action = 'member.deactivate'",
      [t.tenantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["member.deactivate", "member.reactivate"]),
    );
    expect(await repo().setStatus(a.tenantId, noOptIn.id, "deactivated", a.userId)).toBeNull();
  });

  it("recusa desativar o último dono ativo", async () => {
    const t = await createTenant(db.admin, "Restaurante Ultimo");
    const owner = (
      await db.admin.query("select id from memberships where tenant_id = $1 and role = 'owner'", [
        t.tenantId,
      ])
    ).rows[0].id as string;
    const result = await repo().setStatus(t.tenantId, owner, "deactivated", t.userId);
    expect(result).toMatchObject({ ok: false, error: { code: "LastActiveOwner" } });
    const row = await db.admin.query("select status from memberships where id = $1", [owner]);
    expect(row.rows[0].status).toBe("active");
  });
});
