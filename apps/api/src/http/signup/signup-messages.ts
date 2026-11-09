/**
 * Mensagens em português do autocadastro (RNF09). Nenhuma revela se o e-mail já tem conta
 * (RF02.R1): código errado, vencido ou de e-mail cadastrado caem todos em `INVALID_CODE`.
 */
const MESSAGES: Record<string, string> = {
  INVALID_CODE: "Código inválido ou vencido. Confira os 6 dígitos ou peça um novo código.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas com este código. Peça um novo código.",
  INVALID_EMAIL: "Informe um e-mail válido.",
  INVALID_REQUEST: "Não entendemos o pedido. Confira os dados e tente de novo.",
  TOO_MANY_REQUESTS: "Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.",
  INVALID_FIELDS: "Confira os campos marcados e tente de novo.",
  RECEIPT_INVALID:
    "A confirmação do seu e-mail venceu ou já foi usada. Confirme o e-mail de novo para continuar.",
  CNPJ_TAKEN:
    "Este CNPJ já está cadastrado. Se a empresa é sua, entre na conta existente ou fale com o suporte.",
  // Não cita a outra conta nem a quem pertence o número (CA05, RF02.R1).
  PHONE_TAKEN: "Este celular já está em uso. Fale com o suporte para continuar.",
  // E-mail que ganhou conta depois do código: genérico, sem confirmar que existe (RF02.R1).
  SIGNUP_FAILED: "Não foi possível concluir o cadastro. Tente entrar ou fale com o suporte.",
};

const GENERIC = "Não foi possível concluir agora. Tente de novo em instantes.";

export type SignupErrorCode =
  | "INVALID_CODE"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_EMAIL"
  | "INVALID_FIELDS"
  | "RECEIPT_INVALID"
  | "CNPJ_TAKEN"
  | "PHONE_TAKEN"
  | "SIGNUP_FAILED";

function codeForStatus(status: number): string {
  if (status === 429) return "TOO_MANY_REQUESTS";
  if (status >= 500) return "INTERNAL_ERROR";
  return "INVALID_REQUEST";
}

/** Formato único de erro, igual ao do login: `{ code, message }` com `message` em pt-BR. */
export function signupError(
  status: number,
  code?: SignupErrorCode,
): { code: string; message: string } {
  const finalCode = code ?? codeForStatus(status);
  return { code: finalCode, message: MESSAGES[finalCode] ?? GENERIC };
}
