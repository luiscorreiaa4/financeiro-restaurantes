import { normalizeName } from "../entry/catalog";
import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { findNameCollision, validateAliases, validateCatalogName } from "./names";
import { isValidCnpj } from "./unit";

const NAME_MIN = 2;
const NAME_MAX = 120;
const ALIASES_MAX = 10;
const ALIAS_MAX_LENGTH = 120;

export interface Supplier {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  /** CPF ou CNPJ, só dígitos. */
  readonly document: string | null;
  readonly status: "active" | "inactive";
  readonly mergedIntoId: string | null;
}

export interface SupplierPatch {
  readonly name?: string;
  readonly aliases?: readonly string[];
  /** Texto digitado (com ou sem máscara); nulo limpa. */
  readonly document?: string | null;
  readonly status?: "active" | "inactive";
}

export interface ValidSupplierPatch {
  name?: string;
  aliases?: string[];
  document?: string | null;
  status?: "active" | "inactive";
}

/** CPF pelos dois dígitos verificadores (módulo 11); sequência repetida é recusada. */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** Documento do fornecedor: 11 dígitos é CPF, 14 é CNPJ; só entram os válidos (RF10.R2). */
export function normalizeDocument(
  text: string,
): Result<{ kind: "cpf" | "cnpj"; digits: string }, DomainError> {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11 && isValidCpf(digits)) return ok({ kind: "cpf", digits });
  if (digits.length === 14 && isValidCnpj(digits)) return ok({ kind: "cnpj", digits });
  return fail("InvalidDocument");
}

/** CPF é dado pessoal: "•••.•••.789-01" (RF10.R2). */
export function maskCpf(digits: string): string {
  return `•••.•••.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

/** Edição de fornecedor (RF10): nome 2–120, até 10 apelidos, documento válido e único. */
export function validateSupplierPatch(
  current: Supplier,
  patch: SupplierPatch,
  others: readonly Supplier[],
): Result<ValidSupplierPatch, DomainError> {
  if (current.mergedIntoId !== null) return fail("AlreadyMerged");
  const out: ValidSupplierPatch = {};

  if (patch.name !== undefined) {
    const name = validateCatalogName(patch.name, { min: NAME_MIN, max: NAME_MAX });
    if (!name.ok) return name;
    out.name = name.value;
  }
  if (patch.aliases !== undefined) {
    const aliases = validateAliases(patch.aliases, {
      max: ALIASES_MAX,
      maxLength: ALIAS_MAX_LENGTH,
    });
    if (!aliases.ok) return aliases;
    out.aliases = aliases.value;
  }
  if (out.name !== undefined || out.aliases !== undefined) {
    const conflictId = findNameCollision(
      { id: current.id, name: out.name ?? current.name, aliases: out.aliases ?? current.aliases },
      others.filter((other) => other.mergedIntoId === null),
    );
    if (conflictId !== null) return fail("NameTaken", { conflictId });
  }
  if (patch.document !== undefined) {
    if (patch.document === null || patch.document.trim() === "") {
      out.document = null;
    } else {
      const doc = normalizeDocument(patch.document);
      if (!doc.ok) return doc;
      const taken = others.find(
        (o) => o.id !== current.id && o.mergedIntoId === null && o.document === doc.value.digits,
      );
      if (taken !== undefined) return fail("DocumentTaken", { conflictId: taken.id });
      out.document = doc.value.digits;
    }
  }
  if (patch.status !== undefined) out.status = patch.status;
  return ok(out);
}

/**
 * Plano da mesclagem (RF10): o destino ganha o nome e os apelidos da origem (sem repetir, no
 * máximo 10) e o documento da origem se não tem; a origem fica inativa apontando para o destino.
 */
export function planSupplierMerge(
  source: Supplier,
  target: Supplier,
): Result<
  {
    target: { aliases: string[]; document: string | null };
    source: { status: "inactive"; mergedIntoId: string };
  },
  DomainError
> {
  if (source.id === target.id) return fail("SameSupplier");
  if (source.mergedIntoId !== null || target.mergedIntoId !== null) return fail("AlreadyMerged");
  if (source.document !== null && target.document !== null && source.document !== target.document) {
    return fail("DocumentConflict");
  }

  const seen = new Set([normalizeName(target.name)]);
  const aliases: string[] = [];
  for (const raw of [...target.aliases, source.name, ...source.aliases]) {
    const alias = raw.trim();
    const key = normalizeName(alias);
    if (alias === "" || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  if (aliases.length > ALIASES_MAX) return fail("AliasesOverflow", { max: ALIASES_MAX });

  return ok({
    target: { aliases, document: target.document ?? source.document },
    source: { status: "inactive", mergedIntoId: target.id },
  });
}
