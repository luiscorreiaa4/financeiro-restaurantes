const BASE = "http://safe-next.invalid";
// biome-ignore lint/suspicious/noControlCharactersInRegex: justamente para recusar TAB, CR, LF etc.
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/** Telas que mandam quem já entrou de volta a `next` (laço) e as rotas da API. */
const ACCESS_PATHS = new Set(["/login", "/cadastro", "/recuperar-senha"]);

/** Compara decodificado, em minúsculas e sem barra final, para variação trivial não escapar. */
function isAccessOrApiPath(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  path = path.toLowerCase().replace(/\/+$/, "");
  return ACCESS_PATHS.has(path) || path === "/api" || path.startsWith("/api/");
}

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
    if (isAccessOrApiPath(url.pathname)) return "/";
    const result = url.pathname + url.search + url.hash;
    return result.startsWith("//") ? "/" : result;
  } catch {
    return "/";
  }
}
