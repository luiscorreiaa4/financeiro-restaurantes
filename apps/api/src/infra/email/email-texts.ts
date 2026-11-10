/**
 * Texto do aviso do autocadastro para quem já tem conta (F1b, RF01, RF02.R1). O link vem da
 * configuração de URL pública (`APP_URL`), nunca do corpo da requisição.
 */
export function accountExistsText(loginUrl: string): string {
  return `Você já tem conta. Entre em ${loginUrl}. Para abrir outra empresa, entre e use 'Criar outra empresa'. Se não conseguir entrar, fale com o suporte.`;
}

/** Link de recuperação de senha (RF03, DD-27). Texto fixo em pt-BR; o link é a única informação sensível. */
export function passwordResetLinkText(url: string): string {
  return `Recebemos um pedido para redefinir a senha da sua conta. Abra o link para escolher uma senha nova: ${url} . O link vale por 30 minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: nada muda na sua conta.`;
}

const SAO_PAULO_PARTS = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `dd/MM/yyyy HH:mm` em America/Sao_Paulo, sem depender do separador que o ICU escolhe. */
function formatSaoPaulo(at: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    SAO_PAULO_PARTS.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

/**
 * Aviso de troca de senha (RF03.Obs1). Texto fixo em pt-BR; nunca leva senha nem código.
 */
export function passwordChangedText(at: Date): string {
  return `A senha da sua conta foi alterada em ${formatSaoPaulo(at)} (horário de Brasília). Se não foi você, fale com o suporte o quanto antes.`;
}
