import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import type { Actor } from "./permissions";
import { can } from "./permissions";

/** Recorte das consultas do dashboard (RF27.R5, RF06.R5). */
export interface ReportScope {
  /** Unidades consultadas; `"all"` só para quem tem acesso a todas, com o seletor em "todas". */
  readonly unitIds: readonly string[] | "all";
  /** O ator vê a folha: só ele recebe o indicador de folha e o nome das categorias sensíveis. */
  readonly canSeePayroll: boolean;
}

export interface ReportScopeInput {
  readonly actor: Actor;
  /** Unidade do seletor do topo; `"all"` = todas as unidades de acesso. */
  readonly activeUnitId: string | "all";
  /** Filtro de unidade da consulta; prevalece sobre o seletor. Vazio = sem filtro. */
  readonly requestedUnitIds?: readonly string[];
}

/** Mesma resolução de unidades de `entryScopeFor`, com a permissão `report:view`. */
export function reportScopeFor(input: ReportScopeInput): Result<ReportScope, DomainError> {
  const { actor, activeUnitId, requestedUnitIds } = input;
  const denied = () => fail("PermissionDenied", { role: actor.role, action: "report:view" });

  if (!can(actor, "report:view")) return denied();

  let unitIds: ReportScope["unitIds"];
  if (requestedUnitIds !== undefined && requestedUnitIds.length > 0) {
    unitIds = requestedUnitIds;
  } else if (activeUnitId !== "all") {
    unitIds = [activeUnitId];
  } else {
    unitIds = actor.units;
  }
  // Ator sem nenhuma unidade não vê nada: lista vazia nunca pode virar "sem filtro" no banco.
  if (unitIds !== "all" && unitIds.length === 0) return denied();
  // Uma unidade fora do acesso derruba o pedido inteiro; nunca é só descartada.
  if (unitIds !== "all" && !unitIds.every((unitId) => can(actor, "report:view", { unitId }))) {
    return denied();
  }

  return ok({
    unitIds,
    canSeePayroll: can(actor, "entry:view", { categoryIsSensitive: true, isOwnEntry: true }),
  });
}
