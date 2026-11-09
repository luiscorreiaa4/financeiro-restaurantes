export type NavItem = { readonly href: string; readonly label: string };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Início" },
  { href: "/lancamentos", label: "Lançamentos" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/exportacoes", label: "Exportações" },
  { href: "/configuracoes", label: "Configurações" },
  // F1b: o usuário logado vira Dono de uma empresa nova (POST /api/companies).
  { href: "/nova-empresa", label: "Criar outra empresa" },
];
