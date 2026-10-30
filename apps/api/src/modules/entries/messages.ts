import {
  type CatalogSnapshot,
  type Entry,
  type EntryFlag,
  formatBRL,
  type PendingEntry,
  type PendingReason,
} from "@app/core";

/**
 * Textos do lançamento, da pergunta, da correção e do desfazer, em pt-BR.
 * `[PROVISÓRIO – P08]`: rascunhos conforme RF16, RF17, RF18 e RF19; o Matheus revisa. Tudo mora
 * aqui para trocar sem mexer na lógica. Os valores vêm sempre do sistema, nunca da IA (regra 3).
 */

/** Mais que isso: mostra os primeiros e o total (RF16.Obs4). */
export const MAX_CONFIRMATION_LINES = 10;

export const NOTHING_TO_UNDO_24H_TEXT =
  "Não encontrei lançamento seu nas últimas 24 horas para desfazer. Pelo painel você pode ver e apagar lançamentos mais antigos.";
export const ALREADY_UNDONE_TEXT = "Esse lançamento já foi desfeito.";
export const CANNOT_CHANGE_OTHERS_TEXT = "Você só pode mexer nos lançamentos que você mesmo fez.";
export const EXTRACTION_FAILED_TEXT =
  "Não consegui entender essa mensagem. Pode escrever de outro jeito? Exemplo: 'paguei 350 de carne no açougue'.";
export const CORRECTION_UNCLEAR_HINT =
  "Responda à confirmação dizendo o que mudar. Exemplo: 'foi 400' ou 'o 2 foi 400'.";
export const CORRECTION_STALE_TEXT = "Esse lançamento foi alterado agora há pouco. Tente de novo.";
export const CORRECTION_NO_CHANGE_TEXT = `Não consegui aplicar essa correção. ${CORRECTION_UNCLEAR_HINT}`;
export const CORRECTION_FUTURE_DATE_TEXT =
  "Pelo WhatsApp eu não aceito data futura. Qual foi a data?";
export const PENDING_DISCARDED_TEXT = "Pronto, descartei o lançamento pendente.";
export const OPEN_QUESTION_HINT = "Responda esta mensagem ou envie *cancelar* para descartar.";
export const AUDIO_TOO_LONG_TEXT =
  "Seu áudio tem mais de 3 minutos. Pode mandar em partes menores?";
export const AUDIO_UNINTELLIGIBLE_TEXT =
  "Não consegui entender o áudio. Pode repetir ou mandar por texto?";
export const IMAGE_TOO_BIG_TEXT = "Essa imagem passou de 5 MB. Pode mandar uma foto menor?";
export const RECEIPT_UNREADABLE_TEXT =
  "Não consegui ler os valores da nota, então não registrei nada. Pode mandar uma foto mais nítida ou digitar os valores?";
export const UNIT_MISSING_TEXT =
  "Não encontrei um restaurante cadastrado para registrar. Fale com o suporte.";

const brl = (cents: number) => formatBRL(cents as Parameters<typeof formatBRL>[0]);

/** "2026-10-30" → "30/10" (data de negócio nunca passa por `Date`). */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}
function longDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function quantityText(entry: Entry): string {
  if (entry.quantity === null) return "";
  const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(
    entry.quantity,
  );
  return `, ${number}${entry.quantityUnit ? ` ${entry.quantityUnit.toLowerCase()}` : ""}`;
}

/** Uma linha por lançamento (RF16.R2): descrição, quantidade, valor, categoria, data, forma e líquido. */
export function entryLine(entry: Entry, catalog: CatalogSnapshot): string {
  const category = catalog.categories.find((item) => item.id === entry.categoryId)?.name;
  const payment = catalog.paymentMethods.find((item) => item.id === entry.paymentMethodId)?.name;
  const parts = [
    `${entry.description}${quantityText(entry)}: ${brl(entry.amountCents)}`,
    category ? `(${category})` : null,
    `em ${shortDate(entry.occurredOn)}`,
    payment ?? null,
    entry.type === "revenue" && entry.feeCents > 0 ? `líquido ${brl(entry.netCents)}` : null,
  ].filter((part): part is string => part !== null);
  return `• ${parts.join(" ")}`;
}

function warningLine(flag: EntryFlag, entry: Entry): string {
  switch (flag) {
    case "category_to_review":
      return `⚠️ Categoria a revisar: ${entry.description}`;
    case "possible_duplicate":
      return `⚠️ Possível duplicidade: ${entry.description}`;
    case "old_date":
      return `⚠️ Data antiga: ${entry.description} (${longDate(entry.occurredOn)})`;
  }
}

