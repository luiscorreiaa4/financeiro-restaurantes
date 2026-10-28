import { z } from "zod";

/**
 * O que a IA devolve. A IA só extrai: quantidade, preço unitário e total vêm como
 * ela leu. Quem valida a consistência e calcula é o sistema (`resolveAmount`).
 * Campos ausentes vêm como `null`. As regras de negócio (valor > 0 etc.) ficam
 * fora do schema, em funções testadas.
 */
export const ExtractedEntrySchema = z.object({
  type: z.enum(["expense", "revenue"]),
  description: z.string(),
  occurred_on: z.iso.date().nullable(),
  quantity: z.number().nullable(),
  quantity_unit: z.string().nullable(),
  unit_price_cents: z.number().int().nullable(),
  total_cents: z.number().int().nullable(),
  category_hint: z.string().nullable(),
  supplier_hint: z.string().nullable(),
  payment_method_hint: z.string().nullable(),
  sales_channel_hint: z.string().nullable(),
});
export type ExtractedEntry = z.infer<typeof ExtractedEntrySchema>;

export const MissingFieldSchema = z.enum([
  "amount",
  "type",
  "description",
  "occurred_on",
  "quantity",
  "payment_method",
]);
export type MissingField = z.infer<typeof MissingFieldSchema>;

export const ExtractionResultSchema = z
  .object({
    intent: z.enum(["register", "out_of_scope", "unclear"]),
    entries: z.array(ExtractedEntrySchema),
    question: z.string().nullable(),
    missing_fields: z.array(MissingFieldSchema),
  })
  .superRefine((result, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const hasQuestion = result.question !== null && result.question.trim() !== "";
    const hasMissing = result.missing_fields.length > 0;

    if (result.intent === "register" && result.entries.length === 0) {
      issue("intenção register exige ao menos um lançamento");
    }
    if (result.intent !== "register" && result.entries.length > 0) {
      issue("só a intenção register pode trazer lançamentos");
    }
    if (result.intent === "unclear" && !hasQuestion) {
      issue("intenção unclear exige uma pergunta");
    }
    if (result.intent === "out_of_scope" && (hasQuestion || hasMissing)) {
      issue("fora de escopo não faz pergunta nem lista campos faltantes");
    }
    if (result.intent === "register" && hasMissing !== hasQuestion) {
      issue("campos faltantes e pergunta andam juntos");
    }
  });
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
