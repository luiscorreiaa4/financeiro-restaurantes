import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { type Actor, authorize, type MembershipStatus } from "../permissions";
import { validateAccess } from "./access";

/** Ação da `audit_log` que registra o aceite do aviso de folha (DE-24). */
export const ACCOUNTANT_PAYROLL_NOTICE_ACTION = "accountant_invite_accepted_payroll_notice";

export interface AccountantInviteInput {
  readonly inviter: Actor;
  readonly inviterUserId: string;
  readonly accountantUserId: string;
  readonly email: string | null;
  /** O Dono confirmou "este acesso inclui folha de pagamento" (RF36.CA03). */
  readonly acceptedPayrollNotice: boolean;
  readonly tenantUnitIds: readonly string[];
  readonly now: Date;
}

export interface AccountantInvitePlan {
  readonly membership: {
    readonly userId: string;
    readonly role: "accountant";
    readonly status: MembershipStatus;
    readonly allUnits: true;
    readonly unitIds: readonly string[];
    readonly defaultUnitId: null;
    readonly panelAccess: true;
    readonly permissions: readonly never[];
    readonly invitedBy: string;
    readonly invitedAt: Date;
  };
  readonly audit: {
    readonly action: typeof ACCOUNTANT_PAYROLL_NOTICE_ACTION;
    readonly actorId: string;
    readonly target: string;
    readonly metadata: { readonly payrollNoticeAcceptedAt: string };
  };
}

/**
 * Convite do contador pelo Dono (RF36, DD-03, DD-04): só envia depois do aviso de folha, cria o
 * vínculo de leitura em todas as unidades e devolve o registro de auditoria do aceite.
 * O e-mail não vai para a auditoria (dado pessoal); a trilha aponta o usuário convidado.
 */
export function planAccountantInvite(
  input: AccountantInviteInput,
): Result<AccountantInvitePlan, DomainError> {
  const allowed = authorize(input.inviter, "user:manage");
  if (!allowed.ok) return allowed;
  if (!input.acceptedPayrollNotice) return fail("PayrollNoticeNotAccepted");

  const access = validateAccess({
    role: "accountant",
    allUnits: true,
    unitIds: [],
    defaultUnitId: null,
    tenantUnitIds: input.tenantUnitIds,
    panelAccess: true,
    email: input.email,
    // O contador não usa o WhatsApp: pode existir só com e-mail (DD-20).
    phone: null,
    permissions: [],
  });
  if (!access.ok) return access;

  return ok({
    membership: {
      userId: input.accountantUserId,
      role: "accountant",
      status: "invited",
      allUnits: true,
      unitIds: [],
      defaultUnitId: null,
      panelAccess: true,
      permissions: [],
      invitedBy: input.inviterUserId,
      invitedAt: input.now,
    },
    audit: {
      action: ACCOUNTANT_PAYROLL_NOTICE_ACTION,
      actorId: input.inviterUserId,
      target: input.accountantUserId,
      metadata: { payrollNoticeAcceptedAt: input.now.toISOString() },
    },
  });
}
