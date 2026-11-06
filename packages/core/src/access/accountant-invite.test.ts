import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import {
  ACCOUNTANT_PAYROLL_NOTICE_ACTION,
  type AccountantInviteInput,
  planAccountantInvite,
} from "./accountant-invite";

const OWNER: Actor = { role: "owner", permissions: [], units: "all", panelAccess: true };
const MANAGER: Actor = { role: "manager", permissions: [], units: "all", panelAccess: true };
const NOW = new Date("2026-11-06T12:00:00Z");

function input(overrides: Partial<AccountantInviteInput> = {}): AccountantInviteInput {
  return {
    inviter: OWNER,
    inviterUserId: "owner-user",
    accountantUserId: "accountant-user",
    email: "contador@escritorio.com.br",
    acceptedPayrollNotice: true,
    tenantUnitIds: ["u1", "u2"],
    now: NOW,
    ...overrides,
  };
}

describe("convite do contador (RF36.CA03, DD-04)", () => {
  it("só envia depois de o Dono confirmar o aviso de folha", () => {
    const result = planAccountantInvite(input({ acceptedPayrollNotice: false }));
    expect(result).toEqual({ ok: false, error: { code: "PayrollNoticeNotAccepted" } });
  });

  it("com o aviso aceito, cria vínculo convidado de leitura em todas as unidades", () => {
    const result = planAccountantInvite(input());
    expect(result).toMatchObject({
      ok: true,
      value: {
        membership: {
          userId: "accountant-user",
          role: "accountant",
          status: "invited",
          allUnits: true,
          unitIds: [],
          panelAccess: true,
          permissions: [],
          invitedBy: "owner-user",
          invitedAt: NOW,
        },
      },
    });
  });

  it("registra o aceite do aviso na auditoria, com quem, quando e o contador convidado", () => {
    const result = planAccountantInvite(input());
    if (!result.ok) throw new Error("convite deveria ser aceito");
    expect(result.value.audit).toEqual({
      action: ACCOUNTANT_PAYROLL_NOTICE_ACTION,
      actorId: "owner-user",
      target: "accountant-user",
      metadata: { payrollNoticeAcceptedAt: NOW.toISOString() },
    });
  });

  it("não guarda o e-mail do contador na auditoria", () => {
    const result = planAccountantInvite(input());
    expect(JSON.stringify(result)).not.toMatch(/contador@escritorio/);
  });

  it("só o Dono convida", () => {
    const result = planAccountantInvite(input({ inviter: MANAGER }));
    expect(result).toMatchObject({ ok: false, error: { code: "PermissionDenied" } });
  });

  it("sem e-mail, recusa (o contador entra pelo painel)", () => {
    const result = planAccountantInvite(input({ email: null }));
    expect(result).toEqual({ ok: false, error: { code: "EmailRequiredForPanel" } });
  });
});
