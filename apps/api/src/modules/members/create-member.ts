import { planMemberCreate } from "@app/core";
import type { MemberSettingsInput } from "@app/core/contracts";
import { units, withTenant } from "@app/db";
import { and, eq } from "drizzle-orm";
import {
  CONTACT_CONFLICT,
  isUniqueViolation,
  type MemberOutcome,
  type MemberRecord,
  type MembersCaller,
  type MembersDeps,
  OWNER_SCOPE,
} from "./shared";

export type CreatedMember = { record: MemberRecord; inviteEmail: string | null };

/**
 * Cadastro do colaborador (RF05). Número que já é de um usuário (de qualquer empresa) só ganha o
 * vínculo desta: nada da outra empresa entra na resposta, no erro nem no log (CA02). O e-mail
 * de quem já tem conta nunca é gravado por aqui: ele é o login (conflito neutro).
 */
export function createCreateMember(deps: MembersDeps) {
  return async function createMember(
    caller: MembersCaller,
    input: MemberSettingsInput,
  ): Promise<MemberOutcome<CreatedMember>> {
    const tenantUnitIds = await withTenant(deps.appDb, caller.tenantId, async (tx) =>
      (
        await tx
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.tenantId, caller.tenantId), eq(units.status, "active")))
      ).map((row) => row.id),
    );
    const plan = planMemberCreate(input, {
      tenantUnitIds,
      productPhoneE164: deps.productPhoneE164,
      actorId: caller.actorId,
      now: deps.now(),
    });
    if (!plan.ok) return { kind: "domain", error: plan.error };
    const { phone, membership, audit } = plan.value;
    const email = input.email === null ? null : input.email.trim().toLowerCase();

    const emailOwner = email === null ? null : await deps.directory.findUserIdByEmail(email);
    /** O e-mail do usuário existente não sai daqui: só decide se há conflito. */
    // Reaproveita o usuário só com o e-mail EXATO dele ou, sem e-mail dos dois lados. Do contrário
    // um dono poderia plantar o e-mail dele num número alheio e entrar no painel de outra empresa.
    const reuse = (existing: { id: string; email: string | null }): string | null => {
      if (email === null) return existing.email === null ? existing.id : null;
      if (existing.email !== email) return null;
      if (emailOwner !== null && emailOwner !== existing.id) return null;
      return existing.id;
    };
    let userId: string;
    const existing = await deps.directory.findUserByPhone(phone.lookupCandidates);
    if (existing !== null) {
      const reused = reuse(existing);
      if (reused === null) return { kind: "contact", issue: CONTACT_CONFLICT };
      userId = reused;
    } else {
      if (emailOwner !== null) return { kind: "contact", issue: CONTACT_CONFLICT };
      try {
        userId = await deps.directory.createUser({
          name: membership.displayName,
          phoneE164: phone.e164,
          email,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Duplo envio em paralelo: o outro pedido criou o usuário; segue como usuário existente.
        const raced = await deps.directory.findUserByPhone(phone.lookupCandidates);
        const reused = raced === null ? null : reuse(raced);
        if (reused === null) return { kind: "contact", issue: CONTACT_CONFLICT };
        userId = reused;
      }
    }

    const inserted = await deps.members.insert(caller.tenantId, userId, { membership, audit });
    if (!inserted.created) return { kind: "already_member" };
    const record = await deps.members.get(caller.tenantId, inserted.id, OWNER_SCOPE);
    if (record === null) throw new Error("vínculo recém-criado não encontrado");
    return {
      kind: "ok",
      value: { record, inviteEmail: membership.panelAccess ? email : null },
    };
  };
}
