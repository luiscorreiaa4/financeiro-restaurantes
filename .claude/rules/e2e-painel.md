---
paths:
  - "apps/web/e2e/**"
---

# E2E do painel

- Na primeira visita de um aparelho sem cookie `fr_ctx`, a casca grava o contexto e recarrega a página (DD-31). Spec que abre uma página com sessão nova e mexe na tela logo em seguida fica instável: grave o `fr_ctx` junto da sessão (`<tenantId>.all` ou `<tenantId>.<unitId>`) ou espere `getByRole("status").filter({ hasText: "Carregando…" })` sumir. Não use `getByText("Carregando…")`: o layout também tem um.
- Menu do celular: o clique antes da hidratação não abre nada. Abra com `expect(async () => { if (!(await dialog.isVisible())) await toggle.click(); await expect(dialog).toBeVisible(); }).toPass()`, sem clicar de novo num menu já aberto.
- Elementos duplicados (casca do desktop e do celular): selecione com `:visible` ou `.filter({ visible: true })`.
- Para provar o que o CI prova, rode com `CI=true pnpm --filter @app/web test:e2e` (usa `next build`); o `next dev` compila cada rota na primeira visita e oscila com testes em paralelo.
- Persona da API falsa pelo valor do cookie de sessão (`sessao-falsa-owner2`, `-manager`, `-staff`, `-accountant`, `-readonly`, `-expira`). A regra de verdade mora nos testes da API.
