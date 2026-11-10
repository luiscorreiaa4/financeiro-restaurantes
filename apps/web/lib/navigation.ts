import type { Action } from "@app/core";

/** `action` ausente = visível a todo usuário do painel (RF06; mapa do desenho da F2). */
export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly action?: Action;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Início" },
  { href: "/lancamentos", label: "Lançamentos", action: "entry:view" },
  { href: "/dashboard", label: "Dashboard", action: "report:view" },
  { href: "/exportacoes", label: "Exportações", action: "export:data" },
  { href: "/configuracoes", label: "Configurações", action: "catalog:view" },
  // F1b: o usuário logado vira Dono de uma empresa nova (POST /api/companies).
  { href: "/nova-empresa", label: "Criar outra empresa" },
];

/** Itens do menu que o usuário pode ver, a partir de `allowedActions` do contexto. */
export function visibleNavItems(allowedActions: readonly string[]): readonly NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.action === undefined || allowedActions.includes(item.action),
  );
}
