# Plano: fechamento da E11

Desenho: `docs/superpowers/specs/2026-11-09-e11-fechamento-design.md`. Decisão: DE-26. TDD em cada tarefa: teste que falha, código, teste que passa.

| # | Tarefa | Arquivos principais |
|---|---|---|
| 1 | `PhoneRequired` em `validateAccess`; convite do contador sem celular | `packages/core/src/access/access.ts`, `accountant-invite.ts`, `errors/domain-errors.ts` + testes |
| 2 | `resolveSender` ignora contador | `packages/core/src/conversation/sender.ts` + teste |
| 3 | Palavras comuns no nome da empresa | `packages/core/src/conversation/cited-place.ts` + teste |
| 4 | `ChoiceStore.apply` sem fechar a pergunta e com unidade ativa; `answerChoice` fecha depois de responder | `ports.ts`, `choice-store.ts`, `switch-handlers.ts` + testes |
| 5 | `cancelar` com lista aberta | `entry-handlers.ts` + teste |
| 6 | Integração: contador sem telefone e contador-só no canal | `packages/db/test`, `apps/api/test` |
| 7 | Seed da Contadora Demo | `packages/db/src/dev-seed.ts`, guia de testes manuais |
| 8 | Fechamento: `andamento.md`, `canal-whatsapp.md`, `CLAUDE.md`, propostas de regras/skills |  |

Verificação: `pnpm typecheck && pnpm lint && pnpm test`, integração de `@app/db` e `@app/api`.
