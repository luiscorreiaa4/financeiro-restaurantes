import { z } from "zod";

/** O que a pergunta de escolha troca: a unidade padrão ou a empresa padrão (RF19, DE-25). */
export const CHOICE_TARGETS = ["unit", "tenant"] as const;
export type ChoiceTarget = (typeof CHOICE_TARGETS)[number];

/** Rascunho guardado na pergunta pendente de tipo `choice`. */
export const ChoiceDraftSchema = z
  .object({
    target: z.enum(CHOICE_TARGETS),
    options: z
      .array(z.object({ n: z.number().int().positive(), id: z.string(), label: z.string() }))
      .min(1),
  })
  .refine(
    (draft) => new Set(draft.options.map((option) => option.n)).size === draft.options.length,
    {
      message: "números de opção repetidos",
    },
  );
export type ChoiceDraft = z.infer<typeof ChoiceDraftSchema>;

export type ChoiceAnswer =
  | { readonly kind: "chosen"; readonly id: string; readonly label: string }
  | { readonly kind: "invalid" };

/**
 * Lista numerada a partir de 1 e o rascunho que a pergunta guarda. `[PROVISÓRIO – P08]`: textos
 * a revisar pelo Matheus.
 */
export function buildChoice(
  target: ChoiceTarget,
  items: readonly { readonly id: string; readonly label: string }[],
): { draft: ChoiceDraft; text: string } {
  const options = items.map((item, index) => ({ n: index + 1, id: item.id, label: item.label }));
  const subject = target === "unit" ? "unidade" : "empresa";
  const lines = options.map((option) => `${option.n}. ${option.label}`);
  const text = [
    `Qual ${subject} você quer usar nos próximos lançamentos? Responda com o número:`,
    ...lines,
    "",
    "Para desistir, mande 'cancelar'.",
  ].join("\n");
  return { draft: { target, options }, text };
}

/** A resposta é só o número de uma opção (espaços e ponto final são ignorados). */
export function parseChoiceAnswer(draft: ChoiceDraft, answer: string): ChoiceAnswer {
  const digits = answer.trim().replace(/\.$/, "").trim();
  if (!/^\d+$/.test(digits)) return { kind: "invalid" };
  const chosen = draft.options.find((option) => option.n === Number(digits));
  return chosen ? { kind: "chosen", id: chosen.id, label: chosen.label } : { kind: "invalid" };
}
