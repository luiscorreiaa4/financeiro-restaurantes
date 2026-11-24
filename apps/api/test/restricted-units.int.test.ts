import { restrictedUnitsSchema } from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";

const PASSWORD = "senhaForte1";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;
const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);

interface Owner {
  userId: string;
  email: string;
  tenantId: string;
  unitId: string;
  session: string;
}

async function login(email: string): Promise<string> {
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return h.sessionCookie(response);
}

async function addUnit(tenantId: string, name: string, status: "active" | "inactive") {
  const id = uuidv7();
  await admin(
    "insert into units (id, tenant_id, name, city, uf, status) values ($1, $2, $3, 'Maceió', 'AL', $4)",
    [id, tenantId, name, status],
  );
  return id;
}

/** Dono de uma empresa sem unidade ativa, com uma unidade inativa: entra em modo restrito. */
async function restrictedOwner(label: string): Promise<Owner> {
  const user = await h.createUser({ password: PASSWORD, withUnit: false });
  const [row] = (await admin("select tenant_id from memberships where user_id = $1", [user.userId]))
    .rows as Array<{ tenant_id: string }>;
  const tenantId = row?.tenant_id as string;
  await admin("update tenants set name = $2 where id = $1", [tenantId, `Empresa ${label}`]);
  const unitId = await addUnit(tenantId, `Unidade ${label}`, "inactive");
  return { ...user, tenantId, unitId, session: await login(user.email) };
}

function call(session: string | null, method: "GET" | "POST", url: string, origin = true) {
  return h.app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      "user-agent": "vitest",
      ...(origin ? { origin: h.origin } : {}),
      ...(session !== null ? { cookie: session } : {}),
    },
  });
}

const list = (session: string | null) => call(session, "GET", "/api/restricted/units");
const reactivate = (session: string | null, id: string) =>
  call(session, "POST", `/api/restricted/units/${id}/reactivate`);

const unitsOf = async (session: string) => {
  const response = await list(session);
  expect(response.statusCode, response.body).toBe(200);
  return restrictedUnitsSchema.parse(response.json()).units;
};

beforeAll(async () => {
  h = await startAuthHarness();
});

afterAll(async () => {
  await h?.stop();
});

describe("GET /api/restricted/units", () => {
  it("sem sessão responde 401 (GET e POST)", async () => {
    const owner = await restrictedOwner("sem-sessao");
    expect((await list(null)).statusCode).toBe(401);
    expect((await reactivate(null, owner.unitId)).statusCode).toBe(401);
  });

  it("dono em acesso restrito vê a própria unidade inativa, sem tenantId", async () => {
    const owner = await restrictedOwner("Lista");
    const response = await list(owner.session);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      units: [{ id: owner.unitId, name: "Unidade Lista", tenantName: "Empresa Lista" }],
    });
    expect(response.body).not.toContain(owner.tenantId);
  });

  it("duas empresas de donos diferentes não se enxergam", async () => {
    const a = await restrictedOwner("Isolada-A");
    const b = await restrictedOwner("Isolada-B");
    expect((await unitsOf(a.session)).map((u) => u.id)).toEqual([a.unitId]);
    expect((await unitsOf(b.session)).map((u) => u.id)).toEqual([b.unitId]);
    expect((await reactivate(a.session, b.unitId)).statusCode).toBe(404);
    expect((await reactivate(b.session, a.unitId)).statusCode).toBe(404);
  });

  it("empresa que já tem unidade ativa não aparece (dono em sessão completa)", async () => {
    const owner = await restrictedOwner("Ativa");
    // A empresa ganha uma unidade ativa: a sessão vira completa e nada é elegível.
    await addUnit(owner.tenantId, "Matriz ativa", "active");
    expect((await call(owner.session, "GET", "/api/me")).json().access).toBe("full");
    expect(await unitsOf(owner.session)).toEqual([]);
    expect((await reactivate(owner.session, owner.unitId)).statusCode).toBe(404);
    const [row] = (await admin("select status from units where id = $1", [owner.unitId])).rows;
    expect(row.status).toBe("inactive");
  });

  it("sessão completa só vê e reativa as próprias empresas sem unidade ativa", async () => {
    const owner = await h.createUser({ password: PASSWORD }); // A: dono com unidade ativa
    const other = await restrictedOwner("Alheia");
    const [row] = (
      await admin("select tenant_id from memberships where user_id = $1", [owner.userId])
    ).rows as Array<{ tenant_id: string }>;
    const tenantA = row?.tenant_id as string;
    const inactiveA = await addUnit(tenantA, "Fechada da A", "inactive");
    // B: o mesmo usuário também é dono de uma empresa sem unidade ativa.
    const tenantB = uuidv7();
    await admin("insert into tenants (id, name) values ($1, 'Empresa B própria')", [tenantB]);
    const unitB = await addUnit(tenantB, "Unidade B própria", "inactive");
    await admin(
      "insert into memberships (id, tenant_id, user_id, role, all_units, status) values ($1, $2, $3, 'owner', true, 'active')",
      [uuidv7(), tenantB, owner.userId],
    );
    const session = await login(owner.email);
    expect((await call(session, "GET", "/api/me")).json().access).toBe("full");

    expect((await unitsOf(session)).map((u) => u.id)).toEqual([unitB]);
    expect((await reactivate(session, inactiveA)).statusCode).toBe(404);
    expect((await reactivate(session, other.unitId)).statusCode).toBe(404);
    expect((await reactivate(session, unitB)).statusCode).toBe(204);
  });

  it("vínculo desativado ou empresa encerrada não tornam a unidade elegível", async () => {
    const closed = await restrictedOwner("Encerrada");
    const outsider = await restrictedOwner("Fora");
    // O dono da "Fora" também tem um vínculo desativado na empresa "Desativada".
    const ghost = await restrictedOwner("Desativada");
    await admin(
      "insert into memberships (id, tenant_id, user_id, role, all_units, status, deactivated_at) values ($1, $2, $3, 'owner', true, 'deactivated', now())",
      [uuidv7(), ghost.tenantId, outsider.userId],
    );
    await admin("update tenants set status = 'closed' where id = $1", [closed.tenantId]);
    expect((await unitsOf(outsider.session)).map((u) => u.id)).toEqual([outsider.unitId]);
    expect((await reactivate(outsider.session, ghost.unitId)).statusCode).toBe(404);
    expect((await reactivate(closed.session, closed.unitId)).statusCode).toBe(401);
  });
});

