// Páginas do grupo `(app)` que o E2E percorre na matriz de rotas por estado de sessão (A6).
// `lib/routes-list.test.ts` (Vitest) compara esta lista com as `page.tsx` de `app/(app)/` no disco:
// página nova sem entrada aqui faz aquele teste falhar. Segmento dinâmico entra com o mesmo
// colchete do disco (ex.: `/lancamentos/[id]`); o E2E troca `[id]` por um valor de exemplo
// (`concreteRoute`). Hoje não há rota dinâmica em `(app)`.
export const APP_ROUTES = [
  "/",
  "/bem-vindo",
  "/configuracoes",
  "/dashboard",
  "/exportacoes",
  "/lancamentos",
  "/nova-empresa",
  "/perfil",
] as const;

/** URL visitável de uma entrada da lista: segmentos `[x]` viram um valor de exemplo. */
export function concreteRoute(route: string): string {
  return route.replace(/\[[^\]]+\]/g, "exemplo");
}
