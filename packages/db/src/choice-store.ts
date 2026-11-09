import type { ChoiceStore } from "@app/core";
import { and, eq, isNull, ne } from "drizzle-orm";
import { memberships, membershipUnits, pendingQuestions, units } from "../schema";
import { type Database, type Transaction, withTenant } from "./client";

/**
 * Adaptador de `ChoiceStore` (`trocar unidade` e `trocar empresa`, DE-25): papel `app`, sempre
 * dentro de `withTenant`. A escolha mora no vínculo (`default_unit_id`, `preferred_at`); a
 * pergunta pendente de tipo `choice` só guarda a lista numerada e é fechada por quem responde.
 */
export function createChoiceStore(db: Database): ChoiceStore {
  const isOpen = (tx: Transaction, tenantId: string, questionId: string) =>
    tx
      .select({ id: pendingQuestions.id })
      .from(pendingQuestions)
      .where(
        and(
          eq(pendingQuestions.tenantId, tenantId),
          eq(pendingQuestions.id, questionId),
          eq(pendingQuestions.status, "open"),
        ),
      )
      .limit(1);

  return {
    async open(input) {
      const { tenantId, userId } = input;
      await withTenant(db, tenantId, async (tx) => {
        // Uma pergunta aberta por colaborador (RF15.R8): a anterior sai de cena.
        await tx
          .update(pendingQuestions)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(pendingQuestions.tenantId, tenantId),
              eq(pendingQuestions.userId, userId),
              eq(pendingQuestions.status, "open"),
            ),
          );
        await tx.insert(pendingQuestions).values({
          id: input.id,
          tenantId,
          userId,
          inboundMessageId: input.inboundMessageId,
          draft: input.draft,
          question: input.question,
          kind: "choice",
          expiresAt: input.expiresAt,
        });
      });
    },

    async apply({ tenantId, userId, questionId, target, chosenId, now }) {
      const [open] = await withTenant(db, tenantId, (tx) => isOpen(tx, tenantId, questionId));
      if (!open) return false;

      // Só grava a preferência. Quem fecha a pergunta é o chamador, depois de responder (DE-26):
      // se o envio falhar, a pergunta segue aberta e repetir a mesma escolha é inofensivo.
      const saved =
        target === "unit"
          ? await withTenant(db, tenantId, async (tx) => {
              const [link] = await tx
                .select({ id: memberships.id, allUnits: memberships.allUnits })
                .from(memberships)
                .where(
                  and(
                    eq(memberships.tenantId, tenantId),
                    eq(memberships.userId, userId),
                    isNull(memberships.deactivatedAt),
                    ne(memberships.status, "deactivated"),
                  ),
                )
                .limit(1);
              if (!link) return false;
              const [unit] = await tx
                .select({ id: units.id })
                .from(units)
                .where(
                  and(
                    eq(units.tenantId, tenantId),
                    eq(units.id, chosenId),
                    eq(units.status, "active"),
                  ),
                )
                .limit(1);
              if (!unit) return false;
              if (!link.allUnits) {
                const [access] = await tx
                  .select({ id: membershipUnits.id })
                  .from(membershipUnits)
                  .where(
                    and(
                      eq(membershipUnits.tenantId, tenantId),
                      eq(membershipUnits.membershipId, link.id),
                      eq(membershipUnits.unitId, chosenId),
                    ),
                  )
                  .limit(1);
                if (!access) return false;
              }
              await tx
                .update(memberships)
                .set({ defaultUnitId: chosenId })
                .where(eq(memberships.id, link.id));
              return true;
            })
          : await withTenant(db, chosenId, async (tx) => {
              const rows = await tx
                .update(memberships)
                .set({ preferredAt: now })
                .where(
                  and(
                    eq(memberships.tenantId, chosenId),
                    eq(memberships.userId, userId),
                    isNull(memberships.deactivatedAt),
                    ne(memberships.status, "deactivated"),
                  ),
                )
                .returning({ id: memberships.id });
              return rows.length > 0;
            });
      return saved;
    },
  };
}
