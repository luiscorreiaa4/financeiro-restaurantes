import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import type { Actor } from "./permissions";
import { can } from "./permissions";

/**
 * Recorte que toda consulta de lançamentos do painel aplica (RF06.R3, RF06.R5, RF22.R2, RF22.R3).
 * Lançamento fora do recorte não existe para o chamador.
 */
export interface EntryScope {
  /** Unidades consultadas; `"all"` só para quem tem acesso a todas, com o seletor em "todas". */
  readonly unitIds: readonly string[] | "all";
  /** Preenchido = só os lançamentos criados por esse usuário (lançador). */
  readonly ownerUserId: string | null;
  /** Lançamentos de categoria sensível (folha) entram na consulta. */
  readonly includeSensitive: boolean;
}

export interface EntryScopeInput {
  readonly actor: Actor;
  readonly userId: string;
  /** Unidade do seletor do topo; `"all"` = todas as unidades de acesso. */
  readonly activeUnitId: string | "all";
  /** Filtro de unidade da consulta; prevalece sobre o seletor. Vazio = sem filtro. */
  readonly requestedUnitIds?: readonly string[];
}

/**
 * Decide o que o ator enxerga. Tudo sai de `can`: a matriz da seção 2.3 de requisitos.md
 * mora só em `permissions.ts`.
 */
export function entryScopeFor(input: EntryScopeInput): Result<EntryScope, DomainError> {
  const { actor, userId, activeUnitId, requestedUnitIds } = input;
  const denied = () => fail("PermissionDenied", { role: actor.role, action: "entry:view" });

  // O melhor caso (lançamento próprio, não sensível): se nem esse o ator vê, não há recorte.
  const canViewIn = (unitId?: string) => can(actor, "entry:view", { unitId, isOwnEntry: true });
  if (!canViewIn()) return denied();

  let unitIds: EntryScope["unitIds"];
  if (requestedUnitIds !== undefined && requestedUnitIds.length > 0) {
    unitIds = requestedUnitIds;
  } else if (activeUnitId !== "all") {
    unitIds = [activeUnitId];
  } else {
    unitIds = actor.units;
  }
  // Uma unidade fora do acesso derruba o pedido inteiro (RF06.R5); nunca é só descartada.
  if (unitIds !== "all" && !unitIds.every((unitId) => canViewIn(unitId))) return denied();

  return ok({
    unitIds,
    ownerUserId: can(actor, "entry:view", { isOwnEntry: false }) ? null : userId,
    includeSensitive: can(actor, "entry:view", { categoryIsSensitive: true, isOwnEntry: true }),
  });
}

export interface EntryActions {
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canRestore: boolean;
}

/**
 * O que o ator pode fazer com um lançamento já carregado. Na lixeira só cabe restaurar;
 * fora dela, editar e excluir.
 */
export function entryActions(
  actor: Actor,
  entry: {
    readonly unitId: string;
    readonly createdBy: string;
    readonly categoryIsSensitive: boolean;
    readonly deleted: boolean;
  },
  userId: string,
): EntryActions {
  const context = {
    unitId: entry.unitId,
    isOwnEntry: entry.createdBy === userId,
    categoryIsSensitive: entry.categoryIsSensitive,
  };
  return {
    canEdit: !entry.deleted && can(actor, "entry:edit", context),
    canDelete: !entry.deleted && can(actor, "entry:delete", context),
    canRestore: entry.deleted && can(actor, "entry:restore", context),
  };
}
