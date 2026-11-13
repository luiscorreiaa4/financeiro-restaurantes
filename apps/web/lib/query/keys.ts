/**
 * Fábrica das chaves de dado de tenant (RNF02.R6): empresa e unidade entram sempre, então
 * trocar de empresa ou de unidade nunca reaproveita o cache da anterior. Chave de dado de
 * tenant sem esta fábrica é proibida (apps/web/CLAUDE.md, regra 6).
 */
export function tenantKey(
  ctx: { tenantId: string; unitId: string },
  ...parts: readonly unknown[]
): readonly unknown[] {
  return ["t", ctx.tenantId, ctx.unitId, ...parts];
}
