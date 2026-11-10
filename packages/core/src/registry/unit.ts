import { normalizeName } from "../entry/catalog";
import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { findOfficialCity } from "./municipalities";

export const UNIT_STATUSES = ["active", "inactive"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const BRAZILIAN_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

const NAME_MIN = 2;
const NAME_MAX = 60;
const ALIASES_MAX = 5;
const ALIAS_MAX_LENGTH = 30;

/** Outra unidade da empresa (a que está sendo editada não entra em `others`). */
export interface UnitRecord {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly status: UnitStatus;
}

export interface UnitInput {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly cnpj: string | null;
  readonly city: string;
  readonly uf: string;
  /** Municípios oficiais da UF (DD-29). Sem a lista, o município só precisa estar preenchido. */
  readonly cities?: readonly string[];
  readonly others: readonly UnitRecord[];
}

export interface ValidUnit {
  readonly name: string;
  readonly aliases: readonly string[];
  /** Só dígitos, ou nulo. */
  readonly cnpj: string | null;
  readonly city: string;
  readonly uf: string;
}

type InvalidUnit = Extract<DomainError, { code: "InvalidUnit" }>;

const invalid = (field: InvalidUnit["field"], reason: InvalidUnit["reason"]) =>
  fail("InvalidUnit", { field, reason });

/** Tira pontuação e espaços e põe em maiúsculas: "12.abc.345/01de-35" vira "12ABC34501DE35". */
export function normalizeCnpj(value: string): string {
  return value.replace(/[.\-/\s]/g, "").toUpperCase();
}

/** Formata 14 posições como AA.AAA.AAA/AAAA-DD; qualquer outro tamanho volta como veio. */
export function formatCnpj(value: string): string {
  const raw = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(raw)) return value;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
}

/**
 * CNPJ numérico ou alfanumérico (IN RFB 2.229/2024): 12 posições de 0-9 e A-Z mais 2 dígitos
 * verificadores numéricos. Módulo 11, valor do caractere = código ASCII - 48. Sequência repetida é recusada.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return false;
  const check = (length: number): number => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += (cnpj.charCodeAt(i) - 48) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
}

/** Confere os dados da unidade (RF04.R1 a R3 e município/UF) antes de gravar. */
export function validateUnit(input: UnitInput): Result<ValidUnit, DomainError> {
  const name = input.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return invalid("name", "invalid");
  const key = normalizeName(name);
  if (input.others.some((other) => normalizeName(other.name) === key)) {
    return invalid("name", "duplicate");
  }

  if (input.aliases.length > ALIASES_MAX) return invalid("aliases", "too_many");
  const aliases = input.aliases.map((alias) => alias.trim());
  if (aliases.some((alias) => alias === "" || alias.length > ALIAS_MAX_LENGTH)) {
    return invalid("aliases", "invalid");
  }
  const aliasKeys = aliases.map(normalizeName);
  if (new Set(aliasKeys).size !== aliasKeys.length) return invalid("aliases", "duplicate");
  // Apelido não pode coincidir com apelido nem com nome de outra unidade (a IA se confundiria).
  const taken = new Set(input.others.flatMap((o) => [o.name, ...o.aliases]).map(normalizeName));
  if (aliasKeys.some((aliasKey) => taken.has(aliasKey) || aliasKey === key)) {
    return invalid("aliases", "duplicate");
  }

  let cnpj: string | null = null;
  if (input.cnpj !== null && input.cnpj.trim() !== "") {
    if (!isValidCnpj(input.cnpj)) return invalid("cnpj", "invalid");
    cnpj = normalizeCnpj(input.cnpj);
  }

  let city = input.city.trim();
  if (city === "") return invalid("city", "required");
  if (input.cities) {
    const official = findOfficialCity(input.cities, city);
    if (official === null) return invalid("city", "invalid");
    city = official;
  }
  const uf = input.uf.trim().toUpperCase();
  if (!(BRAZILIAN_STATES as readonly string[]).includes(uf)) return invalid("uf", "invalid");

  return ok({ name, aliases, cnpj, city, uf });
}

/** Não é possível inativar a última unidade ativa da empresa (RF04.R5, CA02). */
export function ensureNotLastActiveUnit(
  units: readonly UnitRecord[],
  unitId: string,
): Result<true, Extract<DomainError, { code: "LastActiveUnit" }>> {
  const otherActive = units.some((unit) => unit.id !== unitId && unit.status === "active");
  return otherActive ? ok(true) : fail("LastActiveUnit");
}

/** Unidade inativa não recebe novos lançamentos (RF04.R5, CA03). */
export function assertUnitAcceptsEntries(
  unit: UnitRecord,
): Result<true, Extract<DomainError, { code: "UnitInactive" }>> {
  return unit.status === "active" ? ok(true) : fail("UnitInactive", { unitId: unit.id });
}
