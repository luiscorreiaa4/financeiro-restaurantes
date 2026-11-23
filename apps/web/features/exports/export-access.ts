/**
 * O que a pessoa pode fazer na exportação, a partir das ações da sessão. Esconder o botão é conforto:
 * a API confere `export:data` e `export:full` de novo (RF29.Obs1, RF29.R3).
 */
export function exportAccess(allowedActions: readonly string[]): {
  canExport: boolean;
  canFull: boolean;
} {
  return {
    canExport: allowedActions.includes("export:data"),
    canFull: allowedActions.includes("export:full"),
  };
}
