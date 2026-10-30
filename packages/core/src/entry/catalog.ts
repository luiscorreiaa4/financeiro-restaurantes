import { type FeeRule, NO_FEE } from "../money";

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
}
export interface CatalogSalesChannel {
  readonly id: string;
  readonly name: string;
  /** Comissão do canal em pontos-base (iFood 23% = 2300). */
  readonly feePercentBp: number;
}
export interface CatalogUnit {
  readonly id: string;
  readonly name: string;
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

/**
 * Taxa da receita (RF08.R3 e RF09.R4). `[PROVISÓRIO – P06]`: canal com comissão maior que zero
 * (aplicativo) substitui a taxa da forma de pagamento; as duas nunca são somadas. Hoje o cadastro
 * não distingue o tipo do canal: comissão > 0 faz o papel de "APLICATIVO" (o tipo chega na E11).
 * Despesa nunca tem taxa; quem chama não passa forma nem canal para ela.
 */
export function resolveFeeRule(input: {
  paymentMethod: FeeRule | null;
  salesChannel: { readonly feePercentBp: number } | null;
}): FeeRule {
  if (input.salesChannel !== null && input.salesChannel.feePercentBp > 0) {
    return { feePercentBp: input.salesChannel.feePercentBp, feeFixedCents: 0 };
  }
  return input.paymentMethod
    ? {
        feePercentBp: input.paymentMethod.feePercentBp,
        feeFixedCents: input.paymentMethod.feeFixedCents,
      }
    : NO_FEE;
}
