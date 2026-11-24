import { planMemberUpdate } from "@app/core";
import type { MemberSettingsPatch } from "@app/core/contracts";
import { units, withTenant } from "@app/db";
import { eq } from "drizzle-orm";
import {
  CONTACT_CONFLICT,
  EMAIL_SHARED,
  isUniqueViolation,
  type MemberOutcome,
  type MemberRecord,
  type MembersCaller,
  type MembersDeps,
  OWNER_SCOPE,
  PHONE_IN_USE,
  PHONE_SHARED,
} from "./shared";

const ROLE_RANK = { staff: 1, manager: 2, owner: 3 } as const;

export type UpdatedMember = { record: MemberRecord; reducedAccess: boolean };

/**
 * Alteração do colaborador (RF05, Alteração). Troca de celular ou e-mail só vale para quem tem
 * vínculo apenas aqui: o contato é do usuário, que pode ter outras empresas. A gravação do
 * vínculo e o plano rodam sob trava (`members.update`); as sessões são encerradas pela rota
 * depois da gravação (CA09).
 */
export function createUpdateMember(deps: MembersDeps) {
  async function tenantUnitIds(tenantId: string): Promise<string[]> {
    return withTenant(deps.appDb, tenantId, async (tx) =>
      (await tx.select({ id: units.id }).from(units).where(eq(units.tenantId, tenantId))).map(
        (row) => row.id,
      ),
    );
  }

  return async function updateMember(
    caller: MembersCaller,
    id: string,
    patch: MemberSettingsPatch,
    /**
     * Roda logo depois de o vínculo ser gravado e ANTES da gravação do contato: se o contato
     * falhar (23505 ou erro), as sessões de quem perdeu acesso já foram encerradas (CA09).
     */
    afterWrite: (written: { userId: string; reducedAccess: boolean }) => Promise<void> = async () =>
      undefined,
  ): Promise<MemberOutcome<UpdatedMember>> {
    const { confirmPhoneChange: _confirmed, ...memberPatch } = patch;
    const current = await deps.members.get(caller.tenantId, id, OWNER_SCOPE);
    // Contador é cadastrado pela F13 (RF36), não por esta tela.
    if (current === null || (current.role as string) === "accountant") return { kind: "not_found" };
    const unitIds = await tenantUnitIds(caller.tenantId);
    const owners = await deps.members.list(caller.tenantId, OWNER_SCOPE, {
      role: "owner",
      status: "active",
    });
    // Contato é do usuário: com vínculo em outra empresa, a auditoria desta não leva o e-mail.
    const shared = await deps.directory.hasMembershipElsewhere(current.userId, caller.tenantId);
    const baseCtx = {
      tenantUnitIds: unitIds,
      productPhoneE164: deps.productPhoneE164,
      actorId: caller.actorId,
      now: deps.now(),
      sharedContact: shared,
    };

    // Pré-plano com o estado lido: decide as checagens de contato antes de gravar. O plano
    // autoritativo roda de novo dentro de `members.update`, com as travas.
    const before = {
      id: current.id,
      userId: current.userId,
      displayName: current.displayName,
      phone: current.phone ?? null,
      email: current.email ?? null,
      role: current.role,
      allUnits: current.allUnits,
      unitIds: current.unitIds,
      defaultUnitId: current.defaultUnitId,
      panelAccess: current.panelAccess,
      permissions: current.permissions,
      status: current.status,
    };
    const dry = planMemberUpdate(before, memberPatch, {
      ...baseCtx,
      activeOwnerIds: owners.map((owner) => owner.id),
    });
    if (!dry.ok) return { kind: "domain", error: dry.error };

    // Ganhar painel ou subir a gerente/dono num usuário que tem outra empresa: o dono só prova
    // que conhece a pessoa digitando o e-mail exato dela (senão plantaria o e-mail dele, F6b).
    const after = dry.value.after;
    const gainsPanel = !before.panelAccess && after.panelAccess;
    const rises = ROLE_RANK[after.role] > ROLE_RANK[before.role] && after.role !== "staff";
    if (shared && (gainsPanel || rises)) {
      const typed = patch.email === undefined ? null : patch.email?.trim().toLowerCase();
      if (typed == null || typed !== before.email) {
        return { kind: "contact", issue: CONTACT_CONFLICT };
      }
    }

    if (dry.value.phoneChange !== null) {
      if (shared) return { kind: "contact", issue: PHONE_SHARED };
      const holder = await deps.directory.findUserByPhone(dry.value.phoneChange.lookupCandidates);
      if (holder !== null && holder.id !== current.userId) {
        return { kind: "contact", issue: PHONE_IN_USE };
      }
    }
    if (dry.value.emailChange !== null || (patch.email === null && before.email !== null)) {
      if (shared) return { kind: "contact", issue: EMAIL_SHARED };
      if (dry.value.emailChange !== null) {
        const holder = await deps.directory.findUserIdByEmail(dry.value.emailChange);
        if (holder !== null && holder !== current.userId) {
          return { kind: "contact", issue: CONTACT_CONFLICT };
        }
      }
    }

    const result = await deps.members.update(
      caller.tenantId,
      id,
      (state, activeOwnerIds) =>
        planMemberUpdate(state, memberPatch, { ...baseCtx, activeOwnerIds }),
      caller.actorId,
    );
    if (result === null) return { kind: "not_found" };
    if (!result.ok) return { kind: "domain", error: result.error };

    await afterWrite({ userId: current.userId, reducedAccess: result.value.reducesAccess });
    const { phoneChange, emailChange } = result.value;
    if (phoneChange !== null || emailChange !== null || (patch.email === null && before.email)) {
      try {
        await deps.directory.updateUserContact(current.userId, {
          ...(phoneChange !== null ? { phoneE164: phoneChange.e164 } : {}),
          ...(emailChange !== null || patch.email === null
            ? { email: result.value.after.email }
            : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return {
            kind: "contact",
            issue: phoneChange !== null ? PHONE_IN_USE : CONTACT_CONFLICT,
          };
        }
        throw error;
      }
    }
    const record = await deps.members.get(caller.tenantId, id, OWNER_SCOPE);
    if (record === null) return { kind: "not_found" };
    return { kind: "ok", value: { record, reducedAccess: result.value.reducesAccess } };
  };
}
