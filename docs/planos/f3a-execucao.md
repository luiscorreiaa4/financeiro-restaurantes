# F3a (lançamentos, leitura): registro da execução

> O que aconteceu ao executar o plano `docs/superpowers/plans/2026-11-13-f3a-lancamentos-ver.md` em 13 e 14/11/2026: como foi conduzido, o que mudou em relação ao desenho, o que ficou para decidir e as propostas do fechamento. Como testar: [`f3-como-testar.md`](f3-como-testar.md). Os documentos que já existiam (`andamento.md`, `pendencias.md`, `painel.md`) foram atualizados durante a execução; este arquivo não os substitui.

## 1. Como foi conduzido

Roteiro `executar-plano-hibrido.txt`, com uma ressalva do Luís: o Fable fez o papel do Opus e do Sonnet. Na reta final, depois de o Fable bater no limite de uso, a sessão passou para o Opus 5.5.

| Tarefa | Classe | Quem fez | Revisão |
|---|---|---|---|
| A1 decisões e requisitos 1.14 | HAIKU | Haiku | diff lido pelo controlador |
| A2 dependências e componentes | NATIVA | controlador | verificação própria |
| A3 `parseBRLInput` | CRÍTICA | Fable | Fable: aprovado |
| A4 recorte de visibilidade | CRÍTICA | Fable | Fable: aprovado |
| A5 contrato da API | CRÍTICA | Fable, 2 rodadas de ajuste | Fable: aprovado |
| A6 migration 0018 | NATIVA | controlador | verificação própria |
| A7 leitor: lista e totais | CRÍTICA | Fable, 1 rodada de ajuste | Fable: aprovado; re-revisão aceita |
| A8 leitor: detalhe, versões, origem, opções | CRÍTICA | Fable | Fable: aprovado |
| A9 rotas de lista, totais e opções | CRÍTICA | Fable, 1 rodada de ajuste | Fable: aprovado |
| A10 rotas de detalhe e origem, diff de versões | CRÍTICA | Fable, 1 rodada de ajuste | Fable: "precisa de correções" (I1), corrigido |
| A11 cliente e filtros na URL | NATIVA | controlador | verificação própria |
| A12 API falsa | HAIKU | Haiku, com respostas do controlador; 5 desvios corrigidos pelo controlador | leitura do arquivo e teste com `node` |
| A13 tela de lista | NATIVA | controlador | verificação própria |
| A14 drawer | NATIVA | controlador | verificação própria |
| A15 E2E | NATIVA | controlador | `CI=true`, suíte completa |
| A16 fechamento | NATIVA | controlador | verificação completa |

Totais: HAIKU 2, NATIVA 7, CRÍTICA 7. Nenhuma consulta separada de sênior. A revisão final de segurança, prevista para um revisor independente, foi feita pelo próprio controlador depois que o revisor parou no limite de uso. Ela vale menos que uma leitura de fora; para tê-la antes do merge, basta retomar o revisor.

Nada foi commitado durante a execução: o diff de cada tarefa para o revisor foi montado entre dois retratos da árvore de trabalho (`git write-tree` com um índice temporário). Os commits foram feitos no fim, a pedido do Luís.

## 2. Incidentes e o que custaram

| Incidente | Efeito | Como foi resolvido |
|---|---|---|
| Limite de uso do Fable, 4 vezes (revisor da A3, implementador da A4, revisores da A8, A9 e da revisão final) | Agente parado no meio da tarefa | Retomado pelo `SendMessage` depois da renovação; a revisão final foi feita pelo controlador |
| Docker Desktop fechado | Integração inteira falhou sem rodar teste | Docker aberto pela linha de comando |
| `pnpm --filter @app/web add` desfez os links do `@app/db` | `typecheck` do db com `Cannot find module 'drizzle-orm'` | `pnpm install` na raiz |
| TanStack Table instalado é a v9 | `getCoreRowModel is not a function` | A tabela foi reescrita com `useTable`, `tableFeatures` e `table.FlexRender`, pela documentação que vem no pacote. O passo 0 da A2 só tinha conferido a versão do React aceita |
| `formatBRL` exige `Money` do core | Erro de tipo nas telas | `formatCents` em `apps/web/lib/format` (aceita o resultado negativo) |
| Haiku na A12 | Parou com 5 dúvidas; depois entregou com 5 desvios do desenho (aviso de restritos para o lançador, folha nas opções do gerente, código de erro, busca só na descrição, lançador sem ignorar `createdBy`) | Respostas às dúvidas e correção pelo controlador |
| Caixa de marcação controlada pela URL | Voltava ao estado antigo entre o clique e a navegação; o E2E falhou em `check()` | `useSynced` em `filters-bar.tsx`, com teste de componente |
| `test:int <nome>` roda todos os arquivos | Comando do plano rodava a suíte inteira | Dicionário usa `exec vitest run <nome>`; regra nova |

