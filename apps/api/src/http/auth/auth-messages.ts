/**
 * Mensagens em português para os códigos de erro do Better Auth (que vêm em inglês, RNF09).
 * Nenhuma revela se o e-mail existe (RF02.R1, R7).
 */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD:
    "E-mail ou senha incorretos. Se você ainda não tem senha, entre com o código enviado ao e-mail.",
  PASSWORD_LOCKED:
    "O acesso por senha foi bloqueado por 15 minutos depois de várias tentativas. Entre com o código enviado ao e-mail.",
  // Um só erro para código errado, vencido ou com tentativas esgotadas, igual para e-mail com e
  // sem conta (RF02.R1, DD-30): o motivo exato revelaria se o e-mail tem conta.
  INVALID_OTP: "Código incorreto ou vencido. Confira os 6 dígitos ou peça um novo código.",
  // Só depois de código ou senha certos (RF02.R1, CA10).
  NO_ACTIVE_UNIT:
    "Sua empresa está sem unidade ativa. Peça ao dono da empresa para reativar uma unidade.",
  INVALID_TOKEN: "Link inválido ou expirado. Peça um novo.",
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha pode ter no máximo 64 caracteres.",
  PASSWORD_NEEDS_LETTER_AND_DIGIT: "A senha precisa ter letras e números.",
  PASSWORD_SAME_AS_EMAIL: "A senha não pode ser igual ao e-mail.",
  INVALID_PASSWORD: "Senha atual incorreta.",
  SAME_PASSWORD: "A nova senha não pode ser igual à atual.",
  NO_PASSWORD: "Você ainda não tem senha. Defina uma pelo link enviado ao e-mail.",
  INVALID_NAME: "Informe um nome de 1 a 120 caracteres.",
  INVALID_EMAIL: "Informe um e-mail válido.",
  UNAUTHORIZED: "Sua sessão terminou. Entre de novo.",
  TOO_MANY_REQUESTS: "Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.",
  INVALID_REQUEST: "Não entendemos o pedido. Confira os dados e tente de novo.",
};

const GENERIC = "Não foi possível concluir agora. Tente de novo em instantes.";

/** Código usado quando o Better Auth não manda um reconhecido. */
function codeForStatus(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 429) return "TOO_MANY_REQUESTS";
  if (status >= 500) return "INTERNAL_ERROR";
  return "INVALID_REQUEST";
}

/** Formato único de erro da API de acesso: `{ code, message }`, com `message` em pt-BR. */
export function authError(status: number, code?: unknown): { code: string; message: string } {
  const known = typeof code === "string" && code in MESSAGES ? code : undefined;
  const finalCode = known ?? codeForStatus(status);
  return { code: finalCode, message: MESSAGES[finalCode] ?? GENERIC };
}
