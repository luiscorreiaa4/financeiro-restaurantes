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

/** Provisório até a E7 (lançamentos): ainda não existe nada para desfazer. */
export const NOTHING_TO_UNDO_TEXT = "Ainda não há nada para desfazer.";