describe("POST /api/restricted/units/:id/reactivate", () => {
  it("reativa, audita, devolve o painel a full e a segunda chamada vira 404", async () => {
    const owner = await restrictedOwner("Reativa");
    const before = (await call(owner.session, "GET", "/api/me")).json();
    expect(before).toMatchObject({ access: "restricted", reason: "owner_no_unit" });

    const response = await reactivate(owner.session, owner.unitId);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    const [unit] = (await admin("select status from units where id = $1", [owner.unitId])).rows;
    expect(unit.status).toBe("active");
    const audit = (
      await admin(
        "select actor_id, target, tenant_id from audit_log where action = 'unit.reactivate' and tenant_id = $1",
        [owner.tenantId],
      )
    ).rows;
    expect(audit).toEqual([
      { actor_id: owner.userId, target: owner.unitId, tenant_id: owner.tenantId },
    ]);

    const after = (await call(owner.session, "GET", "/api/me")).json();
    expect(after.access).toBe("full");
    expect(after.companies.map((c: { tenantId: string }) => c.tenantId)).toContain(owner.tenantId);

    expect((await reactivate(owner.session, owner.unitId)).statusCode).toBe(404);
    expect(
      (
        await admin("select 1 from audit_log where action = 'unit.reactivate' and tenant_id = $1", [
          owner.tenantId,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it("Review Focus 5: gerente da empresa, unidade de outra empresa, inexistente e não UUID dão a mesma 404", async () => {
    const mine = await restrictedOwner("Foco5");
    const theirs = await restrictedOwner("Foco5-alheia");
    // O usuário "mine" é só gerente da empresa "managed" (sem unidade ativa, unidade inativa).
    const managed = await restrictedOwner("Foco5-gerida");
    await admin(
      "insert into memberships (id, tenant_id, user_id, role, all_units, status) values ($1, $2, $3, 'manager', true, 'active')",
      [uuidv7(), managed.tenantId, mine.userId],
    );
    const responses = await Promise.all(
      [managed.unitId, theirs.unitId, uuidv7(), "nao-e-uuid"].map((id) =>
        reactivate(mine.session, id),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "not_found" });
    }
    // Empresa que já tem outra unidade ativa: a própria unidade ativa e a inativa dão a mesma 404.
    const withActive = await h.createUser({ password: PASSWORD });
    const [m] = (
      await admin("select tenant_id from memberships where user_id = $1", [withActive.userId])
    ).rows as Array<{ tenant_id: string }>;
    const activeTenant = m?.tenant_id as string;
    const [activeUnit] = (
      await admin("select id from units where tenant_id = $1 and status = 'active'", [activeTenant])
    ).rows as Array<{ id: string }>;
    const inactiveSibling = await addUnit(activeTenant, "Irmã inativa", "inactive");
    const activeSession = await login(withActive.email);
    const more = await Promise.all(
      [activeUnit?.id as string, inactiveSibling].map((id) => reactivate(activeSession, id)),
    );
    for (const response of more) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "not_found" });
    }
    expect(new Set([...responses, ...more].map((r) => r.body)).size).toBe(1);
    const [sibling] = (await admin("select status from units where id = $1", [inactiveSibling]))
      .rows;
    expect(sibling.status).toBe("inactive");
    for (const id of [managed.unitId, theirs.unitId]) {
      const [row] = (await admin("select status from units where id = $1", [id])).rows;
      expect(row.status).toBe("inactive");
    }
    // O gerente também não vê a unidade da empresa gerida na lista.
    expect((await unitsOf(mine.session)).map((u) => u.id)).toEqual([mine.unitId]);
  });

  it("dono de duas empresas sem unidade ativa: a gravação e a auditoria ficam na empresa da unidade", async () => {
    const a = await restrictedOwner("Dupla-A");
    const user = await h.createUser({ password: PASSWORD, withUnit: false });
    const tenantB = (
      (await admin("select tenant_id from memberships where user_id = $1", [user.userId]))
        .rows as Array<{ tenant_id: string }>
    )[0]?.tenant_id as string;
    const unitB = await addUnit(tenantB, "Unidade Dupla-B", "inactive");
    // O mesmo usuário também é dono da empresa A.
    await admin(
      "insert into memberships (id, tenant_id, user_id, role, all_units, status) values ($1, $2, $3, 'owner', true, 'active')",
      [uuidv7(), a.tenantId, user.userId],
    );
    const session = await login(user.email);
    expect((await unitsOf(session)).map((u) => u.id).sort()).toEqual([a.unitId, unitB].sort());
    expect((await reactivate(session, unitB)).statusCode).toBe(204);
    const status = async (id: string) =>
      ((await admin("select status from units where id = $1", [id])).rows[0] as { status: string })
        .status;
    expect(await status(unitB)).toBe("active");
    expect(await status(a.unitId)).toBe("inactive");
    const audit = (
      await admin("select tenant_id, target from audit_log where action = 'unit.reactivate'", [])
    ).rows as Array<{ tenant_id: string; target: string }>;
    expect(audit.filter((r) => r.target === unitB)).toEqual([
      { tenant_id: tenantB, target: unitB },
    ]);
    expect(audit.filter((r) => r.tenant_id === a.tenantId)).toEqual([]);
  });

  it.each(["read_only", "canceled"])(
    "empresa em %s: lista vazia e reativar dá 404 sem gravar",
    async (accountStatus) => {
      const owner = await restrictedOwner(`Conta-${accountStatus}`);
      await admin("update tenants set status = $2 where id = $1", [owner.tenantId, accountStatus]);
      expect(await unitsOf(owner.session)).toEqual([]);
      const response = await reactivate(owner.session, owner.unitId);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "not_found" });
      const [row] = (await admin("select status from units where id = $1", [owner.unitId])).rows;
      expect(row.status).toBe("inactive");
      expect(
        (
          await admin(
            "select 1 from audit_log where action = 'unit.reactivate' and tenant_id = $1",
            [owner.tenantId],
          )
        ).rows,
      ).toHaveLength(0);
    },
  );

  it("sem Origin a escrita é recusada pelo hook global", async () => {
    const owner = await restrictedOwner("Origem");
    const response = await call(
      owner.session,
      "POST",
      `/api/restricted/units/${owner.unitId}/reactivate`,
      false,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "origin_forbidden" });
  });

  it("não loga nome de unidade nem de empresa", async () => {
    const owner = await restrictedOwner("Sigilo");
    await list(owner.session);
    await reactivate(owner.session, owner.unitId);
    const logged = h.logLines.join("\n");
    expect(logged).not.toContain("Unidade Sigilo");
    expect(logged).not.toContain("Empresa Sigilo");
  });
});
