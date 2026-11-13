# F3b Lançamentos (mudar): plano de implementação

> **Para quem executa:** `superpowers:subagent-driven-development` nas tarefas CRÍTICAS e `superpowers:executing-plans` nas demais; TDD em todas; passos com `- [ ]`; nunca commitar sem o Luís pedir (o último passo de cada tarefa sugere o commit). Não ler o `.env`.

**Goal:** editar, marcar como revisado, excluir, excluir em lote e restaurar pelo painel, com conflito de versão e lixeira de 30 dias.
**Architecture:** as rotas de escrita carregam o `Entry` de domínio, aplicam as funções puras de `packages/core/src/entry/entry.ts` com `channel: "web"` e gravam com `applyChanges`; a tela usa React Hook Form com o schema do contrato (`@app/core/contracts`, tarefa A5 do F3a).
**Tech Stack:** TypeScript strict, Fastify 5, Zod 4, Drizzle, Next 16, React 19, `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, Vitest, Testcontainers, Playwright.
**Spec:** `docs/superpowers/specs/2026-11-13-f3-lancamentos-design.md` (as referências "1.x" abaixo são seções do desenho)
**Depende de:** F3a concluído (`docs/superpowers/plans/2026-11-13-f3a-lancamentos-ver.md`); as tarefas "A#" citadas são de lá.

## Global Constraints (F3a e F3b)

- Dinheiro: `number` inteiro em centavos no JSON; nunca `float`; a tela não soma (RNF13.R1, RF22.Obs2, D-F4).
- Datas de negócio: texto `AAAA-MM-DD`; nunca `new Date("AAAA-MM-DD")` (RNF13.R4).
- Período: padrão mês corrente; atalhos hoje, ontem, últimos 7 dias, mês corrente, mês anterior, personalizado; máximo 24 meses (RF22.R1).
- Página: `limit` padrão 50, máximo 100. Lote: até 100 ids. Motivo de exclusão: até 200 caracteres (RF24.R1). Lixeira: 30 dias (`RESTORE_WINDOW_DAYS`, DE-24). Data futura na edição: até 60 dias (RF23.R1). Busca livre: até 100 caracteres.
- Sinais: `category_to_review`, `channel_to_review`, `possible_duplicate`, `old_date` (RF22.R4).
- Ordenação: `created_at` (padrão) | `occurred_on` | `paid_on` | `amount`; `dir` `desc` (padrão) | `asc` (DD-35).
- Mensagem de conflito: "Este lançamento foi alterado por [nome] às hh:mm. Recarregar?" (RF23.Obs2).
- Erros de rota de tenant: só `{ code }`, com as duas exceções de 1.7 (`invalid_entry` com `reason`; `entry_stale` com `current`). Nada de conteúdo de mensagem, nome, e-mail ou valor em log (RNF11).
- Texto de usuário (descrição, texto original, transcrição, motivo) é renderizado como texto (RF25.R1).
- Guards na ordem de `.claude/rules/rota-de-tenant.md`, com `requireWritable()` em toda escrita; dado só dentro de `withTenant(appDb, request.panel.tenantId, ...)`.
- Testes com nomes em português; assunto novo atualiza `.claude/dicionario-testes.md`; Biome só nos arquivos tocados.
- Dependências novas: nenhuma além das instaladas na A2. Qualquer outra necessidade vira pergunta ao Luís.

## Review Focus (cada linha vira teste na tarefa dona)

| # | Entrada ou falha provável | Tarefa |
|---|---|---|
| S1 | Duas abas editam a mesma versão: a segunda recebe 409 `entry_stale` com `current` e nada é sobrescrito (RF23.CA02) | B3, B12 |
| S2 | Gerente sem VER_FOLHA troca a categoria para uma sensível, ou edita um sensível pelo id: 403 ou 404, nada gravado | B3 |
| S3 | Contador e conta somente leitura em toda rota de escrita: 403 (RF23.CA04) | B3, B4 |
| S4 | Edição que troca só a descrição mantém as taxas copiadas; a que troca a forma de pagamento recopia e recalcula o líquido (RF23.Obs4) | B1, B3 |
| S5 | Lote com um id de outra empresa, um sensível invisível ou um já excluído: nada é excluído | B4 |
| S6 | Restaurar no 31º dia: 404; no 30º: restaura (RF24.R2, CA02) | B4, B5 |
| S7 | Data de competência a hoje + 60 aceita, hoje + 61 recusada, "hoje" no fuso da unidade às 23h | B1 |
| S8 | Lançador excluindo em lote ou restaurando lançamento alheio: 403 ou 404 | B4 |
| S9 | `markReviewed` junto de edição: duas versões, na ordem alteração e revisão, sinais vazios | B3 |
| S10 | Enviar o formulário duas vezes seguidas (duplo clique): uma gravação só | B9 |

## Tarefas

### B1. Regras de edição do painel no core — CRÍTICA
**Create:** `packages/core/src/entry/panel-edit.ts`, `panel-edit.test.ts`; **Modify:** `packages/core/src/errors/domain-errors.ts`, `packages/core/src/index.ts`.
- [ ] ⚠️ Passo 0: localizar em `apps/api/src/modules/entries/entry-handlers.ts` a lógica da DE-18 (recopiar taxa quando forma ou canal muda). Se for função pura, mover para o `core` sem mudar comportamento e reusar; se estiver presa ao handler, extrair com os testes do canal verdes antes e depois.
**Produces:** `PANEL_FUTURE_DAYS = 60`; `preparePanelEdit(input: { entry: Entry; patch: EntryPatch (sem supplier.name); catalog: CatalogSnapshot; today: string }): Result<Partial<EntryFields>, DomainError>` que valida data futura (S7), quantidade exigida pela categoria (RF12.R4), referências existentes e ativas no catálogo, e devolve o patch com as taxas recopiadas só quando forma ou canal mudou (S4). Códigos de erro novos: `DateTooFarAhead`, `QuantityRequired`, `UnknownReference`.
- [ ] `pnpm --filter @app/core test panel-edit` e os testes do canal (`pnpm --filter @app/api test`). Sugerir commit: `feat(core): regras de edição pelo painel (RF23.R1, Obs4)`.

### B2. Leitor e gravação para a escrita — CRÍTICA
**Modify:** `packages/db/src/entry-reader.ts`, `packages/db/test/entry-reader.int.test.ts`, `packages/db/src/entry-store.ts` (só se o passo 0 pedir).
- [ ] ⚠️ Passo 0: confirmar (a) se `applyChanges` aceita duas mudanças consecutivas do mesmo lançamento numa chamada (plano B: uma versão só para edição + revisão, com os sinais zerados no mesmo patch, registrando o desvio); (b) como o canal associa ou cria fornecedor (reusar a mesma função); (c) se a composição já tem um `EntryStore` sobre o papel `app` para o painel.
**Produces:** `entryReader.load(tx, scope, ids: readonly string[], today): Promise<Array<{ entry: Entry; categoryIsSensitive: boolean }>>` (só os visíveis no recorte; inclui lixeira dentro do prazo); `entryReader.trash(tx, scope, query: TrashQuery, today): Promise<{ rows; nextCursor }>` (ordem `deleted_at` decrescente, id); `entryReader.sum(tx, ids): Promise<{ count: number; totalCents: number }>`.
**Testes:** `load` omite fora do recorte; `trash` filtra por período, unidade e autor, omite vencidos (S6) e outra empresa; `sum` confere com `SELECT sum`.
- [ ] `pnpm --filter @app/db test:int entry-reader`. Sugerir commit: `feat(db): carga de lançamentos para escrita e leitura da lixeira (RF24)`.

### B3. `PATCH /api/entries/:id` — CRÍTICA
**Modify:** `apps/api/src/http/entries/entries-routes.ts`, `entries-routes.test.ts`, `apps/api/test/entries-panel.int.test.ts`, `apps/api/src/composition.ts`.
- [ ] Fluxo: guards + `requireWritable` → body pelo `entryUpdateBodySchema` → `load` (404 se invisível) → `expectedVersion` diferente → 409 `entry_stale` com `current` → `can` para o estado antigo e o novo (S2; novo fora do alcance → 403) → fornecedor por nome associado ou criado → `preparePanelEdit` → `editEntry` (e `markEntryReviewed`, S9) com `{ actorId: userId, channel: "web", at: clock.now() }` → `applyChanges` (`false` → 409) → 200 com o detalhe. `NothingToChange` com `markReviewed` falso → 422; `markReviewed` em lançamento sem sinais e sem patch → 200 sem versão nova.
**Testes:** S1, S2, S3, S4, S9; a edição gera versão com canal `web`, antes e depois (RF23.CA03, lida por `GET /api/entries/:id`); erro de domínio → 422 com `reason`; sem `Origin` → 403 (o teste da lista de rotas de escrita ganha as rotas novas); linhas na `ROUTE_MATRIX`.
- [ ] Sugerir commit: `feat(api): edição de lançamento com versão esperada (RF23)`.

### B4. Excluir, restaurar e lote — CRÍTICA
**Modify:** os mesmos de B3.
- [ ] `DELETE /api/entries/:id` (`softDeleteEntry` com `reason`), `POST /api/entries/:id/restore` (`restoreEntry`), `POST /api/entries/batch/preview` e `/batch/delete` (papel `owner` ou `manager`, senão 403; `load` precisa devolver todos os ids e `can` valer para cada um, senão 404 e nada muda; uma chamada de `applyChanges`; a resposta devolve quantidade e soma).
**Testes:** S3, S5, S6, S8; excluído some da lista e dos totais (RF24.CA01), continua no banco com `deleted_at` (CA03); restaurado volta e o histórico mostra exclusão e restauração (CA02); `preview` igual à soma independente; motivo de 201 caracteres → 400; linhas na `ROUTE_MATRIX`.
- [ ] Sugerir commit: `feat(api): exclusão, exclusão em lote e restauração de lançamentos (RF24)`.

### B5. `GET /api/trash` — CRÍTICA
**Modify:** os mesmos de B3.
- [ ] Guards com `entry:restore`; `trashQuerySchema`; `entryReader.trash`; itens com `canRestore`.
**Testes:** contador → 403; lançador vê só os próprios; S6; outra empresa invisível; linha na `ROUTE_MATRIX`.
- [ ] Sugerir commit: `feat(api): lixeira de lançamentos (RF24)`.

### B6. Cliente web para escrita — NATIVA
**Modify:** `apps/web/lib/api/client.ts`, `client.test.ts`, `browser-client.ts` (teste), `apps/web/features/entries/entries-api.ts`, `use-entries.ts`.
**Produces:** `ApiClient.delete<T>(path, body, schema)`; `entriesApi.update`, `.remove`, `.restore`, `.batchPreview`, `.batchDelete`, `.trash`; `isEntryStale(e: unknown): EntryDetail | null`; mutações que invalidam `tenantKey(ctx, "entries")`.
**Testes:** `delete` envia corpo e `x-context`; 409 `entry_stale` **não** dispara o tratamento de `context_changed`; resposta fora do schema vira `ApiError`.
- [ ] Sugerir commit: `feat(web): cliente de escrita de lançamentos`.

### B7. Campo de dinheiro — NATIVA
**Modify:** `apps/web/lib/input-masks.ts`, `input-masks.test.ts`; **Create:** `apps/web/components/money-input.tsx`, teste.
**Produces:** `maskBRL(raw: string): string` (só formata o que foi digitado; sem `float`); `<MoneyInput value={cents | null} onChange={(cents | null) => void} />` que converte com `parseBRLInput`.
**Testes:** digitar `1234,56` mostra `1.234,56` e emite 123456 (RF23.CA01); colar `R$ 1.234,56`; apagar tudo emite `null`.
- [ ] Sugerir commit: `feat(web): campo de valor em reais com máscara (RF23.R1)`.

### B8. API falsa: escrita — HAIKU
**Modify:** `apps/web/e2e/fake-entries.mjs`, `fake-api.mjs`.
- [ ] `PATCH`, `DELETE`, `restore`, `batch/preview`, `batch/delete` e `GET /api/trash` sobre o estado em memória, no formato de A5: `expectedVersion` diferente → 409 `entry_stale` com `current`; cada escrita acrescenta uma versão; `-accountant` e `-readonly` → 403; lote só para `owner` e `manager`. Rota `POST /__reset` para o spec zerar o estado.
- [ ] `CI=true pnpm --filter @app/web test:e2e` continua verde. Sugerir commit: `test(web): API falsa com escrita de lançamentos`.

### B9. Formulário de edição no drawer — NATIVA
**Create:** `apps/web/features/entries/entry-form.tsx`, `stale-notice.tsx`, testes; **Modify:** `entry-data.tsx`.
- [ ] React Hook Form com `entryPatchSchema`; campos do RF23 (canal obrigatório em receita, pedidos só em receita, quantidade e unidade de medida exigidas quando a categoria pede, fornecedor em `Combobox` com "usar 'X' como novo fornecedor"); envia só o que mudou, com `expectedVersion`; "Marcar como revisado"; 422 aponta o campo pelo `reason`; 409 mostra "Este lançamento foi alterado por [nome] às hh:mm. Recarregar?" e, ao recarregar, a versão atual; botão desabilitado durante o envio (S10). Só aparece com `canEdit`.
**Testes:** S10; mensagem do RF23.Obs2 com nome e hora de `current`; formulário não perde o digitado no 409 de `context_changed`; contador não vê o botão Editar.
- [ ] Sugerir commit: `feat(web): edição de lançamento no painel (RF23)`.

### B10. Excluir e excluir em lote — NATIVA
**Create:** `apps/web/features/entries/delete-dialog.tsx`, `batch-bar.tsx`, testes; **Modify:** `entries-table.tsx`, `entry-card.tsx`.
- [ ] Diálogo com motivo opcional (contador de 200); seleção de linhas só na tabela do desktop e só para dono e gerente; barra "N selecionados" → confirmação com quantidade e soma vindas de `batch/preview` (RF24.Obs3); sucesso limpa a seleção; mudar filtro ou ordem também limpa.
**Testes:** a soma exibida é a do servidor; lançador não vê as caixas de seleção; seleção some ao trocar o filtro.
- [ ] Sugerir commit: `feat(web): exclusão e exclusão em lote de lançamentos (RF24)`.

### B11. Tela Lixeira — NATIVA
**Create:** `apps/web/app/(app)/lancamentos/lixeira/page.tsx`, `apps/web/features/entries/trash-view.tsx`, teste; **Modify:** `apps/web/e2e/routes.ts`, `entries-view.tsx` (botão "Lixeira" para quem tem `entry:restore`).
- [ ] Filtros na URL (período de exclusão, unidade, quem excluiu), colunas da lista mais "Excluído por", "Motivo" e "Restaurável até", botão "Restaurar", cartões no celular. `lib/routes-list.test.ts` e `e2e/routes.spec.ts` passam com a rota nova.
- [ ] Sugerir commit: `feat(web): lixeira de lançamentos com restauração (RF24)`.

### B12. E2E da escrita — NATIVA
**Create:** `apps/web/e2e/entries-write.spec.ts`.
- [ ] Editar valor e ver a versão nova no histórico; S1 com duas páginas no mesmo contexto; excluir com motivo, ver na lixeira e restaurar; lote com confirmação; `-accountant` sem botões de escrita; Pixel 7 sem rolagem horizontal no drawer e na lixeira.
- [ ] `CI=true pnpm --filter @app/web test:e2e`. Sugerir commit: `test(web): E2E de editar, excluir, restaurar e conflito de edição`.

### B13. Fechamento da F3 — NATIVA
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int` e E2E com `CI=true`; conferência do Review Focus S1 a S10.
- [ ] "Pronto quando": lançamento criado no `pnpm dev:chat`, editado no painel, histórico com WhatsApp e Painel.
- [ ] `painel.md` (F3 "Feita", desenho e planos), `andamento.md` e `pendencias.md` (fechar F2-3; manter F3-1 e F3-2), `escopo-por-fase.md` (RF22 a RF25, com a ressalva do RF25), `CLAUDE.md` da raiz ("Estado atual": F3 feita, próxima F4), `apps/web/CLAUDE.md` (rota `/lancamentos/lixeira` na tabela de rotas por estado de sessão). Preencher "Desvios do desenho aprovado". Propor, sem criar, regras, skills e hooks.
- [ ] Roteiro à mão para o Luís: editar com duas abas, excluir e restaurar, lote como gerente, tentar como contador, conferir que o gerente sem VER_FOLHA não vê salário em lista, total, histórico e origem.

## Ordem e dependências

B1 → B2 → B3 → B4 → B5 → B6, B7 → B8 → B9 → B10 → B11 → B12 → B13.

## Desvios do desenho aprovado

Nenhum no planejamento. A execução preenche (resultado dos ⚠️ de B1 e B2).

## Contagem por classe

HAIKU 1 (B8); NATIVA 7 (B6, B7, B9 a B13); CRÍTICA 5 (B1 a B5). Total 13.

## Verificação de ponta a ponta

`pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`; `CI=true pnpm --filter @app/web test:e2e`; roteiro à mão de B13 com `pnpm dev`, `pnpm dev:worker` e `pnpm dev:chat`.
