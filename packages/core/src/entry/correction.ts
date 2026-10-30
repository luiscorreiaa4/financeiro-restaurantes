import { z } from "zod";
import { type Money, money } from "../money";
import { normalizeUnit } from "./build-drafts";
import { type CatalogSnapshot, normalizeName, resolveFeeRule } from "./catalog";
import type { Entry, EntryFields } from "./entry";
import { daysBefore, sanitizeDescription } from "./interpret";

/**
 * Correção por reply (RF17). A IA só diz o que mudar, nos campos que o usuário citou; o sistema
 * valida, recalcula taxa e líquido e grava a versão. `targets` são as posições (1, 2, ...) dos
 * lançamentos da confirmação; vazio quando o usuário não citou nenhum.
 */
export const CorrectionChangesSchema = z.object({
  description: z.string().nullable(),
  occurred_on: z.iso.date().nullable(),
  quantity: z.number().nullable(),
  quantity_unit: z.string().nullable(),
  total_cents: z.number().int().nullable(),
  category_hint: z.string().nullable(),
  payment_method_hint: z.string().nullable(),
  sales_channel_hint: z.string().nullable(),
});
export type CorrectionChanges = z.infer<typeof CorrectionChangesSchema>;

export const CorrectionResultSchema = z
  .object({
    intent: z.enum(["correct", "unclear", "out_of_scope"]),
    targets: z.array(z.number().int().min(1)),
    changes: CorrectionChangesSchema,
    question: z.string().nullable(),
  })
  .superRefine((result, ctx) => {
    if (result.intent === "unclear" && (result.question ?? "").trim() === "") {
      ctx.addIssue({ code: "custom", message: "intenção unclear exige uma pergunta" });
    }
  });
export type CorrectionResult = z.infer<typeof CorrectionResultSchema>;

export type CorrectionOutcome =
  | {
      readonly kind: "ready";
      /** Um alvo por lançamento a alterar, com o que muda e o que não deu para aplicar. */
      readonly patches: readonly { readonly entry: Entry; readonly patch: Partial<EntryFields> }[];
      readonly unresolved: readonly ("category" | "payment_method" | "sales_channel")[];
    }
  | { readonly kind: "ask_which"; readonly count: number }
  | { readonly kind: "ask"; readonly question: string }
  | { readonly kind: "out_of_scope" }
  | { readonly kind: "rejected"; readonly reason: "future_date" | "no_change" };

/**
 * Decide o que alterar. Vários lançamentos na confirmação e nenhum citado: pergunta qual
 * (RF17.R2). A taxa só é recalculada com as taxas atuais quando a forma de pagamento ou o canal
 * mudam; fora isso vale a taxa da gravação original (RF17.R3).
 */
export function planCorrection(
  result: CorrectionResult,
  entries: readonly Entry[],
  catalog: CatalogSnapshot,
  today: string,
): CorrectionOutcome {
  if (result.intent === "out_of_scope") return { kind: "out_of_scope" };
  if (result.intent === "unclear") return { kind: "ask", question: result.question ?? "" };

  const targets = [...new Set(result.targets)].filter(
    (position) => position >= 1 && position <= entries.length,
  );
  if (entries.length > 1 && targets.length === 0) {
    return { kind: "ask_which", count: entries.length };
  }
  const selected =
    entries.length === 1 ? entries : targets.map((position) => entries[position - 1] as Entry);

  const { changes } = result;
  if (changes.occurred_on !== null && daysBefore(changes.occurred_on, today) < 0) {
    return { kind: "rejected", reason: "future_date" };
  }

  const unresolved: ("category" | "payment_method" | "sales_channel")[] = [];
  const patches = selected.map((entry) => {
    const patch: { -readonly [K in keyof EntryFields]?: EntryFields[K] } = {};
    if (changes.total_cents !== null) {
      const amount = money(changes.total_cents);
      if (amount.ok && amount.value > 0) patch.amountCents = amount.value as Money;
    }
    if (changes.description !== null) {
      const description = sanitizeDescription(changes.description);
      if (description !== "") patch.description = description;
    }
    if (changes.occurred_on !== null) patch.occurredOn = changes.occurred_on;
    if (changes.quantity !== null) {
      patch.quantity = changes.quantity;
      patch.quantityUnit = normalizeUnit(changes.quantity_unit) ?? entry.quantityUnit;
    } else if (changes.quantity_unit !== null && entry.quantity !== null) {
      patch.quantityUnit = normalizeUnit(changes.quantity_unit);
    }
    if (changes.category_hint !== null) {
      const key = normalizeName(changes.category_hint);
      const category = catalog.categories.find((item) => normalizeName(item.name) === key);
      if (category) patch.categoryId = category.id;
      else if (!unresolved.includes("category")) unresolved.push("category");
    }

    let paymentMethod = catalog.paymentMethods.find((item) => item.id === entry.paymentMethodId);
    let channel = catalog.salesChannels.find((item) => item.id === entry.salesChannelId);
    let feeChanged = false;
    if (changes.payment_method_hint !== null) {
      const key = normalizeName(changes.payment_method_hint);
      const found = catalog.paymentMethods.find((item) => normalizeName(item.name) === key);
      if (found) {
        paymentMethod = found;
        patch.paymentMethodId = found.id;
        feeChanged = true;
      } else if (!unresolved.includes("payment_method")) unresolved.push("payment_method");
    }
    if (changes.sales_channel_hint !== null && entry.type === "revenue") {
      const key = normalizeName(changes.sales_channel_hint);
      const found = catalog.salesChannels.find((item) => normalizeName(item.name) === key);
      if (found) {
        channel = found;
        patch.salesChannelId = found.id;
        feeChanged = true;
      } else if (!unresolved.includes("sales_channel")) unresolved.push("sales_channel");
    }
    if (feeChanged && entry.type === "revenue") {
      const fee = resolveFeeRule({
        paymentMethod: paymentMethod ?? null,
        salesChannel: channel ?? null,
      });
      patch.feePercentBp = fee.feePercentBp;
      patch.feeFixedCents = fee.feeFixedCents;
    }
    return { entry, patch };
  });

  const hasAnyChange = patches.some(({ patch }) => Object.keys(patch).length > 0);
  if (!hasAnyChange) return { kind: "rejected", reason: "no_change" };
  return { kind: "ready", patches, unresolved };
}
