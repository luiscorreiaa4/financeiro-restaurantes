const UNKNOWN_BROWSER = "Navegador desconhecido";

/** Navegador pela ordem que importa: Edge e Chrome carregam "Safari/" no texto. */
function detectBrowser(ua: string): string | null {
  if (ua.includes("Edg/") || ua.includes("EdgA/") || ua.includes("EdgiOS/")) return "Edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Firefox/") || ua.includes("FxiOS/")) return "Firefox";
  if (ua.includes("Chrome/") || ua.includes("CriOS/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return null;
}

/** Sistema: iPhone e iPad trazem "Mac OS X", e Android traz "Linux"; os mais específicos vêm antes. */
function detectSystem(ua: string): string | null {
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac OS X")) return "Mac";
  if (ua.includes("Linux")) return "Linux";
  return null;
}

/**
 * Rótulo legível do aparelho para a lista de sessões (RF02.R8), por heurística simples.
 * O retorno é só texto: quem exibe não deve tratá-lo como HTML.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return UNKNOWN_BROWSER;
  const browser = detectBrowser(userAgent);
  if (!browser) return UNKNOWN_BROWSER;
  const system = detectSystem(userAgent);
  return system ? `${browser} no ${system}` : browser;
}
