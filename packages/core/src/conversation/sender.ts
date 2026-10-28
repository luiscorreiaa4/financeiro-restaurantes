import type { Role } from "../permissions";

/** Vínculo de um telefone com um restaurante, como o cadastro o guarda. */
export interface SenderMembership {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly userId: string;
  readonly userName: string;
  readonly role: Role;
  /** Nulo = todas as unidades do restaurante. */
  readonly unitId: string | null;
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
    .filter((membership) => membership.deactivatedAt === null)
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

function defaultUnitId(membership: SenderMembership): string | null {
  if (membership.unitId !== null) return membership.unitId;
  return membership.tenantUnitIds.length === 1 ? (membership.tenantUnitIds[0] ?? null) : null;
}
