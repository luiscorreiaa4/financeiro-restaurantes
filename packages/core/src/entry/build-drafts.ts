import { NO_FEE } from "../money";
import {
  type CatalogCategory,
  type CatalogSnapshot,
  normalizeName,
  resolveFeeRule,
} from "./catalog";
import type { EntryDraft } from "./entry";
import type { EntryFlag, ReadyEntry } from "./interpret";

/** "Cartão" sem especificar usa a forma de cartão padrão da empresa (RF12.R8). */
export const DEFAULT_CARD_PAYMENT_NAME = "Crédito";
const FALLBACK_CATEGORY = { expense: "Outras despesas", revenue: "Outras receitas" } as const;

/** Lançamento recente de outra mensagem, para o sinal POSSIVEL_DUPLICIDADE (RF12.R13). */
export interface RecentEntry {
  readonly inboundMessageId: string | null;
  readonly amountCents: number;
  readonly supplierId: string | null;
  readonly description: string;
  readonly occurredOn: string;
}

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  kg: "KG",
  quilo: "KG",
  quilos: "KG",
  g: "G",
  grama: "G",
  gramas: "G",
  l: "L",
  litro: "L",
  litros: "L",
  ml: "ML",
  un: "UN",
  unidade: "UN",
  unidades: "UN",
  dz: "DZ",
  duzia: "DZ",
  duzias: "DZ",
  cx: "CX",
  caixa: "CX",
  caixas: "CX",
  pct: "PCT",
  pacote: "PCT",
  pacotes: "PCT",
  fd: "FD",
  fardo: "FD",
  fardos: "FD",
  sc: "SC",
  saco: "SC",
  sacos: "SC",
};

/** Unidades do RF12.R4; o que não for reconhecido vira OUTRA. */
export function normalizeUnit(unit: string | null): string | null {
  if (unit === null || unit.trim() === "") return null;
  return UNIT_ALIASES[normalizeName(unit).replace(/\.$/, "")] ?? "OUTRA";
}

export interface BuildDraftsInput {
  readonly catalog: CatalogSnapshot;
  readonly unitId: string;
  readonly inboundMessageId: string;
  readonly recent: readonly RecentEntry[];
  /** Gera o id (UUID v7) de fornecedor novo; injetado para o teste ser determinístico. */
  readonly newId: () => string;
}

export interface DraftPlan {
  readonly drafts: readonly { readonly position: number; readonly draft: EntryDraft }[];
  readonly newSuppliers: readonly { readonly id: string; readonly name: string }[];
}

/**
 * Monta os rascunhos de lançamento: o sistema presume o que a IA não disse (RF12): categoria
 * "Outras ..." com sinal de revisão, forma de pagamento padrão para "cartão", taxa só em receita,
 * fornecedor novo quando não existe ("na dúvida, cria um novo", RF10.Obs2).
 */
export function buildDrafts(ready: readonly ReadyEntry[], input: BuildDraftsInput): DraftPlan {
  const { catalog } = input;
  const newSuppliers: { id: string; name: string }[] = [];
  const supplierIds = new Map<string, string>();

  const findCategory = (hint: string | null, kind: "expense" | "revenue") => {
    const allowed: readonly CatalogCategory["kind"][] =
      kind === "revenue" ? ["revenue"] : ["expense", "investment", "deduction"];
    const byName = (name: string) =>
      catalog.categories.find(
        (category) =>
          allowed.includes(category.kind) && normalizeName(category.name) === normalizeName(name),
      );
    const matched = hint === null ? undefined : byName(hint);
    if (matched) return { id: matched.id, review: false };
    return { id: byName(FALLBACK_CATEGORY[kind])?.id ?? null, review: true };
  };

  const findSupplier = (hint: string | null): string | null => {
    if (hint === null || hint.trim() === "") return null;
    const key = normalizeName(hint);
    const known = catalog.suppliers.find(
      (supplier) =>
        normalizeName(supplier.name) === key ||
        supplier.aliases.some((alias) => normalizeName(alias) === key),
    );
    if (known) return known.id;
    const created = supplierIds.get(key);
    if (created) return created;
    const id = input.newId();
    supplierIds.set(key, id);
    newSuppliers.push({ id, name: hint.trim() });
    return id;
  };

  const findPayment = (hint: string | null) => {
    if (hint === null || hint.trim() === "") return null;
    const key = normalizeName(hint);
    const wanted = key === "cartao" ? normalizeName(DEFAULT_CARD_PAYMENT_NAME) : key;
    return catalog.paymentMethods.find((method) => normalizeName(method.name) === wanted) ?? null;
  };

  const findChannel = (hint: string | null) => {
    if (hint === null || hint.trim() === "") return null;
    const key = normalizeName(hint);
    return catalog.salesChannels.find((channel) => normalizeName(channel.name) === key) ?? null;
  };

  const drafts = ready.map((entry, position) => {
    const { extracted } = entry;
    const category = findCategory(extracted.category_hint, extracted.type);
    const supplierId = findSupplier(extracted.supplier_hint);
    const paymentMethod = findPayment(extracted.payment_method_hint);
    const channel = extracted.type === "revenue" ? findChannel(extracted.sales_channel_hint) : null;
    const fee =
      extracted.type === "revenue"
        ? resolveFeeRule({ paymentMethod, salesChannel: channel })
        : NO_FEE;

    const flags: EntryFlag[] = [...entry.flags];
    if (category.review) flags.push("category_to_review");
    const key = normalizeName(entry.description);
    const duplicate = input.recent.some(
      (other) =>
        other.inboundMessageId !== input.inboundMessageId &&
        ((other.amountCents === entry.amountCents &&
          supplierId !== null &&
          other.supplierId === supplierId) ||
          (normalizeName(other.description) === key && other.occurredOn === entry.occurredOn)),
    );
    if (duplicate) flags.push("possible_duplicate");

    const quantityUnit =
      extracted.quantity === null ? null : normalizeUnit(extracted.quantity_unit);
    const draft: EntryDraft = {
      unitId: input.unitId,
      type: extracted.type,
      occurredOn: entry.occurredOn,
      description: entry.description,
      quantity: extracted.quantity,
      quantityUnit,
      amountCents: entry.amountCents,
      feePercentBp: fee.feePercentBp,
      feeFixedCents: fee.feeFixedCents,
      categoryId: category.id,
      supplierId,
      paymentMethodId: paymentMethod?.id ?? null,
      salesChannelId: channel?.id ?? null,
      inboundMessageId: input.inboundMessageId,
      flags,
    };
    return { position, draft };
  });

  return { drafts, newSuppliers };
}
