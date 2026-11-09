/**
 * Texto do aviso do autocadastro para quem já tem conta (F1b, RF01, RF02.R1). O link vem da
 * configuração de URL pública (`APP_URL`), nunca do corpo da requisição.
 */
export function accountExistsText(loginUrl: string): string {
  return `Você já tem conta. Entre em ${loginUrl}. Para abrir outra empresa, entre e use 'Criar outra empresa'. Se não conseguir entrar, fale com o suporte.`;
}
