import { ensureActiveOwner, validateAccess } from "../access/access";
import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import type { AdditionalPermission, MembershipStatus } from "../permissions";
import { normalizeBrazilianPhone } from "../phone/phone";

// Colaboradores (RF05): domínio puro, sem infra. Nunca logar nome, celular nem e-mail.

export const MEMBER_ROLES = ["owner", "manager", "staff"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_NAME_MIN = 2;
export const MEMBER_NAME_MAX = 120;

const ROLE_RANK: Record<MemberRole, number> = { owner: 3, manager: 2, staff: 1 };

export interface MemberInput {
  readonly displayName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly role: MemberRole;
  readonly allUnits: boolean;
  readonly unitIds: readonly string[];
  readonly defaultUnitId: string | null;
  readonly panelAccess: boolean;
  readonly permissions: readonly AdditionalPermission[];
}

/** Estado do vínculo; `phone` e `email` nulos = desconhecidos (quem carrega deve trazê-los). */
export interface MemberState {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly role: MemberRole;
  readonly allUnits: boolean;
  readonly unitIds: readonly string[];
  readonly defaultUnitId: string | null;
  readonly panelAccess: boolean;
  readonly permissions: readonly AdditionalPermission[];
  readonly status: MembershipStatus;
}

export interface MemberPatch {
  readonly displayName?: string;
  readonly phone?: string;
  readonly email?: string | null;
  readonly role?: MemberRole;
  readonly allUnits?: boolean;
  readonly unitIds?: readonly string[];
  readonly defaultUnitId?: string | null;
  readonly panelAccess?: boolean;
  readonly permissions?: readonly AdditionalPermission[];
}

export interface MembershipDraft {
  readonly displayName: string;
  readonly role: MemberRole;
  readonly allUnits: boolean;
  readonly unitIds: readonly string[];
  readonly defaultUnitId: string | null;
  readonly panelAccess: boolean;
  readonly permissions: readonly AdditionalPermission[];
  readonly status: "invited";
  readonly invitedBy: string;
  readonly invitedAt: Date;
}

export interface AuditDraft {
  readonly action: string;
  readonly target: string | null;
  readonly metadata: {
    readonly before?: Record<string, unknown>;
    readonly after?: Record<string, unknown>;
  };
}

export interface PhonePlan {
  readonly e164: string;
  readonly lookupCandidates: string[];
}

/** "•••• 5647": só os 4 últimos dígitos. */
export function maskPhone(e164: string): string {
  return `•••• ${e164.replace(/\D/g, "").slice(-4)}`;
}

/** "f•••@dominio.com": primeira letra e domínio. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** Texto do convite (sem o número do produto: ele segue por outro canal, na tela). */
export function buildInviteText(displayName: string, tenantName: string): string {
  const firstName = displayName.trim().split(/\s+/)[0] ?? "";
  return `Olá, ${firstName}! Você foi convidado(a) para lançar as finanças de ${tenantName} pelo WhatsApp. Para começar, mande um "Oi" para o WhatsApp do produto e siga as instruções.`;
}

function validateName(raw: string): Result<string, DomainError> {
  const name = raw.trim();
  if (name.length < MEMBER_NAME_MIN || name.length > MEMBER_NAME_MAX) {
    return fail("InvalidName", { min: MEMBER_NAME_MIN, max: MEMBER_NAME_MAX });
  }
  return ok(name);
}

function planPhone(raw: string): Result<PhonePlan, DomainError> {
  const text = raw.trim();
  const digits = text.replace(/\D/g, "");
  const international = text.startsWith("+") || text.startsWith("00");
  if (international && !digits.replace(/^0+/, "").startsWith("55")) return fail("ForeignPhone");
  const phone = normalizeBrazilianPhone(text);
  if (!phone.ok) return phone;
  return ok({ e164: phone.value.e164, lookupCandidates: [...phone.value.lookupCandidates] });
}

/** Celular igual ao número do produto, comparando as variantes com e sem o 9º dígito. */
function isProductNumber(phone: PhonePlan, productPhoneE164: string | null): boolean {
  if (productPhoneE164 === null) return false;
  const product = normalizeBrazilianPhone(productPhoneE164);
  const productKeys = product.ok ? product.value.lookupCandidates : [productPhoneE164];
  return phone.lookupCandidates.some((candidate) => productKeys.includes(candidate));
}

export const MEMBER_EMAIL_MAX = 254;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Trim e minúsculas; vazio vira nulo. Formato e tamanho (máx. 254) recusados com `InvalidEmail`. */
function normalizeEmail(
  email: string | null | undefined,
): Result<string | null, Extract<DomainError, { code: "InvalidEmail" }>> {
  if (email === null || email === undefined) return ok(null);
  const value = email.trim().toLowerCase();
  if (value === "") return ok(null);
  if (value.length > MEMBER_EMAIL_MAX || !EMAIL_FORMAT.test(value)) {
    return fail("InvalidEmail", { field: "email" });
  }
  return ok(value);
}

export function isAccessReduction(before: MemberState, after: MemberState): boolean {
  if (ROLE_RANK[after.role] < ROLE_RANK[before.role]) return true;
  if (before.panelAccess && !after.panelAccess) return true;
  if (before.status !== "deactivated" && after.status === "deactivated") return true;
  if (before.permissions.some((permission) => !after.permissions.includes(permission))) {
    return true;
  }
  if (before.allUnits) return !after.allUnits;
  if (after.allUnits) return false;
  return before.unitIds.some((unitId) => !after.unitIds.includes(unitId));
}

export function planMemberCreate(
  input: MemberInput,
  ctx: {
    readonly tenantUnitIds: readonly string[];
    readonly productPhoneE164: string | null;
    readonly actorId: string;
    readonly now: Date;
  },
): Result<{ phone: PhonePlan; membership: MembershipDraft; audit: AuditDraft }, DomainError> {
  const name = validateName(input.displayName);
  if (!name.ok) return name;
  const phone = planPhone(input.phone);
  if (!phone.ok) return phone;

  if (isProductNumber(phone.value, ctx.productPhoneE164)) return fail("ProductNumber");

  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail.ok) return normalizedEmail;
  const email = normalizedEmail.value;
  const access = validateAccess({
    role: input.role,
    allUnits: input.allUnits,
    unitIds: input.unitIds,
    defaultUnitId: input.defaultUnitId,
    tenantUnitIds: ctx.tenantUnitIds,
    panelAccess: input.panelAccess,
    email,
    phone: phone.value.e164,
    permissions: input.permissions,
  });
  if (!access.ok) return access;

  const membership: MembershipDraft = {
    displayName: name.value,
    role: input.role,
    ...access.value,
    status: "invited",
    invitedBy: ctx.actorId,
    invitedAt: ctx.now,
  };
  const audit: AuditDraft = {
    action: "member.invite",
    target: null,
    metadata: {
      after: {
        role: membership.role,
        allUnits: membership.allUnits,
        unitIds: membership.unitIds,
        defaultUnitId: membership.defaultUnitId,
        panelAccess: membership.panelAccess,
        permissions: membership.permissions,
        phone: maskPhone(phone.value.e164),
        email: email === null ? null : maskEmail(email),
      },
    },
  };
  return ok({ phone: phone.value, membership, audit });
}

