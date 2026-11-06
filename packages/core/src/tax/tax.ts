import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

/**
 * Imposto estimado por regime tributário (RF39, DD-05). Função pura, em centavos inteiros e com
 * arredondamento meio-para-cima; a IA não participa (RNF13.R3). As regras de cálculo (alíquotas,
 * faixas, percentuais) vêm de uma tabela versionada por vigência e nunca ficam no código.
 * `[PROVISÓRIO – P16, P17]`: os valores e fórmulas reais são do Matheus; aqui está só a estrutura.
 */

export const TAX_REGIMES = ["mei", "simples_nacional", "lucro_presumido", "lucro_real"] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];
/** O que o Dono pode escolher: os quatro regimes ou "não sei" (que não permite ativar). */
export const TAX_REGIME_CHOICES = [...TAX_REGIMES, "not_sure"] as const;
export type TaxRegimeChoice = (typeof TAX_REGIME_CHOICES)[number];

export const TAX_DISCLAIMER = "Estimativa gerencial. Não substitui a apuração do contador.";

export interface SimplesBracket {
  /** Limite superior da receita dos 12 meses anteriores (RBT12) da faixa, em centavos. */
  readonly upToCents: number;
  readonly nominalBp: number;
  readonly deductionCents: number;
}

export type TaxFormula =
  /** MEI: valor fixo por mês. */
  | { readonly kind: "fixed_monthly"; readonly amountCents: number }
  /** Simples Nacional: alíquota efetiva pela faixa da RBT12 (`rbt12Cents` nos parâmetros). */
  | { readonly kind: "simples_brackets"; readonly brackets: readonly SimplesBracket[] }
  /** Percentual direto sobre a receita do mês. */
  | { readonly kind: "percent_of_revenue"; readonly rateBp: number }
  /** Percentual sobre o lucro presumido (receita × presunção × alíquota). */
  | { readonly kind: "presumed_profit"; readonly presumptionBp: number; readonly rateBp: number }
  /** Percentual sobre a receita menos os créditos informados (`creditsCents`), nunca negativo. */
  | { readonly kind: "revenue_minus_credits"; readonly rateBp: number };

export interface TaxRuleComponent {
  readonly label: string;
  readonly formula: TaxFormula;
}

/** Linha da tabela `tax_rules`: nunca é editada, mudar regra cria linha nova (RF39.R4). */
export interface TaxRule {
  readonly regime: TaxRegime;
  readonly validFrom: string;
  /** Nulo = sem fim. */
  readonly validTo: string | null;
  readonly components: readonly TaxRuleComponent[];
}

/** Regime e parâmetros da empresa a partir de uma data de início (RF39.R2, R3). */
export interface TaxSettingsPeriod {
  readonly validFrom: string;
  readonly regime: TaxRegime;
  readonly params: Readonly<Record<string, number>>;
}

export interface TaxEstimate {
  readonly regime: TaxRegime;
  readonly month: string;
  readonly totalCents: number;
  readonly components: readonly { readonly label: string; readonly amountCents: number }[];
  readonly disclaimer: typeof TAX_DISCLAIMER;
}

export interface EstimateTaxInput {
  readonly enabled: boolean;
  /** "AAAA-MM". */
  readonly month: string;
  /** Receita bruta do mês, em centavos. */
  readonly revenueCents: number;
  readonly settings: readonly TaxSettingsPeriod[];
  readonly rules: readonly TaxRule[];
}

type TaxError = Extract<
  DomainError,
  { code: "TaxRuleNotFound" | "TaxParamMissing" | "TaxSettingsInvalid" }
>;

/** Último dia do mês "AAAA-MM", como data de negócio. */
function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** `numerator / denominator` arredondado meio-para-cima, só com inteiros. */
function divideHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

const big = (value: number) => BigInt(value);

function applyFormula(
  formula: TaxFormula,
  revenueCents: number,
  params: Readonly<Record<string, number>>,
  context: { regime: TaxRegime; month: string },
): Result<number, TaxError> {
  switch (formula.kind) {
    case "fixed_monthly":
      return ok(formula.amountCents);
    case "percent_of_revenue":
      return ok(divideHalfUp(big(revenueCents) * big(formula.rateBp), 10_000n));
    case "presumed_profit":
      return ok(
        divideHalfUp(
          big(revenueCents) * big(formula.presumptionBp) * big(formula.rateBp),
          100_000_000n,
        ),
      );
    case "revenue_minus_credits": {
      const tax = divideHalfUp(big(revenueCents) * big(formula.rateBp), 10_000n);
      return ok(Math.max(0, tax - (params.creditsCents ?? 0)));
    }
    case "simples_brackets": {
      const rbt12 = params.rbt12Cents;
      if (rbt12 === undefined) return fail("TaxParamMissing", { param: "rbt12Cents" });
      const bracket = formula.brackets.find((candidate) => rbt12 <= candidate.upToCents);
      if (!bracket) return fail("TaxRuleNotFound", context);
      if (rbt12 === 0) {
        return ok(divideHalfUp(big(revenueCents) * big(bracket.nominalBp), 10_000n));
      }
      // Alíquota efetiva = (RBT12 × nominal − parcela a deduzir) / RBT12, aplicada à receita do mês.
      const numerator = big(rbt12) * big(bracket.nominalBp) - big(bracket.deductionCents) * 10_000n;
      if (numerator <= 0n) return ok(0);
      return ok(divideHalfUp(big(revenueCents) * numerator, big(rbt12) * 10_000n));
    }
  }
}

/**
 * Estimativa do mês (RF39). Sem a opção ligada devolve `null` e nada é calculado (R1). Usa o
 * regime e as regras vigentes no último dia do mês, para a troca de regime ou de regra valer da
 * data informada em diante e os meses anteriores ficarem como estavam (R2, R4).
 */
export function estimateTax(input: EstimateTaxInput): Result<TaxEstimate | null, TaxError> {
  if (!input.enabled) return ok(null);

  const closing = lastDayOf(input.month);
  const period = input.settings
    .filter((candidate) => candidate.validFrom <= closing)
    .toSorted((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  if (!period) return ok(null);

  const context = { regime: period.regime, month: input.month };
  const rule = input.rules
    .filter(
      (candidate) =>
        candidate.regime === period.regime &&
        candidate.validFrom <= closing &&
        (candidate.validTo === null || candidate.validTo >= closing),
    )
    .toSorted((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  if (!rule) return fail("TaxRuleNotFound", context);

  const components: { label: string; amountCents: number }[] = [];
  for (const component of rule.components) {
    const amount = applyFormula(component.formula, input.revenueCents, period.params, context);
    if (!amount.ok) return amount;
    components.push({ label: component.label, amountCents: amount.value });
  }
  return ok({
    regime: period.regime,
    month: input.month,
    totalCents: components.reduce((sum, component) => sum + component.amountCents, 0),
    components,
    disclaimer: TAX_DISCLAIMER,
  });
}

/** Ativar exige um dos quatro regimes; "não sei" não permite ativar (RF39.R1, R2). */
export function validateTaxSettings(input: {
  readonly enabled: boolean;
  readonly regime: TaxRegimeChoice | null;
}): Result<true, TaxError> {
  if (!input.enabled) return ok(true);
  const known = (TAX_REGIMES as readonly (string | null)[]).includes(input.regime);
  return known ? ok(true) : fail("TaxSettingsInvalid", { reason: "regime_required" });
}
