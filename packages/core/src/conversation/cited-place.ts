import { normalizeName } from "../entry/catalog";
import type { CatalogStatus } from "../registry/catalog-types";

/** O que o casamento precisa saber de um vínculo (subconjunto de `SenderMembership`). */
export interface CitedPlaceCandidate {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly allUnits: boolean;
  readonly unitIds: readonly string[];
  readonly tenantUnits: readonly {
    readonly id: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly status: CatalogStatus;
  }[];
}

export interface CitedPlace<T extends CitedPlaceCandidate> {
  readonly membership: T;
  /** Unidade citada, quando o texto aponta para uma só unidade da empresa. */
  readonly unitId: string | null;
}

/** Palavras separadas por um espaço, sem acento, caixa nem pontuação. */
const words = (value: string): string =>
  normalizeName(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const mentions = (paddedText: string, term: string): boolean => {
  const normalized = words(term);
  return normalized !== "" && paddedText.includes(` ${normalized} `);
};

/**
 * Empresa ou unidade citada no texto (RF11.R5, DE-25), sem IA. Procura o nome da empresa e o
 * nome ou apelido das unidades **ativas e de acesso** de cada empresa, como palavra inteira.
 * Só devolve algo quando o texto aponta para exatamente uma empresa; se aponta para mais de
 * uma, ou para nenhuma, devolve `null` e vale a empresa padrão. `current` é o candidato que
 * já valeria sem a citação, usado só para escolher o vínculo de cada empresa.
 */
export function matchCitedPlace<T extends CitedPlaceCandidate>(
  text: string,
  candidates: readonly T[],
  current: T,
): CitedPlace<T> | null {
  const padded = ` ${words(text)} `;
  const hits: { membership: T; unitIds: string[] }[] = [];

  const byTenant = new Map<string, T>();
  for (const candidate of [current, ...candidates]) {
    if (!byTenant.has(candidate.tenantId)) byTenant.set(candidate.tenantId, candidate);
  }

  for (const membership of byTenant.values()) {
    const unitIds = membership.tenantUnits
      .filter((unit) => unit.status === "active")
      .filter((unit) => membership.allUnits || membership.unitIds.includes(unit.id))
      .filter((unit) => [unit.name, ...unit.aliases].some((term) => mentions(padded, term)))
      .map((unit) => unit.id);
    const namesTenant = mentions(padded, membership.tenantName);
    if (unitIds.length > 0 || namesTenant) hits.push({ membership, unitIds });
  }

  if (hits.length !== 1) return null;
  const [hit] = hits;
  if (hit === undefined) return null;
  return {
    membership: hit.membership,
    unitId: hit.unitIds.length === 1 ? (hit.unitIds[0] ?? null) : null,
  };
}
