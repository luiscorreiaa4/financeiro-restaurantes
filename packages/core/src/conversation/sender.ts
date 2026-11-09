import type { Actor, AdditionalPermission, MembershipStatus, Role } from "../permissions";
import type { CatalogStatus } from "../registry/catalog-types";
import { matchCitedPlace } from "./cited-place";

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
  /** Unidades do restaurante com nome e apelidos, para o casamento da unidade citada (DE-25). */
  readonly tenantUnits: readonly {
    readonly id: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly status: CatalogStatus;
  }[];
  /** Quando a pessoa escolheu este restaurante com `trocar empresa`; nulo se nunca escolheu. */
  readonly preferredAt: Date | null;
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
      /** Unidade citada no texto que levou a mensagem a esta empresa ou unidade; nula se não houve. */
      readonly citedUnitId: string | null;
      /** Vínculos ativos do telefone, na ordem de escolha (para `trocar empresa`). */
      readonly activeMemberships: readonly SenderMembership[];
    };

/**
 * Escolhe o vínculo da mensagem entre os que o telefone tem. Vínculos desativados não contam:
 * quem só tem desativados é tratado como desconhecido, para não revelar que o cadastro existe.
 * O mesmo vale para o vínculo de contador, que não usa o WhatsApp (DD-03, DE-26).
 * Com mais de um restaurante ativo vale, nesta ordem: o restaurante citado no texto (RF11.R5), o
 * escolhido por último com `trocar empresa` e o vínculo mais antigo (DE-07, desempate pelo id,
 * que é ordenado no tempo).
 */
export function resolveSender(
  memberships: readonly SenderMembership[],
  options: { readonly text?: string | null } = {},
): SenderResolution {
  const active = memberships
    .filter(
      (membership) =>
        membership.status !== "deactivated" &&
        membership.deactivatedAt === null &&
        // O contador entra só pelo painel (DD-03); o canal o trata como número desconhecido (DE-26).
        membership.role !== "accountant",
    )
    .toSorted(
      (a, b) =>
        (b.preferredAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
          (a.preferredAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.membershipId.localeCompare(b.membershipId),
    );
  const first = active[0];
  if (first === undefined) return { kind: "unknown" };
  const tenantCount = new Set(active.map((membership) => membership.tenantId)).size;
  const cited =
    tenantCount > 1 && options.text ? matchCitedPlace(options.text, active, first) : null;
  const sender = cited?.membership ?? first;
  const citedUnitId =
    cited?.unitId != null && accessibleUnitIds(sender).includes(cited.unitId) ? cited.unitId : null;
  return {
    kind: "known",
    sender,
    defaultUnitId: citedUnitId ?? defaultUnitId(sender),
    tenantCount,
    citedUnitId,
    activeMemberships: active,
  };
}

/** Unidades em que o colaborador pode lançar e consultar (RF05.R5). */
export function accessibleUnitIds(membership: SenderMembership): readonly string[] {
  return membership.allUnits ? membership.tenantUnitIds : membership.unitIds;
}

/** Unidade padrão só vale se estiver entre as de acesso (DE-25); senão, a única acessível. */
function defaultUnitId(membership: SenderMembership): string | null {
  const accessible = accessibleUnitIds(membership);
  if (membership.defaultUnitId !== null && accessible.includes(membership.defaultUnitId)) {
    return membership.defaultUnitId;
  }
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
