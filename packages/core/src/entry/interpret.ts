import type { Money } from "../money";
import type { BusinessDate } from "./business-date";
import type { ExtractedEntry, ExtractionResult, MissingField } from "./extraction";
import { resolveAmount } from "./resolve-amount";

/** Datas mais antigas que isso são aceitas, mas destacadas (RF12.R2, sinal DATA_ANTIGA). */
export const OLD_DATE_DAYS = 60;
export const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Campos que, se faltarem, fazem o sistema perguntar antes de gravar.
 * [PROVISÓRIO – P04]: valor, quantidade de insumo, tipo não inferível, unidade ambígua (que a IA
 * reporta como `quantity`). Forma de pagamento e demais campos são presumidos pelo sistema.
 */
export const ESSENTIAL_FIELDS: readonly MissingField[] = [
  "amount",
  "type",
  "quantity",
  "occurred_on",
  "description",
];

/** Sinais que não impedem a gravação (RF12.R13). `possible_duplicate` e `category_to_review` vêm da gravação. */
export type EntryFlag = "category_to_review" | "possible_duplicate" | "old_date";

/** Por que o lançamento não pôde ser gravado ainda. */
export type PendingReason = MissingField | "amount_inconsistent" | "future_date";

export interface ReadyEntry {
  readonly extracted: ExtractedEntry;
  readonly amountCents: Money;
  readonly occurredOn: BusinessDate;
  readonly description: string;
  readonly flags: readonly EntryFlag[];
}

export interface PendingEntry {
  readonly extracted: ExtractedEntry;
  readonly reasons: readonly PendingReason[];
  /** Presente quando a conta quantidade × preço não bate com o total (RF12.R5). */
  readonly inconsistency?: { readonly computedCents: number; readonly statedCents: number };
}

export type Interpretation =
  | { readonly kind: "out_of_scope" }
  | { readonly kind: "unclear"; readonly question: string }
  | {
      readonly kind: "register";
      readonly ready: readonly ReadyEntry[];
      readonly pending: readonly PendingEntry[];
      /** Pergunta da IA, só quando todo o pendente foi apontado por ela. */
      readonly modelQuestion: string | null;
    };

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const LONG_NUMBER = /\b\d(?:[ -]?\d){12,18}\b/g;

/** Tira CPF e número de cartão/conta da descrição (RF12.R3) e limita o tamanho. */
export function sanitizeDescription(raw: string): string {
  const cleaned = raw.replace(LONG_NUMBER, "").replace(CPF, "").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, MAX_DESCRIPTION_LENGTH).join("").trim();
}

function toDayNumber(date: BusinessDate): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Dias de `date` até `today` (positivo = no passado). */
export function daysBefore(date: BusinessDate, today: BusinessDate): number {
  return toDayNumber(today) - toDayNumber(date);
}

/**
 * Aplica as regras do RF12 sobre o que a IA extraiu: o sistema decide o valor, a data e o que
 * falta. Lançamentos completos ficam prontos para gravar; os incompletos viram pergunta única.
 */
export function interpretExtraction(result: ExtractionResult, today: BusinessDate): Interpretation {
  if (result.intent === "out_of_scope") return { kind: "out_of_scope" };
  if (result.intent === "unclear") {
    return { kind: "unclear", question: result.question?.trim() ?? "" };
  }

  const ready: ReadyEntry[] = [];
  const pending: PendingEntry[] = [];
  let onlyModelReasons = true;

  for (const extracted of result.entries) {
    const reasons: PendingReason[] = extracted.missing_fields.filter((field) =>
      ESSENTIAL_FIELDS.includes(field),
    );
    let inconsistency: PendingEntry["inconsistency"];
    let amountCents: Money | null = null;

    const amount = resolveAmount(extracted);
    if (amount.ok) {
      amountCents = amount.value;
    } else if (amount.error.code === "AmountInconsistent") {
      inconsistency = {
        computedCents: amount.error.computedCents,
        statedCents: amount.error.statedCents,
      };
      reasons.push("amount_inconsistent");
      onlyModelReasons = false;
    } else if (!reasons.includes("amount")) {
      reasons.push("amount");
      onlyModelReasons = false;
    }

    const description = sanitizeDescription(extracted.description);
    if (description === "" && !reasons.includes("description")) {
      reasons.push("description");
      onlyModelReasons = false;
    }

    let occurredOn = extracted.occurred_on ?? today;
    if (extracted.occurred_on !== null && extracted.occurred_on > today) {
      reasons.push("future_date");
      onlyModelReasons = false;
      occurredOn = today;
    }

    if (reasons.length > 0 || amountCents === null) {
      pending.push({ extracted, reasons, ...(inconsistency ? { inconsistency } : {}) });
      continue;
    }
    ready.push({
      extracted,
      amountCents,
      occurredOn,
      description,
      flags: daysBefore(occurredOn, today) > OLD_DATE_DAYS ? ["old_date"] : [],
    });
  }

  const question = result.question?.trim() ?? "";
  return {
    kind: "register",
    ready,
    pending,
    modelQuestion: pending.length > 0 && onlyModelReasons && question !== "" ? question : null,
  };
}
