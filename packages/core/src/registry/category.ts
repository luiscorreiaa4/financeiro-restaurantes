import { normalizeName } from "../entry/catalog";
import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

export const CATEGORY_ORIGINS = ["system", "company"] as const;
export type CategoryOrigin = (typeof CATEGORY_ORIGINS)[number];
export const CATEGORY_STATUSES = ["active", "inactive"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

const NAME_MIN = 2;
const NAME_MAX = 60;
const SUPPORT_WORDS_MAX = 30;
const SUPPORT_WORD_MAX_LENGTH = 40;

export interface CategoryRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly origin: CategoryOrigin;
  readonly name: string;
  readonly kind: "revenue" | "expense" | "investment" | "deduction";
  readonly nature: "fixed" | "variable" | null;
  readonly dreGroup: string;
  readonly isSensitive: boolean;
  readonly requiresQuantity: boolean;
  readonly status: CategoryStatus;
}

export interface NewSubcategoryInput {
  readonly name: string;
  readonly parent: CategoryRecord;
  /** Subcategorias já existentes sob o mesmo pai. */
  readonly siblings: readonly Pick<CategoryRecord, "name">[];
  /** Troca a natureza herdada (só despesa); nulo mantém a do pai. */
  readonly nature: "fixed" | "variable" | null;
  readonly isSensitive: boolean;
  readonly supportWords: readonly string[];
}

export interface NewSubcategory {
  readonly name: string;
  readonly parentId: string;
  readonly kind: CategoryRecord["kind"];
  readonly nature: CategoryRecord["nature"];
  readonly dreGroup: string;
  readonly isSensitive: boolean;
  readonly requiresQuantity: boolean;
  readonly supportWords: readonly string[];
  readonly origin: "company";
  readonly status: "active";
}

type InvalidCategory = Extract<DomainError, { code: "InvalidCategory" }>;
const invalid = (field: InvalidCategory["field"], reason: InvalidCategory["reason"]) =>
  fail("InvalidCategory", { field, reason });

/**
 * Cria a subcategoria da empresa (RF07.R1 a R8): sempre filha de uma categoria padrão, no máximo
 * dois níveis, herda tipo, grupo do DRE, sensível e exige quantidade do pai. A natureza vem do
 * pai, mas a subcategoria pode trocá-la (só despesa). Sensível não se desmarca.
 */
export function validateSubcategory(
  input: NewSubcategoryInput,
): Result<NewSubcategory, DomainError> {
  const { parent } = input;
  if (parent.parentId !== null) return invalid("parent", "too_deep");
  if (parent.origin !== "system") return invalid("parent", "not_system");
  if (parent.status !== "active") return invalid("parent", "inactive");

  const name = input.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return invalid("name", "invalid");
  const key = normalizeName(name);
  if (input.siblings.some((sibling) => normalizeName(sibling.name) === key)) {
    return invalid("name", "duplicate");
  }

  if (input.nature !== null && parent.kind !== "expense") return invalid("nature", "invalid");

  if (input.supportWords.length > SUPPORT_WORDS_MAX) return invalid("supportWords", "too_many");
  const supportWords = input.supportWords.map((word) => word.trim());
  if (supportWords.some((word) => word === "" || word.length > SUPPORT_WORD_MAX_LENGTH)) {
    return invalid("supportWords", "invalid");
  }

  return ok({
    name,
    parentId: parent.id,
    kind: parent.kind,
    nature: input.nature ?? parent.nature,
    dreGroup: parent.dreGroup,
    isSensitive: parent.isSensitive || input.isSensitive,
    requiresQuantity: parent.requiresQuantity,
    supportWords,
    origin: "company",
    status: "active",
  });
}

export interface SubcategoryPatch {
  readonly name?: string;
  /** Presente só para ser recusado: o pai não muda (RF07.R2). */
  readonly parentId?: string | null;
  readonly nature?: "fixed" | "variable" | null;
  readonly isSensitive?: boolean;
  readonly supportWords?: readonly string[];
  readonly status?: CategoryStatus;
}

export type ValidSubcategoryPatch = Omit<SubcategoryPatch, "parentId">;

/**
 * Valida a edição de uma subcategoria da empresa (RF07). Categoria do sistema é somente leitura,
 * o pai não troca, natureza só em despesa, nome único entre irmãs (a própria é ignorada) e
 * sensível não se desmarca (RF07.CA03; falha fechado, também fora de pai sensível).
 */
export function validateSubcategoryPatch(
  current: CategoryRecord,
  patch: SubcategoryPatch,
  siblings: readonly Pick<CategoryRecord, "id" | "name">[],
): Result<ValidSubcategoryPatch, DomainError> {
  if (current.origin === "system") return fail("SystemCategoryReadOnly");
  if (patch.parentId !== undefined && patch.parentId !== current.parentId) {
    return fail("ParentChangeForbidden");
  }
  const out: { -readonly [K in keyof ValidSubcategoryPatch]: ValidSubcategoryPatch[K] } = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < NAME_MIN || name.length > NAME_MAX) return invalid("name", "invalid");
    const key = normalizeName(name);
    if (siblings.some((s) => s.id !== current.id && normalizeName(s.name) === key)) {
      return invalid("name", "duplicate");
    }
    out.name = name;
  }
  if (patch.nature !== undefined) {
    if (patch.nature !== null && current.kind !== "expense") return fail("NatureOnlyForExpense");
    out.nature = patch.nature;
  }
  if (patch.isSensitive !== undefined) {
    if (current.isSensitive && !patch.isSensitive) return fail("SensitiveLocked");
    out.isSensitive = patch.isSensitive;
  }
  if (patch.supportWords !== undefined) {
    if (patch.supportWords.length > SUPPORT_WORDS_MAX) return invalid("supportWords", "too_many");
    const words = patch.supportWords.map((word) => word.trim());
    if (words.some((word) => word === "" || word.length > SUPPORT_WORD_MAX_LENGTH)) {
      return invalid("supportWords", "invalid");
    }
    out.supportWords = words;
  }
  if (patch.status !== undefined) out.status = patch.status;
  return ok(out);
}
