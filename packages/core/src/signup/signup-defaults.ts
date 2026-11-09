import type { PaymentMethodType, SalesChannelType } from "../registry/catalog-types";
import { BRAZILIAN_STATES } from "../registry/unit";

/** Teste de 14 dias. [PROVISÓRIO – P03] (RF01.R15). */
export const TRIAL_DAYS = 14;

/** Versões vigentes dos documentos aceitos no cadastro (RF01.R13). */
export const LEGAL_VERSIONS = {
  terms: "2026-11-09",
  privacy: "2026-11-09",
  dpa: "2026-11-09",
} as const;

/** RF01.R4. */
export const SEGMENTS = [
  "restaurant",
  "bar",
  "snack_bar",
  "pizzeria",
  "bakery",
  "cafe",
  "burger_joint",
  "food_truck",
  "other",
] as const;
export type Segment = (typeof SEGMENTS)[number];

/** RF01.R6. */
export const REVENUE_RANGES = [
  "up_to_30k",
  "from_30k_to_100k",
  "from_100k_to_300k",
  "above_300k",
  "prefer_not_to_say",
] as const;
export type RevenueRange = (typeof REVENUE_RANGES)[number];

/**
 * Situação da Conta (RF01.R16, transições no RF37): ATIVA, SOMENTE_LEITURA, CANCELADA e ENCERRADA.
 * O CNPJ só é único entre contas que não estão `closed` (RF01.R3).
 */
export const ACCOUNT_STATUSES = ["active", "read_only", "canceled", "closed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Fusos fora do padrão America/Sao_Paulo (RF01.R8, RF04.R4). */
const TIMEZONE_BY_UF: Readonly<Record<string, string>> = {
  AC: "America/Rio_Branco",
  AM: "America/Manaus",
  RO: "America/Porto_Velho",
  RR: "America/Boa_Vista",
  MT: "America/Cuiaba",
  MS: "America/Campo_Grande",
  AL: "America/Maceio",
  SE: "America/Maceio",
  BA: "America/Bahia",
  PA: "America/Belem",
  AP: "America/Belem",
  MA: "America/Fortaleza",
  PI: "America/Fortaleza",
  CE: "America/Fortaleza",
  RN: "America/Fortaleza",
  PB: "America/Fortaleza",
  PE: "America/Recife",
  TO: "America/Araguaina",
};

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/** Fuso sugerido pela UF; `America/Sao_Paulo` quando não houver mapeamento (RF01.R8). */
export function timezoneForUf(uf: string): string {
  const key = uf.trim().toUpperCase();
  if (!(BRAZILIAN_STATES as readonly string[]).includes(key)) return DEFAULT_TIMEZONE;
  return TIMEZONE_BY_UF[key] ?? DEFAULT_TIMEZONE;
}

export interface DefaultPaymentMethod {
  readonly name: string;
  readonly type: PaymentMethodType;
  readonly feePercentBp: number;
  readonly feeFixedCents: number;
  readonly isDefaultCard: boolean;
}

export interface DefaultSalesChannel {
  readonly name: string;
  readonly type: SalesChannelType;
  readonly feePercentBp: number;
}

const pm = (
  name: string,
  type: PaymentMethodType,
  isDefaultCard = false,
): DefaultPaymentMethod => ({
  name,
  type,
  feePercentBp: 0,
  feeFixedCents: 0,
  isDefaultCard,
});
const ch = (name: string, type: SalesChannelType): DefaultSalesChannel => ({
  name,
  type,
  feePercentBp: 0,
});

/**
 * Cadastros criados junto com a empresa (RF01.Obs2, RF08.Obs2, RF09.Obs2), taxas zeradas.
 * [PROVISÓRIO – P07] Lista até o Matheus definir. "Não informada" e "Não informado" não
 * estão em RF08.Obs2/RF09.Obs2, mas a IA os usa (RF12); conflito a levar ao Matheus.
 */
export const SIGNUP_DEFAULTS = {
  paymentMethods: [
    pm("Dinheiro", "cash"),
    pm("Pix", "pix"),
    pm("Débito", "debit"),
    pm("Crédito", "credit", true),
    pm("Voucher", "voucher"),
    pm("Não informada", "other"),
  ] as readonly DefaultPaymentMethod[],
  salesChannels: [
    ch("Salão", "dine_in"),
    ch("Delivery próprio", "own_delivery"),
    ch("iFood", "app"),
    ch("Retirada", "pickup"),
    ch("Não informado", "other"),
  ] as readonly DefaultSalesChannel[],
  /** Canal padrão da receita (RF09, RF12). */
  defaultSalesChannelName: "Salão",
} as const;
