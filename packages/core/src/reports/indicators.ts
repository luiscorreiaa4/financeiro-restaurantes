// Contas dos indicadores do dashboard (F4, RF27.R3-R8, DD-38).
// Dinheiro em centavos inteiros; percentual em décimos de ponto percentual (permille).
// Contas intermediárias em BigInt, arredondamento meio para longe do zero (RNF13).

export interface PeriodSums {
  grossRevenueCents: number;
  revenueWithOrdersCents: number;
  ordersCount: number;
  feesCents: number;
  deductionExpensesCents: number;
  operatingExpensesCents: number;
  cmvCents: number;
  payrollCents: number;
  fixedCostsCents: number;
  investmentsCents: number;
  entryCount: number;
}

export interface PeriodIndicators {
  grossRevenueCents: number;
  deductionsCents: number;
  netRevenueCents: number;
  operatingExpensesCents: number;
  resultCents: number;
  investmentsCents: number;
  marginPermille: number | null;
  cmvRatioPermille: number | null;
  payrollRatioPermille: number | null;
  averageTicketCents: number | null;
  ticketCoveragePermille: number | null;
  breakEvenCents: number | null;
}

export type Direction = "up" | "down" | "flat";
export interface Change {
  changePermille: number | null;
  direction: Direction | null;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeNumber(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new RangeError("Resultado fora do intervalo de inteiros seguros");
  }
  return Number(value);
}

/** Divisão inteira, meio para longe do zero. Denominador deve ser > 0. */
function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  let q = abs / denominator;
  if ((abs % denominator) * 2n >= denominator) q += 1n;
  return negative ? -q : q;
}

/** round_half_away(numerator*1000/denominator); denominator <= 0 → null. BigInt por dentro. */
export function ratioPermille(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return toSafeNumber(divRoundHalfAwayFromZero(BigInt(numerator) * 1000n, BigInt(denominator)));
}

export function averageTicketCents(
  revenueWithOrdersCents: number,
  ordersCount: number,
): number | null {
  if (ordersCount <= 0) return null;
  return toSafeNumber(
    divRoundHalfAwayFromZero(BigInt(revenueWithOrdersCents), BigInt(ordersCount)),
  );
}

/** fixed*gross/(gross-variable), meio para cima; gross<=0 ou gross-variable<=0 → null. */
export function breakEvenCents(
  fixedCents: number,
  variableCents: number,
  grossCents: number,
): number | null {
  if (grossCents <= 0) return null;
  const contribution = BigInt(grossCents) - BigInt(variableCents);
  if (contribution <= 0n) return null;
  // floor((2*num + den) / (2*den)) = meio para cima
  const num2 = BigInt(fixedCents) * BigInt(grossCents) * 2n + contribution;
  const den2 = contribution * 2n;
  // fixed >= 0 e contribution > 0, então o quociente inteiro já é o piso.
  return toSafeNumber(num2 / den2);
}

export function computeIndicators(sums: PeriodSums): PeriodIndicators {
  const gross = sums.grossRevenueCents;
  const deductions = sums.feesCents + sums.deductionExpensesCents;
  const net = gross - deductions;
  // Investimento fica fora do resultado (R3, CA03).
  const result = gross - deductions - sums.operatingExpensesCents;
  const variable = sums.operatingExpensesCents - sums.fixedCostsCents + deductions;
  return {
    grossRevenueCents: gross,
    deductionsCents: deductions,
    netRevenueCents: net,
    operatingExpensesCents: sums.operatingExpensesCents,
    resultCents: result,
    investmentsCents: sums.investmentsCents,
    marginPermille: ratioPermille(result, gross),
    cmvRatioPermille: ratioPermille(sums.cmvCents, gross),
    payrollRatioPermille: ratioPermille(sums.payrollCents, gross),
    averageTicketCents: averageTicketCents(sums.revenueWithOrdersCents, sums.ordersCount),
    ticketCoveragePermille: ratioPermille(sums.revenueWithOrdersCents, gross),
    breakEvenCents: breakEvenCents(sums.fixedCostsCents, variable, gross),
  };
}

/** "money": ratioPermille(cur-prev, |prev|); "permille": cur-prev. null se algum lado é null ou (money) prev = 0. */
export function changeOf(
  current: number | null,
  previous: number | null,
  unit: "money" | "permille",
): Change {
  if (current === null || previous === null) return { changePermille: null, direction: null };
  const diff = current - previous;
  const direction: Direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const changePermille = unit === "permille" ? diff : ratioPermille(diff, Math.abs(previous));
  return { changePermille, direction };
}

export const DRE_GROUP_LABELS: Readonly<Record<string, string>> = {
  cmv: "CMV",
  pessoal: "Pessoal",
  ocupacao: "Ocupação",
  utilidades: "Utilidades",
  marketing: "Marketing",
  manutencao: "Manutenção",
  impostos: "Impostos",
  outras: "Outras despesas",
  operacionais: "Operacionais",
  financeiras: "Financeiras",
};

export function dreGroupLabel(group: string): string {
  return Object.hasOwn(DRE_GROUP_LABELS, group) ? (DRE_GROUP_LABELS[group] as string) : "Outros";
}
