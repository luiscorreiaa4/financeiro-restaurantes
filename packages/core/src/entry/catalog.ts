import { type FeeRule, NO_FEE } from "../money";
import type { CatalogStatus, PaymentMethodType, SalesChannelType } from "../registry/catalog-types";

/** Cadastro do tenant que a gravação consulta (lido uma vez por mensagem). */
export interface CatalogCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: "revenue" | "expense" | "investment" | "deduction";
  /** Categoria exige quantidade e unidade de medida (RF12.R4). Ausente = não exige. */
  readonly requiresQuantity?: boolean;
  /** Ausente = ativa. */
  readonly status?: CatalogStatus;
  /** Categoria sensível (folha, RF06.R3). Ausente conta como sensível: na dúvida, falha fechado. */
  readonly isSensitive?: boolean;
}
export interface CatalogSupplier {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  /** Fornecedor mesclado em outro (RF10): some da busca; o destino herda o nome como apelido. */
  readonly mergedIntoId?: string | null;
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
  /** Fuso da unidade (IANA). Ausente = fuso padrão. */
  readonly timezone?: string;
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

/** Fornecedor citado pelo nome ou apelido, sem caixa nem acento (RF12.R7); nulo se não existe. */
export function findSupplier(catalog: CatalogSnapshot, hint: string): CatalogSupplier | null {
  const key = normalizeName(hint);
  return (
    catalog.suppliers.find(
      (supplier) =>
        (supplier.mergedIntoId ?? null) === null && matches(supplier.name, supplier.aliases, key),
    ) ?? null
  );
}

/**
 * Fornecedor escolhido no painel (RF12.R7, RF10): `{ id }` segue como veio (o domínio confere se
 * existe), `{ name }` associa o cadastrado por nome ou apelido (sem caixa nem espaço) ou cria um
 * novo com `newId()`. O nome já vem validado pelo contrato.
 */
export function resolveSupplierChoice(
  catalog: CatalogSnapshot,
  choice: { readonly id: string } | { readonly name: string } | null,
  newId: () => string,
): { supplierId: string | null; newSupplier?: { id: string; name: string } } {
  if (choice === null) return { supplierId: null };
  if ("id" in choice) return { supplierId: choice.id };
  const known = findSupplier(catalog, choice.name);
  if (known !== null) return { supplierId: known.id };
  const created = { id: newId(), name: choice.name };
  return { supplierId: created.id, newSupplier: created };
}

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
 * Unidade citada na mensagem (DE-25): pelo nome ou apelido, só entre as ativas e de acesso do
 * vínculo (`accessibleIds`). Unidade a que a pessoa não tem acesso nunca é devolvida.
 */
export function findUnit(
  catalog: CatalogSnapshot,
  hint: string,
  accessibleIds: readonly string[],
): CatalogUnit | null {
  const key = normalizeName(hint);
  return (
    catalog.units.find(
      (unit) =>
        unit.status === "active" &&
        accessibleIds.includes(unit.id) &&
        matches(unit.name, unit.aliases, key),
    ) ?? null
  );
}

/**
 * Unidade em que o lançamento cai (DE-25). Ordem: a unidade citada no texto, a dica da IA
 * (`unit_hint`), a padrão do vínculo e, sem padrão, a primeira unidade **ativa e de acesso** do
 * cadastro. Unidade fora do acesso do vínculo nunca é usada. A padrão inativa é devolvida de
 * propósito: quem chama recusa o lançamento (RF04.R5), em vez de escolher outra sem avisar.
 */
export function pickUnit(input: {
  readonly catalog: CatalogSnapshot;
  readonly citedUnitId: string | null;
  readonly hint: string | null;
  readonly defaultUnitId: string | null;
  readonly accessibleIds: readonly string[];
}): string | null {
  const { catalog, accessibleIds } = input;
  const exists = (id: string | null): id is string =>
    id !== null && accessibleIds.includes(id) && catalog.units.some((unit) => unit.id === id);
  if (exists(input.citedUnitId)) return input.citedUnitId;
  const hinted = input.hint === null ? null : findUnit(catalog, input.hint, accessibleIds);
  if (hinted) return hinted.id;
  if (exists(input.defaultUnitId)) return input.defaultUnitId;
  return (
    catalog.units.find((unit) => unit.status === "active" && accessibleIds.includes(unit.id))?.id ??
    null
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
