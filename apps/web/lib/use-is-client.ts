import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Falso no servidor e na hidratação, verdadeiro depois. Tela que busca dado de tenant no navegador
 * e pode ter esse dado já no cache na hidratação (outro componente, como o aviso de exportação da
 * casca, buscou antes) renderiza o estado de carregamento até aqui virar verdadeiro: sem isso o
 * HTML do servidor (carregando) e a primeira renderização do cliente (dados) divergem
 * (apps/web/CLAUDE.md, Dashboard).
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
