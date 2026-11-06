import { z } from "zod";

export const MissingFieldSchema = z.enum([
  "amount",
  "type",
  "description",
  "occurred_on",
  "quantity",
  "payment_method",
]);
export type MissingField = z.infer<typeof MissingFieldSchema>;

/**
 * O que a IA devolve. A IA só extrai: quantidade, preço unitário e total vêm como
 * ela leu. Quem valida a consistência e calcula é o sistema (`resolveAmount`).
 * Campos ausentes vêm como `null`. As regras de negócio (valor > 0 etc.) ficam
 * fora do schema, em funções testadas.
 *
 * `missing_fields` é por lançamento: os completos são gravados e só o incompleto vira
 * pergunta (RF15.Obs1).
 */
export const ExtractedEntrySchema = z.object({
  type: z.enum(["expense", "revenue"]),
  description: z.string(),
  occurred_on: z.iso.date().nullable(),
  /** Data de pagamento ou recebimento, só quando a mensagem a traz (RF12.R21). */
  paid_on: z.iso.date().nullable(),
  /** Número de vendas ou pedidos de uma receita (RF12.R22). A IA só extrai; não calcula ticket. */
  orders: z.number().nullable(),
  /** Equipamento ou reforma, quando a despesa parece investimento (RF12.R23). */
  asset_kind: z.enum(["equipment", "renovation"]).nullable(),
  /** Resposta do colaborador à pergunta de investimento; nula enquanto não respondeu. */
  asset_decision: z.enum(["investment", "expense"]).nullable(),
  quantity: z.number().nullable(),
  quantity_unit: z.string().nullable(),
  unit_price_cents: z.number().int().nullable(),
  total_cents: z.number().int().nullable(),
  category_hint: z.string().nullable(),
  supplier_hint: z.string().nullable(),
  payment_method_hint: z.string().nullable(),
  sales_channel_hint: z.string().nullable(),
  missing_fields: z.array(MissingFieldSchema),
});
export type ExtractedEntry = z.infer<typeof ExtractedEntrySchema>;

export const ExtractionResultSchema = z
  .object({
    intent: z.enum(["register", "out_of_scope", "unclear"]),
    entries: z.array(ExtractedEntrySchema),
    question: z.string().nullable(),
  })
  .superRefine((result, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const hasQuestion = result.question !== null && result.question.trim() !== "";
    const hasMissing = result.entries.some((entry) => entry.missing_fields.length > 0);

    if (result.intent === "register" && result.entries.length === 0) {
      issue("intenção register exige ao menos um lançamento");
    }
    if (result.intent !== "register" && result.entries.length > 0) {
      issue("só a intenção register pode trazer lançamentos");
    }
    if (result.intent === "unclear" && !hasQuestion) {
      issue("intenção unclear exige uma pergunta");
    }
    if (result.intent === "out_of_scope" && hasQuestion) {
      issue("fora de escopo não faz pergunta");
    }
    if (result.intent === "register" && hasMissing !== hasQuestion) {
      issue("campos faltantes e pergunta andam juntos");
    }
  });
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
