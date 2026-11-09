import { z } from "zod";
import { ApiError, createApiClient } from "@/lib/api/client";

export type AuthClient = {
  sendCode(email: string): Promise<void>;
  signInWithCode(input: { email: string; otp: string; rememberMe: boolean }): Promise<void>;
  signInWithPassword(input: {
    email: string;
    password: string;
    rememberMe: boolean;
  }): Promise<void>;
  signOut(): Promise<void>;
};

const anyJson = z.unknown();

/** Cliente das rotas de acesso. O navegador fala com o próprio web, que repassa /api/* (cookie de primeira parte). */
export function createAuthClient(fetchImpl?: typeof fetch): AuthClient {
  const api = createApiClient({ baseUrl: "", fetch: fetchImpl });
  return {
    async sendCode(email) {
      await api.post(
        "/api/auth/email-otp/send-verification-otp",
        { email, type: "sign-in" },
        anyJson,
      );
    },
    async signInWithCode(input) {
      await api.post("/api/auth/sign-in/email-otp", input, anyJson);
    },
    async signInWithPassword(input) {
      await api.post("/api/auth/sign-in/email", input, anyJson);
    },
    async signOut() {
      await api.post("/api/auth/sign-out", {}, anyJson);
    },
  };
}

const errorBodySchema = z.object({ code: z.string(), message: z.string() });

const FALLBACKS: Record<string, string> = {
  INVALID_OTP: "Código inválido. Confira e tente de novo.",
  OTP_EXPIRED: "O código expirou. Peça um novo.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas com este código. Peça um novo.",
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  PASSWORD_LOCKED: "Muitas tentativas. Use o código ou tente de novo em 15 minutos.",
  TOO_MANY_REQUESTS: "Muitas tentativas. Aguarde um pouco e tente de novo.",
  INVALID_EMAIL: "Informe um e-mail válido.",
};

const GENERIC = "Algo deu errado. Tente de novo.";

/** Código de erro da API (`code`), se a resposta trouxe um. */
export function authErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = errorBodySchema.safeParse(error.body);
  return body.success ? body.data.code : null;
}

/** Texto para o usuário: a `message` em português da API; se faltar, um texto por `code`. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.";
    }
    const body = errorBodySchema.safeParse(error.body);
    if (body.success) return body.data.message || FALLBACKS[body.data.code] || GENERIC;
  }
  return GENERIC;
}
