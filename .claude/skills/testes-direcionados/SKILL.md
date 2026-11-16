---
name: testes-direcionados
description: Use ao rodar testes, typecheck ou lint, ao verificar uma tela ou feature, ao concluir uma tarefa ou antes de commitar. Escolhe o menor conjunto de testes que prova a mudança e reserva a suíte completa para mudanças estruturais.
---

# Testes direcionados

Rode o menor conjunto que prova a mudança. O CI do GitHub roda tudo em cada push; localmente a suíte completa só vale nos gatilhos do nível 3.

Mapa de assunto → arquivo → comando: `.claude/dicionario-testes.md`. Procure o assunto da mudança lá e use o comando da linha.

## Níveis

| Nível | Quando | O que roda |
|---|---|---|
| **1. Ciclo** | Depois de cada edição, no TDD | Só o teste da coisa mexida. Unitário: `pnpm --filter @app/<p> test <trecho>`. Integração: `pnpm --filter @app/<p> exec vitest run <trecho>`. E2E: `pnpm --filter @app/web exec playwright test <spec> --project="Desktop Chrome"`. Sem typecheck nem lint globais. |
| **2. Conclusão** | Uma vez, ao dar a tarefa por pronta | Testes do assunto (linhas do dicionário) + `pnpm --filter @app/<p> typecheck` + `pnpm exec biome check <arquivos tocados>` + a spec E2E da tela, nos dois projetos (desktop e celular). Mexeu em tipo exportado de `packages/core`: `pnpm --filter "...@app/core" typecheck`. |
| **3. Suíte completa** | Só nos gatilhos abaixo | `pnpm typecheck && pnpm lint && pnpm test`; some `pnpm test:int` se tocou banco e `CI=true pnpm --filter @app/web test:e2e` se mudou o painel de forma estrutural. |

## Gatilhos do nível 3 (lista fechada)

- Schema ou migration do banco.
- Configuração: `packages/config/**`, `tsconfig*`, `biome.json`, `turbo.json`, `vitest.config.*`, `playwright.config.ts`, `next.config.ts`, `proxy.ts`, layouts de `app/`.
- Dependência nova ou atualizada (`package.json`, `pnpm-lock.yaml`).
- Contrato ou regra compartilhada: `packages/core/src/contracts/**`, `packages/core/src/permissions/**`.
- Renomear ou mover módulo usado em vários pacotes.
- Fechamento de etapa, antes de abrir PR, ou quando o Luís pedir.

Fora disso, uma tela nova ou ajustada é nível 1 durante e nível 2 no fim.

## Não repetir

- Nunca rode o mesmo comando duas vezes sem edição de código entre as duas.
- Falhou: corrija rodando só o arquivo que falhou (nível 1). Passou, repita o nível 2 uma vez.
- Resultado que passou e cujo código não mudou depois vale como evidência. Isso atende `superpowers:verification-before-completion`, que pede evidência da mudança, não da suíte inteira.
- Falha de ambiente (Docker fechado, porta ocupada) é `AMBIENTE`: reporte e não rode o resto de novo.
- `vitest --changed` não serve aqui: rodou os 39 arquivos do web mesmo com poucos alterados. Use o trecho do dicionário.
- `pnpm --filter <p> test:int <trecho>` roda **todas** as integrações do pacote (o script já fixa `int.test.ts`). Para um arquivo, use `exec vitest run <trecho>`.
- Integração precisa do Docker aberto (`docker info`). Evals de IA gastam crédito: só com pedido do Luís.

## Fim da tarefa

Diga em uma linha qual nível rodou e por quê. Exemplo: "nível 2: testes de lançamentos, typecheck do web e spec entries".