/** Nome da unidade (e da empresa quando o usuário tem mais de uma), RF16.R1 e RF11.R5. */
export function placeLabel(input: {
  unitName: string | null;
  tenantName: string;
  tenantCount: number;
}): string {
  const unit = input.unitName ?? input.tenantName;
  return input.tenantCount > 1 && input.unitName !== null ? `${input.tenantName} – ${unit}` : unit;
}

/** Confirmação padrão (RF16). `heard` é o trecho entendido do áudio (RF13.Obs2). */
export function confirmationText(input: {
  entries: readonly Entry[];
  catalog: CatalogSnapshot;
  place: string;
  heard?: string | undefined;
}): string {
  const { entries, catalog } = input;
  const shown = entries.slice(0, MAX_CONFIRMATION_LINES);
  const lines = [
    ...(input.heard ? [`Entendi: "${input.heard}"`, ""] : []),
    `✅ Registrado (${input.place}):`,
    ...shown.map((entry) => entryLine(entry, catalog)),
  ];
  if (entries.length > shown.length) {
    const total = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
    lines.push(`… e mais ${entries.length - shown.length} lançamentos. Total: ${brl(total)}`);
  }
  const warnings = entries.flatMap((entry) => entry.flags.map((flag) => warningLine(flag, entry)));
  if (warnings.length > 0) lines.push("", ...warnings);
  lines.push(
    "",
    "Para ajustar, responda esta mensagem dizendo o que mudar. 'desfazer' apaga este registro.",
  );
  return lines.join("\n");
}

export function correctionText(entries: readonly Entry[], catalog: CatalogSnapshot): string {
  return [
    "✏️ Corrigido:",
    ...entries.map((entry) => entryLine(entry, catalog)),
    "",
    "Para ajustar de novo, responda à confirmação original.",
  ].join("\n");
}

export function undoText(entries: readonly Entry[], catalog: CatalogSnapshot): string {
  return ["↩️ Desfeito:", ...entries.map((entry) => entryLine(entry, catalog))].join("\n");
}

export function askWhichText(entries: readonly Entry[]): string {
  return [
    "Qual lançamento você quer corrigir? Responda à confirmação citando o número, por exemplo 'o 2 foi 400':",
    ...entries.map((entry, index) => `${index + 1}. ${entry.description}`),
  ].join("\n");
}

export function discardedText(descriptions: readonly string[]): string {
  return `Deixei de lado o lançamento ${descriptions.length > 1 ? "de " : "do(a) "}${descriptions.join(", ")}.`;
}

export function unresolvedText(
  kinds: readonly ("category" | "payment_method" | "sales_channel")[],
): string {
  const names = {
    category: "categoria",
    payment_method: "forma de pagamento",
    sales_channel: "canal",
  };
  return `Não encontrei ${kinds.map((kind) => names[kind]).join(" nem ")} com esse nome; o resto foi corrigido.`;
}

const reasonText = (pending: PendingEntry, reason: PendingReason): string => {
  const name = pending.extracted.description.trim() || "esse lançamento";
  switch (reason) {
    case "amount":
      return `Qual foi o valor de ${name}?`;
    case "amount_inconsistent":
      return `Em ${name}: a conta dá ${brl(pending.inconsistency?.computedCents ?? 0)}, mas você falou ${brl(pending.inconsistency?.statedCents ?? 0)}. Qual está certo?`;
    case "future_date":
      return `Em ${name}: não aceito data futura. Qual foi a data?`;
    case "quantity":
      return `Qual foi a quantidade de ${name}?`;
    case "type":
      return `${name} foi uma despesa ou uma venda?`;
    case "occurred_on":
      return `Qual foi a data de ${name}?`;
    case "description":
      return "O que foi esse lançamento?";
    default:
      return `Pode detalhar ${name}?`;
  }
};

/** Pergunta única; várias faltas viram uma lista numerada (RF15.R2). */
export function questionText(
  pending: readonly PendingEntry[],
  modelQuestion: string | null,
): string {
  const body =
    modelQuestion ??
    (() => {
      const questions = pending.flatMap((entry) =>
        entry.reasons.map((reason) => reasonText(entry, reason)),
      );
      return questions.length === 1
        ? (questions[0] ?? "")
        : questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
    })();
  return `${body}\n\n${OPEN_QUESTION_HINT}`;
}

/** Nota repetida (RF14.R2): "Essa nota já foi registrada em dd/mm por [nome]". */
export function duplicateReceiptText(registeredAt: Date, userName: string): string {
  const day = String(registeredAt.getDate()).padStart(2, "0");
  const month = String(registeredAt.getMonth() + 1).padStart(2, "0");
  return `Essa nota já foi registrada em ${day}/${month} por ${userName}.`;
}
