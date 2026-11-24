import { normalizeName } from "../entry/catalog";
import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { NOT_INFORMED_PAYMENT_METHOD, NOT_INFORMED_SALES_CHANNEL } from "./catalog-types";

/** Linha de cadastro da empresa usada para conferir colisão de nome e apelido. */
export interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export function validateCatalogName(
  value: string,
  bounds: { min: number; max: number },
): Result<string, DomainError> {
  const name = value.trim();
  if (name.length < bounds.min || name.length > bounds.max) {
    return fail("InvalidName", { min: bounds.min, max: bounds.max });
  }
  return ok(name);
}

/** Apara, descarta vazio e deduplica pelo nome normalizado (mantém a primeira grafia). */
export function validateAliases(
  values: readonly string[],
  bounds: { max: number; maxLength: number },
): Result<string[], DomainError> {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const raw of values) {
    const alias = raw.trim();
    if (alias === "") continue;
    if (alias.length > bounds.maxLength)
      return fail("AliasTooLong", { maxLength: bounds.maxLength });
    const key = normalizeName(alias);
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  if (aliases.length > bounds.max) return fail("AliasesTooMany", { max: bounds.max });
  return ok(aliases);
}

/**
 * Id do primeiro cadastro existente cujo nome ou apelido coincide (sem caixa nem acento) com
 * o nome ou os apelidos do candidato; `null` se não há colisão. O próprio id é ignorado.
 */
export function findNameCollision(
  candidate: { id?: string; name: string; aliases: readonly string[] },
  existing: readonly CatalogRow[],
): string | null {
  const keys = new Set([candidate.name, ...candidate.aliases].map(normalizeName));
  for (const row of existing) {
    if (candidate.id !== undefined && row.id === candidate.id) continue;
    if ([row.name, ...row.aliases].some((value) => keys.has(normalizeName(value)))) return row.id;
  }
  return null;
}

/** "Não informada" e "Não informado" são cadastros do sistema, somente leitura (DD-43). */
export function isProtectedCatalogName(
  kind: "payment_method" | "sales_channel",
  name: string,
): boolean {
  const protectedName =
    kind === "payment_method" ? NOT_INFORMED_PAYMENT_METHOD : NOT_INFORMED_SALES_CHANNEL;
  return normalizeName(name) === normalizeName(protectedName);
}
