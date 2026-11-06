import { type FeeRule, NO_FEE } from "../money";
import type { CatalogStatus, PaymentMethodType, SalesChannelType } from "../registry/catalog-types";

/** Cadastro do tenant que a gravação consulta (lido uma vez por mensagem). */
export interface CatalogCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: "revenue" | "expense" | "investment" | "deduction";
}
export interface CatalogSupplier {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
}
export interface CatalogPaymentMethod extends FeeRule {
  readonly id: string;
  readonly name: string;
  readonly type: PaymentMethodType;
  readonly aliases: readonly string[];
  readonly status: CatalogStatus;
  /** A forma que "cartão" sem especificar usa (RF12.R8). */
  readonly isDefaultCard: boolean;
}
export interface CatalogSalesChannel {
  readonly id: string;
  readonly name: string;
  readonly type: SalesChannelType;
  readonly aliases: readonly string[];
  readonly status: CatalogStatus;
  /** Comissão do canal em pontos-base (iFood 23% = 2300). */
  readonly feePercentBp: number;
}
export interface CatalogUnit {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly status: CatalogStatus;
  /** Canal usado quando a receita chega sem canal (RF04.R6, DD-08). */
  readonly defaultSalesChannelId: string | null;
}

export interface CatalogSnapshot {
  readonly categories: readonly CatalogCategory[];
  readonly suppliers: readonly CatalogSupplier[];
  readonly paymentMethods: readonly CatalogPaymentMethod[];
  readonly salesChannels: readonly CatalogSalesChannel[];
  readonly units: readonly CatalogUnit[];
}

/** Minúsculas, sem acento e sem espaço sobrando: "  Atacadão " casa com "atacadao". */
export function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const matches = (name: string, aliases: readonly string[], key: string) =>
  normalizeName(name) === key || aliases.some((alias) => normalizeName(alias) === key);

/**
 * Forma de pagamento citada na mensagem: pelo nome ou apelido, só entre as ativas (RF08.R5).
 * "Cartão" sem especificar vira a forma de cartão padrão da empresa (RF12.R8); sem ela, nenhuma.
 */
export function findPaymentMethod(
  catalog: CatalogSnapshot,
  hint: string,
): CatalogPaymentMethod | null {
  const key = normalizeName(hint);
  const active = catalog.paymentMethods.filter((method) => method.status === "active");
  const byName = active.find((method) => matches(method.name, method.aliases, key));
  if (byName) return byName;
  return key === "cartao" ? (active.find((method) => method.isDefaultCard) ?? null) : null;
}

/** Canal de venda citado na mensagem: pelo nome ou apelido, só entre os ativos (RF09). */
export function findSalesChannel(
  catalog: CatalogSnapshot,
  hint: string,
): CatalogSalesChannel | null {
  const key = normalizeName(hint);
  return (
    catalog.salesChannels.find(
      (channel) => channel.status === "active" && matches(channel.name, channel.aliases, key),
    ) ?? null
  );
}

/**
 * Taxa da receita (RF08.R3 e RF09.R4). `[PROVISÓRIO – P06]`: canal do tipo aplicativo com comissão
 * maior que zero substitui a taxa da forma de pagamento; as duas nunca são somadas.
 * Despesa nunca tem taxa; quem chama não passa forma nem canal para ela.
 */
export function resolveFeeRule(input: {
  paymentMethod: FeeRule | null;
  salesChannel: { readonly type: SalesChannelType; readonly feePercentBp: number } | null;
}): FeeRule {
  if (
    input.salesChannel !== null &&
    input.salesChannel.type === "app" &&
    input.salesChannel.feePercentBp > 0
  ) {
    return { feePercentBp: input.salesChannel.feePercentBp, feeFixedCents: 0 };
  }
  return input.paymentMethod
    ? {
        feePercentBp: input.paymentMethod.feePercentBp,
        feeFixedCents: input.paymentMethod.feeFixedCents,
      }
    : NO_FEE;
}
