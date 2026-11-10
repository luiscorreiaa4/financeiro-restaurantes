/**
 * Máscaras de digitação do cadastro (DD-28). Funções puras: recebem o texto como veio (digitado ou
 * colado, com ou sem pontuação) e devolvem o texto formatado. O que sobra do limite do campo é ignorado.
 */

/** CNPJ: 12 posições de 0-9 e A-Z mais 2 dígitos. Formato `AA.AAA.AAA/AAAA-DD`. */
export function maskCnpj(raw: string): string {
  let kept = "";
  for (const char of raw.toUpperCase()) {
    if (kept.length >= 14) break;
    // As duas últimas posições são os dígitos verificadores: só números.
    const allowed = kept.length < 12 ? /[0-9A-Z]/ : /[0-9]/;
    if (allowed.test(char)) kept += char;
  }
  let out = "";
  for (let i = 0; i < kept.length; i++) {
    if (i === 2 || i === 5) out += ".";
    else if (i === 8) out += "/";
    else if (i === 12) out += "-";
    out += kept[i];
  }
  return out;
}

/** Celular ou fixo brasileiro: `(11) 98765-4321` (11 dígitos) ou `(11) 3456-7890` (10). */
export function maskBrPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  // Colado com o código do país (+55): tira o 55 quando há dígitos demais para um número nacional.
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits === "") return "";
  const area = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest === "") return `(${area}`;
  // Com 11 dígitos o número tem 9 dígitos depois do DDD: 5 + 4. Com menos, 4 + o que vier.
  const split = digits.length > 10 ? 5 : 4;
  const head = rest.slice(0, split);
  const tail = rest.slice(split);
  return tail === "" ? `(${area}) ${head}` : `(${area}) ${head}-${tail}`;
}

export type Mask = {
  format: (raw: string) => string;
  /** Caracteres que contam como conteúdo (o resto é pontuação da máscara). */
  noise: RegExp;
};

export const CNPJ_MASK: Mask = { format: maskCnpj, noise: /[^0-9A-Za-z]/g };
export const PHONE_MASK: Mask = { format: maskBrPhone, noise: /\D/g };

const significant = (text: string, noise: RegExp) => text.replace(noise, "");

/**
 * Aplica a máscara depois de uma edição e calcula onde o cursor fica. Se a edição só apagou
 * pontuação (o conteúdo não mudou), apaga o caractere de conteúdo anterior, senão a máscara
 * recolocaria o separador e o Backspace "travaria".
 */
export function applyMask(
  mask: Mask,
  previous: string,
  next: string,
  caret: number,
): { value: string; caret: number } {
  let text = next;
  let position = Math.min(caret, next.length);

  const onlySeparatorRemoved =
    next.length < previous.length &&
    significant(next, mask.noise).length === significant(previous, mask.noise).length;
  if (onlySeparatorRemoved) {
    for (let i = position - 1; i >= 0; i--) {
      if (significant(text[i] ?? "", mask.noise) !== "") {
        text = text.slice(0, i) + text.slice(i + 1);
        position = i;
        break;
      }
    }
  }

  const before = significant(text.slice(0, position), mask.noise).length;
  const value = mask.format(text);
  if (before === 0) return { value, caret: 0 };

  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (significant(value[i] ?? "", mask.noise) !== "") seen++;
    if (seen === before) return { value, caret: i + 1 };
  }
  return { value, caret: value.length };
}
