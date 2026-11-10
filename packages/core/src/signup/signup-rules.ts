import { normalizeEmail, validatePassword } from "../auth/auth-policy";
import { err, ok, type Result } from "../errors/result";
import { normalizeBrazilianPhone } from "../phone/phone";
import { findOfficialCity } from "../registry/municipalities";
import { BRAZILIAN_STATES, isValidCnpj, normalizeCnpj } from "../registry/unit";
import { TAX_REGIME_CHOICES, type TaxRegimeChoice } from "../tax/tax";
import {
  REVENUE_RANGES,
  type RevenueRange,
  SEGMENTS,
  type Segment,
  timezoneForUf,
} from "./signup-defaults";

export type SignupMode = "new_user" | "existing_user";

export type SignupErrorCode =
  | "required"
  | "owner_name_invalid"
  | "phone_invalid"
  /** "Criar outra empresa": o usuário não tem celular e o formulário não trouxe (decidido na API). */
  | "phone_required"
  | "password_weak"
  | "trade_name_invalid"
  | "legal_name_invalid"
  | "cnpj_invalid"
  | "segment_invalid"
  | "tax_regime_invalid"
  | "revenue_range_invalid"
  | "unit_name_invalid"
  | "city_required"
  /** Município fora da lista oficial do IBGE para a UF (DD-29). */
  | "city_invalid"
  | "uf_invalid"
  | "terms_required";

export type SignupFieldPath =
  | "owner.name"
  | "owner.phone"
  | "owner.password"
  | "company.tradeName"
  | "company.legalName"
  | "company.cnpj"
  | "company.segment"
  | "company.taxRegime"
  | "company.revenueRange"
  | "unit.name"
  | "unit.city"
  | "unit.uf"
  | "terms"
  | "form";

export type SignupFieldErrors = Partial<Record<SignupFieldPath, SignupErrorCode>>;

export interface SignupInput {
  /** Em `existing_user` só `phoneE164` pode vir preenchido; nome e senha ficam nulos. */
  readonly owner: {
    readonly name: string | null;
    readonly phoneE164: string | null;
    readonly password: string | null;
  };
  readonly company: {
    readonly tradeName: string;
    readonly legalName: string | null;
    readonly cnpj: string | null;
    readonly segment: Segment;
    readonly taxRegime: TaxRegimeChoice | null;
    readonly revenueRange: RevenueRange | null;
  };
  readonly unit: {
    readonly name: string;
    readonly city: string;
    readonly uf: string;
    readonly timezone: string;
  };
  readonly terms: { readonly accepted: true };
}

export interface SignupValidationOptions {
  /**
   * Municípios oficiais da UF informada (DD-29). Quem chama carrega a lista (o core não faz I/O).
   * Sem ela, o município só precisa estar preenchido.
   */
  readonly cities?: readonly string[];
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const OWNER_NAME_RE = /^[\p{L}][\p{L}\s'’-]*$/u;

/**
 * Valida e normaliza o formulário de autocadastro (RF01.R1 a R13). Não toca em banco nem em
 * rede. `owner.email` do bruto serve só para checar "senha diferente do e-mail" (R12).
 */
export function validateSignupInput(
  raw: unknown,
  mode: SignupMode,
  options: SignupValidationOptions = {},
): Result<SignupInput, SignupFieldErrors> {
  if (typeof raw !== "object" || raw === null) return err({ form: "required" });
  const root = raw as Rec;
  const owner = asRec(root.owner);
  const company = asRec(root.company);
  const unit = asRec(root.unit);
  const errors: SignupFieldErrors = {};

  // Responsável
  let ownerName: string | null = null;
  let phoneE164: string | null = null;
  let password: string | null = null;
  const phoneRaw = str(owner.phone);
  if (mode === "new_user") {
    const name = str(owner.name);
    if (name.length < 3 || name.length > 120 || !OWNER_NAME_RE.test(name)) {
      errors["owner.name"] = "owner_name_invalid";
    } else {
      ownerName = name;
    }
    const pw = typeof owner.password === "string" ? owner.password : "";
    if (pw !== "") {
      const check = validatePassword({ password: pw, email: normalizeEmail(str(owner.email)) });
      if (check.ok) password = pw;
      else errors["owner.password"] = "password_weak";
    }
  }
  if (phoneRaw !== "" || mode === "new_user") {
    const phone = normalizeBrazilianPhone(phoneRaw);
    if (phone.ok) phoneE164 = phone.value.e164;
    else errors["owner.phone"] = "phone_invalid";
  }

  // Empresa
  const tradeName = str(company.tradeName);
  if (tradeName.length < 2 || tradeName.length > 100)
    errors["company.tradeName"] = "trade_name_invalid";
  const legalRaw = str(company.legalName);
  if (legalRaw.length > 150) errors["company.legalName"] = "legal_name_invalid";
  const cnpjRaw = str(company.cnpj);
  let cnpj: string | null = null;
  if (cnpjRaw !== "") {
    if (isValidCnpj(cnpjRaw)) cnpj = normalizeCnpj(cnpjRaw);
    else errors["company.cnpj"] = "cnpj_invalid";
  }
  const segment = str(company.segment);
  if (!(SEGMENTS as readonly string[]).includes(segment))
    errors["company.segment"] = "segment_invalid";
  const regimeRaw = str(company.taxRegime);
  if (regimeRaw !== "" && !(TAX_REGIME_CHOICES as readonly string[]).includes(regimeRaw)) {
    errors["company.taxRegime"] = "tax_regime_invalid";
  }
  const rangeRaw = str(company.revenueRange);
  if (rangeRaw !== "" && !(REVENUE_RANGES as readonly string[]).includes(rangeRaw)) {
    errors["company.revenueRange"] = "revenue_range_invalid";
  }

  // Unidade
  const unitName = str(unit.name);
  if (unitName.length < 2 || unitName.length > 60) errors["unit.name"] = "unit_name_invalid";
  let city = str(unit.city);
  if (city === "") errors["unit.city"] = "city_required";
  else if (options.cities) {
    const official = findOfficialCity(options.cities, city);
    if (official === null) errors["unit.city"] = "city_invalid";
    else city = official;
  }
  const uf = str(unit.uf).toUpperCase();
  if (!(BRAZILIAN_STATES as readonly string[]).includes(uf)) errors["unit.uf"] = "uf_invalid";

  if (asRec(root.terms).accepted !== true) errors.terms = "terms_required";

  if (Object.keys(errors).length > 0) return err(errors);

  return ok({
    owner: { name: ownerName, phoneE164, password },
    company: {
      tradeName,
      legalName: legalRaw === "" ? null : legalRaw,
      cnpj,
      segment: segment as Segment,
      taxRegime: regimeRaw === "" ? null : (regimeRaw as TaxRegimeChoice),
      revenueRange: rangeRaw === "" ? null : (rangeRaw as RevenueRange),
    },
    unit: { name: unitName, city, uf, timezone: timezoneForUf(uf) },
    terms: { accepted: true },
  });
}