function auditView(member: MemberState, hideEmail: boolean): Record<string, unknown> {
  return {
    role: member.role,
    allUnits: member.allUnits,
    unitIds: member.unitIds,
    defaultUnitId: member.defaultUnitId,
    panelAccess: member.panelAccess,
    permissions: member.permissions,
    status: member.status,
    phone: member.phone === null ? null : maskPhone(member.phone),
    // O e-mail é do usuário: com vínculo em outra empresa, nada dele entra na auditoria desta.
    email: hideEmail || member.email === null ? null : maskEmail(member.email),
  };
}

export function planMemberUpdate(
  before: MemberState,
  patch: MemberPatch,
  ctx: {
    readonly activeOwnerIds: readonly string[];
    readonly tenantUnitIds: readonly string[];
    readonly productPhoneE164: string | null;
    readonly actorId: string;
    readonly now: Date;
    /** O usuário tem vínculo em outra empresa: a auditoria não leva o e-mail dele. */
    readonly sharedContact?: boolean;
  },
): Result<
  {
    after: MemberState;
    reducesAccess: boolean;
    phoneChange: PhonePlan | null;
    emailChange: string | null;
    audit: AuditDraft;
  },
  DomainError
> {
  let displayName = before.displayName;
  if (patch.displayName !== undefined) {
    const name = validateName(patch.displayName);
    if (!name.ok) return name;
    displayName = name.value;
  }

  let phone = before.phone;
  let phoneChange: PhonePlan | null = null;
  if (patch.phone !== undefined) {
    const plan = planPhone(patch.phone);
    if (!plan.ok) return plan;
    if (isProductNumber(plan.value, ctx.productPhoneE164)) return fail("ProductNumber");
    phone = plan.value.e164;
    const known = before.phone === null ? null : normalizeBrazilianPhone(before.phone);
    const same = known?.ok === true && known.value.lookupCandidates.includes(plan.value.e164);
    phoneChange = same ? null : plan.value;
  }

  let email = before.email;
  let emailChange: string | null = null;
  if (patch.email !== undefined) {
    const normalized = normalizeEmail(patch.email);
    if (!normalized.ok) return normalized;
    email = normalized.value;
    if (email !== before.email) emailChange = email;
  }

  const role = patch.role ?? before.role;
  const access = validateAccess({
    role,
    allUnits: patch.allUnits ?? before.allUnits,
    unitIds: patch.unitIds ?? before.unitIds,
    defaultUnitId: patch.defaultUnitId !== undefined ? patch.defaultUnitId : before.defaultUnitId,
    tenantUnitIds: ctx.tenantUnitIds,
    panelAccess: patch.panelAccess ?? before.panelAccess,
    email,
    phone,
    permissions: patch.permissions ?? before.permissions,
  });
  if (!access.ok) return access;

  const after: MemberState = {
    ...before,
    displayName,
    phone,
    email,
    role,
    ...access.value,
  };

  // Falha fechado: o dono atual conta no conjunto mesmo que o chamador o esqueça, e o conjunto
  // resultante da mudança nunca pode ficar sem dono ativo.
  const ownerIds = new Set(ctx.activeOwnerIds);
  if (before.role === "owner" && before.status === "active") ownerIds.add(before.id);
  const owners = [...ownerIds].map((id) => ({ id, role: "owner", status: "active" as const }));
  const remaining = new Set(ownerIds);
  remaining.delete(before.id);
  if (after.role === "owner" && after.status === "active") remaining.add(before.id);
  if (remaining.size === 0) return fail("LastActiveOwner");
  const lastOwner = ensureActiveOwner(owners, {
    membershipId: before.id,
    role: after.role,
    status: after.status,
  });
  if (!lastOwner.ok) return lastOwner;

  return ok({
    after,
    // Trocar celular ou e-mail também encerra as sessões: a identidade de acesso mudou.
    reducesAccess:
      isAccessReduction(before, after) || phoneChange !== null || after.email !== before.email,
    phoneChange,
    emailChange,
    audit: {
      action: "member.update",
      target: before.id,
      metadata: {
        before: auditView(before, ctx.sharedContact === true),
        after: auditView(after, ctx.sharedContact === true),
      },
    },
  });
}
