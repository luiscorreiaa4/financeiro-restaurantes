/**
 * Textos que o usuário final vê, em pt-BR. Rascunho aprovado na E5 para ser revisado com o
 * Matheus (plano do canal, seção 3.5): tudo mora aqui para trocar sem mexer na lógica.
 */

function supportSentence(supportContact: string | undefined): string {
  return supportContact
    ? `Se precisar de ajuda: ${supportContact}.`
    : "Se precisar de ajuda, fale com o suporte.";
}

/** Número sem cadastro ativo (inclui acesso desativado): não revela se o cadastro existe. */
export function unknownSenderText(supportContact: string | undefined): string {
  return `Olá! Não encontrei este número cadastrado. Peça ao responsável pelo restaurante para incluir você. ${supportSentence(supportContact)}`;
}

/** Sticker, vídeo, documento, texto vazio… */
export const UNSUPPORTED_TYPE_TEXT =
  "Por enquanto eu entendo texto, áudio e foto de nota. Pode me mandar assim?";

/** Assunto fora do escopo; a E6 usa quando a IA devolve a intenção `out_of_scope`. */
export const OUT_OF_SCOPE_TEXT =
  "Eu só ajudo a registrar receitas e despesas do restaurante. Exemplo: 'paguei 350 de carne no açougue'.";

export function helpText(supportContact: string | undefined): string {
  return [
    "Eu registro as receitas e despesas do seu restaurante. É só me escrever, mandar áudio ou foto da nota. Exemplos:",
    "• paguei 350 de carne no açougue",
    "• vendi 1.200 no salão hoje",
    "",
    "Para corrigir, responda à minha confirmação com o valor ou o dado certo.",
    "Para cancelar o último lançamento, envie *desfazer*.",
    "",
    supportSentence(supportContact),
  ].join("\n");
}

/** Comando `suporte` (RF19). */
export function supportText(supportContact: string | undefined): string {
  return supportContact
    ? `Fale com o nosso suporte: ${supportContact}.`
    : "Fale com o suporte do seu restaurante.";
}

/** Provisório da E5; o fluxo real (RF18.R4) usa `NOTHING_TO_UNDO_24H_TEXT`. */
export const NOTHING_TO_UNDO_TEXT = "Ainda não há nada para desfazer.";
export const NOTHING_TO_CANCEL_TEXT = "Não há nenhuma pergunta aberta para cancelar.";

/** Falha definitiva (RF19.R4): avisa que NÃO foi registrado e pede nova tentativa. */
export function failureText(supportContact: string | undefined): string {
  return `Tive um problema e NÃO registrei essa mensagem. Pode enviar de novo? ${
    supportContact
      ? `Se continuar, fale com o suporte: ${supportContact}.`
      : "Se continuar, fale com o suporte."
  }`;
}

/** Limite de mensagens por usuário ou empresa (RF21.R2); o aviso sai no máximo uma vez por hora. */
export const RATE_LIMITED_TEXT =
  "Recebi muitas mensagens seguidas. Aguarde alguns minutos e tente de novo.";