## 3. Mudanças em relação ao desenho

Todas registradas também em "Desvios do desenho aprovado" no plano.

1. **`allowedActions` (código da F2).** Passou a avaliar `can` com `isOwnEntry: true`. Sem isso o `/api/me` real não dava `entry:view` ao lançador e o menu escondia "Lançamentos" dele, contra o RF22.R3. Para dono, gerente e contador o resultado é o mesmo. Nenhuma checagem de autorização da API lê essa lista.
2. **`requireEntryAction` no lugar de `requirePermission`** nas rotas de lançamentos, pelo mesmo motivo. Regra 7 de `.claude/rules/rota-de-tenant.md`.
3. **Origem mais restrita que a seção 1.9.** Além do irmão sensível, a origem vem restrita quando alguma versão do próprio lançamento esteve em categoria sensível. Achado da revisão da A10: um lançamento que nasceu na folha e foi reclassificado entregava o texto original pela rota de origem. **Falta acrescentar a frase à seção 1.9 do desenho.**
4. **Sensível falha fechado** em todo lugar. Regra nova `.claude/rules/sensivel-falha-fechado.md`.
5. **Contrato:** `category` e `sentAt` aceitam nulo; versão ou origem restrita com conteúdo é recusada; tipo de entrada da consulta (`EntryListQueryInput`); limites nomeados.
6. Recorte com lista de unidades vazia devolve nada.
7. Detalhe e origem usam as unidades de acesso do ator, não a do seletor.
8. `canEdit`, `canDelete` e `canRestore` falsos em conta somente leitura; `toItem` exige dizer se a conta grava.
9. Web: `EntriesProvider` entrega empresa, unidade e cliente aos hooks; filtros com controles nativos; "hoje" calculado no servidor em `America/Sao_Paulo`.
10. `ROUTE_MATRIX` num arquivo de suporte (`apps/api/test/support/route-matrix.ts`), com a persona "lançador sem painel".

## 4. Para decidir

| ID | O quê | Recomendação |
|---|---|---|
| F3-3 | O aviso "Há valores restritos" respeita a busca: um gerente sem VER_FOLHA confirma valor, palavra, fornecedor, autor ou dia de um lançamento de folha testando filtros | Calcular o aviso só por período e unidade (no máximo categoria). Muda o RF22.Obs7 e uma condição em `packages/db/src/entry-reader.ts`. Decidir antes do merge |
| F3-4 | O filtro "Lançado por" lista todos os vínculos da empresa a quem não é lançador | Limitar aos vínculos com acesso às unidades de quem pergunta |
| — | Frase nova da seção 1.9 do desenho (decisão 3 acima) | Acrescentar |

Limites conhecidos, para a F3b: F3-5 em `andamento.md`.

## 5. Achados menores adiados

- `parseBRLInput`: sem teste para `"0.500"`, `"+5"` e `"1 234"` recusados, nem para `"007"` e `"r$ 5"` aceitos; sem limite de tamanho antes do `BigInt` (a busca já limita a 100 caracteres).
- Recorte: `unitIds` não deduplicado.
- Contrato: motivo só com espaços vira `""`; `description` conta unidades UTF-16; `limit` aceita `"1e2"`.
- Leitor: totais reaproveitam as sete junções da lista (medir com `EXPLAIN`); sem prova de que `entries_created_idx` é usado; `options` e `names` fazem 5 a 6 consultas em série; `options` não esconde cadastro inativo (importa no formulário da F3b).
- Rotas: todo 4xx do Fastify vira `invalid_request`; `toItem` tira campos internos por desestruturação.
- API falsa: o lançador do `fake-api.mjs` tem uma lista de ações menor que a real.

## 6. Propostas do fechamento e o que foi feito

| Proposta | Feito |
|---|---|
| Armadilhas do ambiente de testes (Docker, `test:int <nome>`, `pnpm install` depois de `add`) | Regra nova `.claude/rules/testes-integracao-ambiente.md` |
| "Sensível falha fechado", com a expressão única do leitor, para a F3b e a F4 não reinventarem | Regra nova `.claude/rules/sensivel-falha-fechado.md` |
| Roteiro de execução prever o limite de uso, a execução sem commit e os demais incidentes | Versão nova `docs/planos/prompts/executar-plano-hibrido-pos-f3.txt` (local, a pasta está no `.gitignore`); o arquivo antigo não foi alterado |
| Atualizar o dicionário de testes com as armadilhas | Não: o Luís pediu para não alterar documentos de texto agora. As armadilhas estão na regra nova; levar ao dicionário depois |

## 7. Commits

Feitos no branch `feat/f3a-lancamentos-ver`, em ordem. O leitor (A7 e A8) e as rotas (A9 e A10) foram para um commit cada, porque cada par divide o mesmo arquivo.
