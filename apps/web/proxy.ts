import { type NextRequest, NextResponse } from "next/server";

// Os dois nomes do cookie do Better Auth: HTTP (dev) e HTTPS (teste e produção).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

// Só assets estáticos conhecidos; `/lancamentos/export.xlsx` e similares continuam protegidos.
const STATIC_FILE =
  /\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|map|woff2?|ttf|otf|txt|xml|webmanifest)$/i;

// Telas abertas sem sessão: acesso, autocadastro (RF01.Obs1) e os textos legais.
const PUBLIC_PAGES = [
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/redefinir-senha",
  "/termos",
  "/privacidade",
];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`)) ||
    pathname.startsWith("/_next/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    STATIC_FILE.test(pathname)
  );
}

/**
 * Conforto, não segurança: só olha se existe cookie de sessão. A validade real vem da API
 * (`/api/me`, lida em `lib/auth/session.ts`), que continua a autoridade.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.get(name)?.value);
  if (hasCookie) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/|api$).*)"],
};
