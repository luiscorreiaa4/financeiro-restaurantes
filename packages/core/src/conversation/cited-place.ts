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

interface Hit<T> {
  readonly membership: T;
  readonly unitIds: string[];
  /** Termos (já normalizados) que apareceram no texto. */
  readonly terms: string[];
}

/** O termo `inner` aparece inteiro dentro de `outer` (ex.: "restaurante demo" em "restaurante demo 2"). */
const isInside = (inner: string, outer: string): boolean =>
  inner !== outer && ` ${outer} `.includes(` ${inner} `);

/**
 * Empresa ou unidade citada no texto (RF11.R5, DE-25), sem IA. Procura o nome da empresa e o
 * nome ou apelido das unidades **ativas e de acesso** de cada empresa, como palavra inteira.
 * Só devolve algo quando o texto aponta para exatamente uma empresa; se aponta para mais de
 * uma, ou para nenhuma, devolve `null` e vale a empresa padrão. Um nome que só aparece por
 * estar dentro do nome mais longo de outra empresa ("Demo" em "Demo 2") não conta.
 * `current` é o candidato que já valeria sem a citação, usado só para escolher o vínculo de
 * cada empresa.
 */
export function matchCitedPlace<T extends CitedPlaceCandidate>(
  text: string,
  candidates: readonly T[],
  current: T,
): CitedPlace<T> | null {
  const padded = ` ${words(text)} `;
  const found = (term: string): string | null => {
    const normalized = words(term);
    return normalized !== "" && padded.includes(` ${normalized} `) ? normalized : null;
  };

  const byTenant = new Map<string, T>();
  for (const candidate of [current, ...candidates]) {
    if (!byTenant.has(candidate.tenantId)) byTenant.set(candidate.tenantId, candidate);
  }

  const hits: Hit<T>[] = [];
  for (const membership of byTenant.values()) {
    const terms: string[] = [];
    const unitIds: string[] = [];
    for (const unit of membership.tenantUnits) {
      if (unit.status !== "active") continue;
      if (!membership.allUnits && !membership.unitIds.includes(unit.id)) continue;
      const matched = [unit.name, ...unit.aliases].map(found).filter((t) => t !== null);
      if (matched.length === 0) continue;
      unitIds.push(unit.id);
      terms.push(...matched);
    }
    const tenantTerm = found(membership.tenantName);
    if (tenantTerm !== null) terms.push(tenantTerm);
    if (terms.length > 0) hits.push({ membership, unitIds, terms });
  }

  const standing = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          hit.terms.every((term) => other.terms.some((longer) => isInside(term, longer))),
      ),
  );
  const [hit] = standing;
  if (standing.length !== 1 || hit === undefined) return null;
  return {
    membership: hit.membership,
    unitId: hit.unitIds.length === 1 ? (hit.unitIds[0] ?? null) : null,
  };
}
