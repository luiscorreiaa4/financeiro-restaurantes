import type { Actor, AdditionalPermission, MembershipStatus, Role } from "../permissions";

/** Vínculo de um telefone com um restaurante, como o cadastro o guarda. */
export interface SenderMembership {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly userId: string;
  readonly userName: string;
  readonly role: Role;
  /** Convidado, ativo ou desativado (RF05.R8). Desativado é tratado como número desconhecido. */
  readonly status: MembershipStatus;
  /** TODAS as unidades do restaurante, inclusive as criadas depois (RF05.R5). */
  readonly allUnits: boolean;
  /** Unidades de acesso quando não são TODAS. */
  readonly unitIds: readonly string[];
  /** Unidade padrão do vínculo (RF05.R6); nula quando o vínculo vale para todas e não escolheu. */
  readonly defaultUnitId: string | null;
  readonly permissions: readonly AdditionalPermission[];
  /** O Dono liberou o painel (RF05.R3). */
  readonly panelAccess: boolean;
  /** Unidades do restaurante, para achar a padrão quando o vínculo vale para todas. */
  readonly tenantUnitIds: readonly string[];
  readonly createdAt: Date;
  /** Preenchido = acesso retirado. O vínculo continua no banco (nada é apagado). */
  readonly deactivatedAt: Date | null;
}

export type SenderResolution =
  | { readonly kind: "unknown" }
  | {
      readonly kind: "known";
      readonly sender: SenderMembership;
      /** Unidade em que os lançamentos caem quando o usuário não diz qual; nula se ambígua. */
      readonly defaultUnitId: string | null;
      /** Em quantos restaurantes ativos o telefone está (> 1 pede o nome do restaurante na resposta). */
      readonly tenantCount: number;
    };

/**
 * Escolhe o vínculo da mensagem entre os que o telefone tem. Vínculos desativados não contam:
 * quem só tem desativados é tratado como desconhecido, para não revelar que o cadastro existe.
 * Com mais de um restaurante ativo vale o vínculo mais antigo (desempate pelo id, que é
 * ordenado no tempo).
 */
export function resolveSender(memberships: readonly SenderMembership[]): SenderResolution {
  const active = memberships
    .filter(
      (membership) => membership.status !== "deactivated" && membership.deactivatedAt === null,
    )
    .toSorted(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.membershipId.localeCompare(b.membershipId),
    );
  const sender = active[0];
  if (sender === undefined) return { kind: "unknown" };
  return {
    kind: "known",
    sender,
    defaultUnitId: defaultUnitId(sender),
    tenantCount: new Set(active.map((membership) => membership.tenantId)).size,
  };
}

/** Unidades em que o colaborador pode lançar e consultar (RF05.R5). */
export function accessibleUnitIds(membership: SenderMembership): readonly string[] {
  return membership.allUnits ? membership.tenantUnitIds : membership.unitIds;
}

function defaultUnitId(membership: SenderMembership): string | null {
  if (membership.defaultUnitId !== null) return membership.defaultUnitId;
  const accessible = accessibleUnitIds(membership);
  return accessible.length === 1 ? (accessible[0] ?? null) : null;
}

/** O ator para `can()`: papel, permissões adicionais e unidades de acesso do vínculo. */
export function senderToActor(sender: SenderMembership): Actor {
  return {
    role: sender.role,
    permissions: sender.permissions,
    units: sender.allUnits ? "all" : sender.unitIds,
    panelAccess: sender.panelAccess,
  };
}
