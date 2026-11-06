import { NO_FEE } from "../money";
import {
  type CatalogCategory,
  type CatalogSnapshot,
  findPaymentMethod,
  findSalesChannel,
  normalizeName,
  resolveFeeRule,
} from "./catalog";
import type { EntryDraft } from "./entry";
import type { EntryFlag, ReadyEntry } from "./interpret";

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

  /** Decisão "investimento" do colaborador (RF12.R23): categoria do tipo investimento. */
  const findInvestmentCategory = (hint: string | null) => {
    const investments = catalog.categories.filter((category) => category.kind === "investment");
    const matched =
      hint === null
        ? undefined
        : investments.find((category) => normalizeName(category.name) === normalizeName(hint));
    if (matched) return { id: matched.id, review: false };
    const [first] = investments;
    return first ? { id: first.id, review: true } : null;
  };

  const unit = catalog.units.find((candidate) => candidate.id === input.unitId);
  const activeChannels = catalog.salesChannels.filter((channel) => channel.status === "active");

  /**
   * Canal da receita (DD-08, RF09.Obs3): o citado; senão o canal padrão da unidade, com o sinal
   * CANAL_A_REVISAR; empresa com um só canal ativo usa esse, sem sinal. Último recurso, para
   * unidades anteriores à E11 sem canal padrão: "Não informado", também com o sinal.
   */
  const resolveRevenueChannel = (hint: string | null) => {
    const cited = hint === null || hint.trim() === "" ? null : findSalesChannel(catalog, hint);
    if (cited) return { channel: cited, review: false };
    const [only] = activeChannels;
    if (activeChannels.length === 1 && only) return { channel: only, review: false };
    const fallback =
      activeChannels.find((channel) => channel.id === unit?.defaultSalesChannelId) ??
      activeChannels.find((channel) => normalizeName(channel.name) === "nao informado") ??
      null;
    return { channel: fallback, review: true };
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

  const findPayment = (hint: string | null) =>
    hint === null || hint.trim() === "" ? null : findPaymentMethod(catalog, hint);

  const drafts = ready.map((entry, position) => {
    const { extracted } = entry;
    const investment =
      extracted.type === "expense" && extracted.asset_decision === "investment"
        ? findInvestmentCategory(extracted.category_hint)
        : null;
    const category = investment ?? findCategory(extracted.category_hint, extracted.type);
    const supplierId = findSupplier(extracted.supplier_hint);
    const paymentMethod = findPayment(extracted.payment_method_hint);
    const revenueChannel =
      extracted.type === "revenue" ? resolveRevenueChannel(extracted.sales_channel_hint) : null;
    const channel = revenueChannel?.channel ?? null;
    const fee =
      extracted.type === "revenue"
        ? resolveFeeRule({ paymentMethod, salesChannel: channel })
        : NO_FEE;

    const flags: EntryFlag[] = [...entry.flags];
    if (category.review) flags.push("category_to_review");
    if (revenueChannel?.review) flags.push("channel_to_review");
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
      paidOn: entry.paidOn,
      orders: entry.orders,
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
