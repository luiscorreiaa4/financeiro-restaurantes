import type { FeeRule } from "../money/fee";
import type { SalesChannelType } from "../registry/catalog-types";
import { resolveFeeRule } from "./catalog";
import { type ChangeContext, type Entry, type EntryChange, editEntry } from "./entry";

/** Taxa cadastrada da forma de pagamento ou do canal (F6a, RF08 e RF09). `FeeSource` é um alias de `FeeRule`. */
export type FeeSource = FeeRule;

export interface FeeReapplicationCatalog {
  readonly paymentMethods: ReadonlyMap<string, FeeSource>;
  readonly salesChannels: ReadonlyMap<
    string,
    { readonly type: SalesChannelType; readonly feePercentBp: number }
  >;
}

export interface FeeReapplicationPlan {
  readonly changes: EntryChange[];
  /** Lançamentos cuja taxa mudaria. */
  readonly matched: number;
  /** Receitas não recalculadas (cadastro ausente ou erro de cálculo); não entram em `changes`, `matched` nem no delta. */
  readonly skipped: number;
  /** Inteiro em centavos com sinal (Money não admite negativo). Soma de (líquido novo − líquido antigo); negativa quando a taxa sobe. */
  readonly deltaNetCents: number;
}

/**
 * Plano da reaplicação da taxa atual a lançamentos passados (RF08 e RF09, Alteração).
 * Só receita não excluída; a regra vem de `resolveFeeRule` (P06: a comissão do canal de aplicativo
 * manda sobre a taxa da forma). Lançamento que já tem a regra é pulado, o que torna o plano idempotente.
 * Quem chama filtra por alvo e período; aqui só se calcula.
 */
export function planFeeReapplication(
  entries: readonly Entry[],
  catalog: FeeReapplicationCatalog,
  ctx: ChangeContext,
): FeeReapplicationPlan {
  const changes: EntryChange[] = [];
  let delta = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.type !== "revenue" || entry.deletedAt !== null) continue;
    // Id não nulo ausente do catálogo não é "sem taxa": pula, para não zerar a taxa em silêncio.
    const paymentMethod =
      entry.paymentMethodId === null
        ? null
        : (catalog.paymentMethods.get(entry.paymentMethodId) ?? undefined);
    const salesChannel =
      entry.salesChannelId === null
        ? null
        : (catalog.salesChannels.get(entry.salesChannelId) ?? undefined);
    if (paymentMethod === undefined || salesChannel === undefined) {
      skipped += 1;
      continue;
    }
    const rule = resolveFeeRule({ paymentMethod, salesChannel });
    const result = editEntry(
      entry,
      { feePercentBp: rule.feePercentBp, feeFixedCents: rule.feeFixedCents },
      ctx,
    );
    if (!result.ok) {
      if (result.error.code !== "NothingToChange") skipped += 1;
      continue;
    }
    delta += result.value.entry.netCents - entry.netCents;
    changes.push(result.value);
  }
  return { changes, matched: changes.length, skipped, deltaNetCents: delta };
}
