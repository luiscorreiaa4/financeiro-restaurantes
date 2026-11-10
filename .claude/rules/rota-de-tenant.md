---
paths:
  - "apps/api/src/http/**"
  - "apps/api/test/**"
---

# Rota da API com dado de tenant

Regra de negócio por trás: isolamento entre empresas (RNF02), contexto do painel (RF02.R6, DD-31) e permissões (RF06.R2). A autorização real é sempre da API; o painel só esconde botão.

Toda rota que lê ou grava dado de uma empresa:

1. Usa, nesta ordem, `requirePanelContext` (sessão e contexto revalidados), `requireTenantRoute` (cookie inválido dá 403 `context_invalid`; `X-Context` ausente ou diferente dá 409 `context_changed`), `requirePermission(action)` (403 `forbidden`) e, se grava, `requireWritable()` (403 `account_read_only`). Guards em `apps/api/src/http/panel/panel-context.ts`.
2. Lê e grava o dado só dentro de `withTenant(appDb, request.panel.tenantId, ...)`, pelo papel `app`. Nunca confie em `tenantId` vindo do corpo, da URL ou do cabeçalho.
3. Filtra por unidade com `request.panel.actor.units`; `unitId: "all"` só existe para quem tem todas as unidades.
4. Responde erro só com `{ code }`, sem dado, e nunca loga cookie, `X-Context`, e-mail nem nome.
5. Ganha teste de integração com duas empresas (a outra não aparece) e uma linha na matriz papel × ação (RF06.CA06).
6. Rota de escrita nova: confira `Origin` (pendência F2-1) assim que a verificação existir.
