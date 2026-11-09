import type { SignupErrorCode, SignupFieldErrors, SignupFieldPath } from "@app/core";
import { z } from "zod";
import { ApiError, createApiClient } from "@/lib/api/client";

/** Empresa, primeira unidade e aceite: a parte comum do cadastro e de "Criar outra empresa". */
export type CompanyPayload = {
  company: {
    tradeName: string;
    legalName: string;
    cnpj: string;
    segment: string;
    taxRegime: string;
    revenueRange: string;
  };
  unit: { name: string; city: string; uf: string };
  terms: { accepted: boolean };
};

export type SignupPayload = CompanyPayload & {
  receipt: string;
  email: string;
  owner: { name: string; email: string; phone: string; password: string };
};

/** `owner.phone` só vai quando o usuário logado não tem celular (a API pede com `phone_required`). */
export type NewCompanyPayload = CompanyPayload & { owner: { phone?: string } };

export type SignupApi = {
  requestCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<{ receipt: string }>;
  submitSignup(payload: SignupPayload): Promise<{ tenantId: string }>;
  submitCompany(payload: NewCompanyPayload): Promise<{ tenantId: string }>;
};

const sentSchema = z.object({ success: z.boolean() });
const receiptSchema = z.object({ receipt: z.string().min(1) });
const createdSchema = z.object({ tenantId: z.string().min(1) });

/** Rotas do autocadastro (F1b). O navegador fala com o próprio web, que repassa /api/*. */
export function createSignupApi(fetchImpl?: typeof fetch): SignupApi {
  const api = createApiClient({ baseUrl: "", fetch: fetchImpl });
  return {
    async requestCode(email) {
      await api.post("/api/signup/code", { email }, sentSchema);
    },
    verifyCode: (email, code) => api.post("/api/signup/verify", { email, code }, receiptSchema),
    submitSignup: (payload) => api.post("/api/signup", payload, createdSchema),
    submitCompany: (payload) => api.post("/api/companies", payload, createdSchema),
  };
}

const errorBodySchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

/** Textos por código, usados quando a API não mandou `message` (a API é a fonte principal). */
const FALLBACKS: Record<string, string> = {
  INVALID_CODE: "Código inválido ou vencido. Confira os 6 dígitos ou peça um novo código.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas com este código. Peça um novo código.",
  INVALID_EMAIL: "Informe um e-mail válido.",
  TOO_MANY_REQUESTS: "Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.",
  INVALID_FIELDS: "Confira os campos marcados e tente de novo.",
  RECEIPT_INVALID:
    "A confirmação do seu e-mail venceu ou já foi usada. Confirme o e-mail de novo para continuar.",
  CNPJ_TAKEN:
    "Este CNPJ já está cadastrado. Se a empresa é sua, entre na conta existente ou fale com o suporte.",
  PHONE_TAKEN: "Este celular já está em uso. Fale com o suporte para continuar.",
  SIGNUP_FAILED: "Não foi possível concluir o cadastro. Tente entrar ou fale com o suporte.",
  UNAUTHORIZED: "Sua sessão terminou. Entre de novo para continuar.",
};

/** Alerta geral quando há campos marcados. */
export const CHECK_FIELDS = "Confira os campos marcados e tente de novo.";

const GENERIC = "Não foi possível concluir agora. Tente de novo em instantes.";
const OFFLINE = "Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.";

function errorBody(error: unknown) {
  if (!(error instanceof ApiError)) return null;
  const body = errorBodySchema.safeParse(error.body);
  return body.success ? body.data : null;
}

export function signupErrorCode(error: unknown): string | null {
  return errorBody(error)?.code ?? null;
}

/** Texto para o usuário: a `message` em português da API; se faltar, um texto por `code`. */
export function signupErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) return OFFLINE;
  const body = errorBody(error);
  if (!body) return GENERIC;
  return body.message || FALLBACKS[body.code] || GENERIC;
}

const FIELD_PATHS: readonly SignupFieldPath[] = [
  "owner.name",
  "owner.phone",
  "owner.password",
  "company.tradeName",
  "company.legalName",
  "company.cnpj",
  "company.segment",
  "company.taxRegime",
  "company.revenueRange",
  "unit.name",
  "unit.city",
  "unit.uf",
  "terms",
  "form",
];

/** Mensagens por campo (códigos estáveis de `validateSignupInput`, RF01). */
const FIELD_MESSAGES: Record<SignupErrorCode, string> = {
  required: "Preencha este campo.",
  owner_name_invalid: "Informe o nome completo: de 3 a 120 letras, sem números.",
  phone_invalid: "Celular inválido. Informe o DDD e o número, por exemplo (82) 99658-5647.",
  phone_required: "Informe o celular (WhatsApp) do dono para criar a empresa.",
  password_weak:
    "A senha precisa ter de 8 a 64 caracteres, com letras e números, e ser diferente do e-mail.",
  trade_name_invalid: "O nome fantasia precisa ter de 2 a 100 caracteres.",
  legal_name_invalid: "A razão social pode ter até 150 caracteres.",
  cnpj_invalid: "CNPJ com dígito verificador inválido. Confira o número.",
  segment_invalid: "Escolha o segmento.",
  tax_regime_invalid: "Escolha uma opção da lista.",
  revenue_range_invalid: "Escolha uma opção da lista.",
  unit_name_invalid: "O nome da unidade precisa ter de 2 a 60 caracteres.",
  city_required: "Informe o município.",
  uf_invalid: "Escolha o estado (UF).",
  terms_required: "Para continuar, aceite os Termos de Uso e a Política de Privacidade.",
};

export function fieldErrorMessage(code: string): string {
  return FIELD_MESSAGES[code as SignupErrorCode] ?? "Confira este campo.";
}

/** Erros por campo vindos da API (`fields`), só com caminhos e códigos conhecidos. */
export function signupFieldErrors(error: unknown): SignupFieldErrors {
  const fields = errorBody(error)?.fields;
  const result: SignupFieldErrors = {};
  if (!fields) return result;
  for (const path of FIELD_PATHS) {
    const code = fields[path];
    if (typeof code === "string" && code in FIELD_MESSAGES) {
      result[path] = code as SignupErrorCode;
    }
  }
  return result;
}
