import { type AccountantInvitePlan, planAccountantInvite } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccessRepo } from "../src/access-repo";
import { createDatabase } from "../src/client";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;
let c: TenantFixture;
let accountantId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
  c = await createTenant(db.admin, "Restaurante C");
  accountantId = uuidv7();
  await db.admin.query(
    "insert into users (id, name, email) values ($1, 'Contadora', 'contadora@escritorio.com.br')",
    [accountantId],
  );
});

afterAll(async () => {
  await db?.stop();
});

function planFor(f: TenantFixture): AccountantInvitePlan {
  const plan = planAccountantInvite({
    inviter: { role: "owner", permissions: [], units: "all", panelAccess: true },
    inviterUserId: f.userId,
    accountantUserId: accountantId,
    email: "contadora@escritorio.com.br",
    acceptedPayrollNotice: true,
    tenantUnitIds: [f.unitId],
    now: new Date("2026-11-06T12:00:00Z"),
  });
  if (!plan.ok) throw new Error("plano de convite inválido no teste");
  return plan.value;
}

describe("convite do contador gravado (RF36, DD-03, DD-04)", () => {
  const repo = () => createAccessRepo(createDatabase(db.app));

  it("grava o vínculo convidado e o aceite do aviso na auditoria, na mesma transação", async () => {
    expect(await repo().inviteAccountant(a.tenantId, planFor(a))).toEqual({ created: true });

    const membership = await db.admin.query(
      `select role, status, all_units, panel_access, invited_by, permissions
       from memberships where tenant_id = $1 and user_id = $2`,
      [a.tenantId, accountantId],
    );
    expect(membership.rows).toEqual([
      {
        role: "accountant",
        status: "invited",
        all_units: true,
        panel_access: true,
        invited_by: a.userId,
        permissions: [],
      },
    ]);

    const audit = await db.admin.query(
      "select actor_id, action, target, metadata from audit_log where tenant_id = $1 and action = $2",
      [a.tenantId, "accountant_invite_accepted_payroll_notice"],
    );
    expect(audit.rows).toEqual([
      {
        actor_id: a.userId,
        action: "accountant_invite_accepted_payroll_notice",
        target: accountantId,
        metadata: { payrollNoticeAcceptedAt: "2026-11-06T12:00:00.000Z" },
      },
    ]);
  });

  it("convidar de novo na mesma empresa não duplica o vínculo nem a auditoria", async () => {
    expect(await repo().inviteAccountant(a.tenantId, planFor(a))).toEqual({ created: false });
    const { rows } = await db.admin.query(
      "select (select count(*)::int from memberships where tenant_id = $1 and user_id = $2) as m, (select count(*)::int from audit_log where tenant_id = $1 and action = 'accountant_invite_accepted_payroll_notice') as l",
      [a.tenantId, accountantId],
    );
    expect(rows[0]).toEqual({ m: 1, l: 1 });
  });

  it("o mesmo contador entra em várias empresas, cada uma com o seu vínculo (multicliente)", async () => {
    await repo().inviteAccountant(b.tenantId, planFor(b));
    await repo().inviteAccountant(c.tenantId, planFor(c));
    const { rows } = await db.admin.query(
      "select tenant_id from memberships where user_id = $1 and role = 'accountant' order by tenant_id",
      [accountantId],
    );
    expect(rows.map((row) => row.tenant_id).sort()).toEqual(
      [a.tenantId, b.tenantId, c.tenantId].sort(),
    );
  });
});
