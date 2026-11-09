const BASE = "http://safe-next.invalid";
// biome-ignore lint/suspicious/noControlCharactersInRegex: justamente para recusar TAB, CR, LF etc.
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/**
 * Destino depois do login: só caminho interno. O navegador ignora TAB/CR/LF dentro da URL e trata
 * a barra invertida como barra normal, então "/<TAB>/evil.com" viraria "//evil.com"; por isso
 * recusamos esses caracteres.
 */
export function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next?.startsWith("/") || CONTROL_OR_BACKSLASH.test(next)) return "/";
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return "/";
    const result = url.pathname + url.search + url.hash;
    return result.startsWith("//") ? "/" : result;
  } catch {
    return "/";
  }
}
