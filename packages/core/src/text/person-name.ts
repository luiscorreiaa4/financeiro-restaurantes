/** Controle, formato, separadores de linha/parágrafo e "brancos" que o Unicode trata como letra (DD-32 item 4). */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/gu;
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/**
 * Limpa o nome de uma pessoa: remove caracteres invisíveis, normaliza para NFC e apara as pontas.
 * Devolve `null` se sobrar vazio ou sem nenhuma letra ou número. Espaços internos comuns ficam.
 */
export function normalizePersonName(raw: string): string | null {
  const cleaned = raw.replace(INVISIBLE, "").normalize("NFC").trim();
  return HAS_LETTER_OR_NUMBER.test(cleaned) ? cleaned : null;
}
