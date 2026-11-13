# F3a Lançamentos (ver): plano de implementação

> **Para quem executa:** `superpowers:subagent-driven-development` nas tarefas CRÍTICAS e `superpowers:executing-plans` nas demais; TDD em todas; passos com `- [ ]`; nunca commitar sem o Luís pedir (o último passo de cada tarefa sugere o commit). Não ler o `.env`.

**Goal:** lista, totais, filtros, ordenação, detalhe, origem (texto) e histórico de lançamentos no painel, com o recorte por papel aplicado na API.
**Architecture:** contrato Zod em `@app/core/contracts` → leitor SQL em `packages/db/src/entry-reader.ts` (funções que recebem `tx` de `withTenant`) → plugin `apps/api/src/http/entries/entries-routes.ts` → `apps/web/features/entries` com React Query e TanStack Table.
**Tech Stack:** TypeScript strict, Fastify 5, Zod 4, Drizzle, Next 16, React 19, `@tanstack/react-query`, `@tanstack/react-table`, Vitest, Testcontainers, Playwright.
**Spec:** `docs/superpowers/specs/2026-11-13-f3-lancamentos-design.md` (as referências "1.x" abaixo são seções do desenho)

## Global Constraints (F3a e F3b)

- Dinheiro: `number` inteiro em centavos no JSON; nunca `float`; a tela não soma (RNF13.R1, RF22.Obs2, D-F4).
- Datas de negócio: texto `AAAA-MM-DD`; nunca `new Date("AAAA-MM-DD")` (RNF13.R4).
- Período: padrão mês corrente; atalhos hoje, ontem, últimos 7 dias, mês corrente, mês anterior, personalizado; máximo 24 meses (RF22.R1).
- Página: `limit` padrão 50, máximo 100. Lote: até 100 ids. Motivo de exclusão: até 200 caracteres (RF24.R1). Lixeira: 30 dias (`RESTORE_WINDOW_DAYS`, DE-24). Data futura na edição: até 60 dias (RF23.R1). Busca livre: até 100 caracteres.
- Sinais: `category_to_review`, `channel_to_review`, `possible_duplicate`, `old_date` (RF22.R4).
- Ordenação: `created_at` (padrão) | `occurred_on` | `paid_on` | `amount`; `dir` `desc` (padrão) | `asc` (DD-35).
- Aviso de valores restritos na lista: "Há valores restritos que não entram nestes totais." (RF22.Obs7).
- Erros de rota de tenant: só `{ code }`, com as duas exceções de 1.7. Nada de conteúdo de mensagem, nome, e-mail ou valor em log (RNF11).
- Texto de usuário (descrição, texto original, transcrição, motivo) é renderizado como texto (RF25.R1).
- Guards na ordem de `.claude/rules/rota-de-tenant.md`; dado só dentro de `withTenant(appDb, request.panel.tenantId, ...)`.
- Testes com nomes em português; assunto novo atualiza `.claude/dicionario-testes.md`; Biome só nos arquivos tocados.
- Dependências novas: só `@tanstack/react-table`, `react-hook-form` e `@hookform/resolvers`, em `apps/web`. Qualquer outra necessidade vira pergunta ao Luís.

## Review Focus (cada linha vira teste na tarefa dona)

| # | Entrada ou falha provável | Tarefa |
|---|---|---|
| R1 | Dois lançamentos com o mesmo `created_at` até o milissegundo e microssegundos diferentes, na fronteira da página: nenhum repete nem some | A7 |
| R2 | Ordenado por valor, vários lançamentos com o mesmo valor atravessando a página: desempate por id, sem repetição | A7 |
| R3 | Gerente sem VER_FOLHA pede `categoryIds=<sensível>`: lista vazia, total zero, `hasRestricted: true` (RF06.CA02) | A7, A9 |
| R4 | Lançador manda `createdBy=<outro>` e `unitIds=<fora do acesso>` na URL: o primeiro é ignorado, o segundo dá 403 (RF22.CA03) | A4, A9 |
| R5 | Busca com `%`, `_` e `<script>`: tratada como texto literal, sem coringa e sem erro | A7 |
| R6 | Histórico de lançamento que saiu de categoria sensível, visto por gerente sem VER_FOLHA: versão antiga vem `restricted`, sem valores | A10 |
| R7 | Origem de mensagem que gerou dois lançamentos, um sensível: quem não vê sensíveis recebe `restricted: true` e nenhum texto (RF25.Obs1) | A10 |
| R8 | Cursor adulterado ou de outra ordenação: 400 `invalid_request`, nunca 500 | A9 |
| R9 | Lançamento da empresa B pedido por id com sessão da empresa A: 404 | A9, A10 |
| R10 | `"1.234,56"`, `"1234.56"`, `"450"`, `"0,1"`, `"1,234"`, `"abc"`, `"-5"`, `"1.2.3"` na conversão para centavos | A3 |

## Tarefas

### A1. Decisões, requisitos 1.14 e correções do plano — HAIKU
**Modify:** `docs/decisoes.md`, `docs/requisitos.md`, `docs/planos/painel.md`, `docs/planos/andamento.md`, `docs/planos/pendencias.md`, `docs/escopo-por-fase.md`.
- [ ] `decisoes.md`: acrescentar DD-35 e DD-36 com o texto de 1.5, no formato das linhas DD-33 e DD-34.
- [ ] `requisitos.md`: versão 1.14 (13/11/2026) no topo e no histórico de versões; RF22.Obs3 trocada e RF22.Obs7 acrescentada, com os textos exatos de 1.5.
- [ ] `painel.md`: seção F3 com `CANAL_A_REVISAR`; data de pagamento, pedidos e unidade de medida na lista e na edição; "restauração em lote" removida da tabela de rotas; tabela de rotas da F3 igual à de 1.7; frase da F13 sobre data de pagamento e pedidos removida; D-F3 e D-F4 como decididas (DD-36); nota de que o contador é MVP (linha 81); aviso da lista com o texto do RF22.Obs7.
- [ ] `andamento.md` e `pendencias.md`: fechar F0-3; tirar "base do TanStack Table (F3)" da F0-4; abrir **F3-1** (áudio e imagem do "ver origem", RF25.R2, R3, Obs2, CA02; E10) e **F3-2** (itens lidos da nota não são gravados; RF25.R3; E9/E14).
- [ ] `escopo-por-fase.md`: nota na linha do RF25 apontando F3-1.
- [ ] `CLAUDE.md` da raiz: versão dos requisitos na tabela "Onde está cada coisa" (1.14, 13/11/2026).
- [ ] Conferir com `git diff --stat` que só esses arquivos mudaram. Sugerir commit: `docs: DD-35, DD-36, requisitos 1.14 (RF22.Obs3 e Obs7) e correções da F3 no painel.md`.

### A2. Dependências e componentes de UI (⚠️) — NATIVA
**Modify:** `apps/web/package.json`, `pnpm-lock.yaml`, `packages/core/package.json`; **Create:** `apps/web/components/ui/{table,badge,skeleton,select,checkbox,tabs,dialog,alert-dialog}.tsx`, `packages/core/src/contracts/index.ts`.
- [ ] ⚠️ Passo 0: confirmar na documentação e nos tipos instalados: (a) `@tanstack/react-table` aceita React 19 e convive com o React Compiler, se estiver ligado no `next.config.ts` (plano B: `"use no memo"` no componente da tabela); (b) `@hookform/resolvers/zod` aceita Zod 4.6 (plano B: resolver próprio de 15 linhas com `safeParse`, sem o pacote); (c) o registro `base-nova` do shadcn tem os oito componentes (plano B: escrever o embrulho sobre o primitivo do `@base-ui/react`, como `sheet.tsx`); (d) o Next resolve o subcaminho `@app/core/contracts` com `transpilePackages` (plano B: exportar pelo índice raiz de `@app/core`). Registrar o resultado em "Desvios".
- [ ] `pnpm --filter @app/web add @tanstack/react-table react-hook-form @hookform/resolvers`; `pnpm dlx shadcn@latest add ...` dentro de `apps/web`, sem `--overwrite`.
- [ ] `packages/core/package.json`: `"exports": { ".": "./src/index.ts", "./contracts": "./src/contracts/index.ts" }` e `packages/core/src/contracts/index.ts` vazio exportável.
- [ ] `pnpm typecheck && pnpm --filter @app/web test` verdes. Sugerir commit: `chore(web): TanStack Table, React Hook Form e componentes de UI da F3`.

### A3. `parseBRLInput` no core — CRÍTICA
**Create:** `packages/core/src/money/parse-brl.ts`, `parse-brl.test.ts`; **Modify:** `packages/core/src/index.ts`.
**Produces:** `parseBRLInput(text: string): Result<Money, DomainError>` (falha com `InvalidAmount`). Aceita `R$` e espaços; vírgula é sempre decimal; ponto é milhar quando há vírgula ou quando separa grupos de exatamente 3 dígitos, e decimal quando é o único e tem 1 ou 2 dígitos depois; no máximo 2 casas; só aritmética inteira (sem `parseFloat` nem `Number` em texto com separador).
**Testes (R10):** `"1.234,56"`→123456 (RF23.CA01); `"1234.56"`→123456; `"450"`→45000; `"450,00"`→45000; `"0,1"`→10; `"1.234"`→123400; `"R$ 12,5"`→1250; erro em `"1,234"`, `"abc"`, `""`, `"-5"`, `"1.2.3"`, `"0"`.
- [ ] `pnpm --filter @app/core test parse-brl` verde. Sugerir commit: `feat(core): conversão de valor em reais para centavos (RF23.R1)`.

### A4. Recorte de visibilidade no core — CRÍTICA
**Create:** `packages/core/src/permissions/entry-scope.ts`, `entry-scope.test.ts`; **Modify:** `packages/core/src/index.ts`.
**Consumes:** `Actor`, `can` (`permissions.ts`).
**Produces:**
```ts
export interface EntryScope { readonly unitIds: readonly string[] | "all"; readonly ownerUserId: string | null; readonly includeSensitive: boolean }
export function entryScopeFor(input: { actor: Actor; userId: string; activeUnitId: string | "all"; requestedUnitIds?: readonly string[] }): Result<EntryScope, DomainError> // PermissionDenied se pedir unidade fora do acesso
export function entryActions(actor: Actor, entry: { unitId: string; createdBy: string; categoryIsSensitive: boolean; deleted: boolean }, userId: string): { canEdit: boolean; canDelete: boolean; canRestore: boolean }
```
**Testes:** tabela papel × caso: dono (tudo, sensível); gerente com e sem VER_FOLHA; lançador (`ownerUserId` = ele, sem sensível, nem o próprio); contador (sensível, `entryActions` tudo falso, RF23.CA04); unidade ativa específica sem filtro; filtro explícito prevalece sobre a unidade ativa; filtro com unidade fora do acesso → erro (R4); `entryActions` de lançador em lançamento alheio → tudo falso; lançamento na lixeira → só `canRestore`.
- [ ] Sugerir commit: `feat(core): recorte de visibilidade de lançamentos por ator (RF06.R3, RF22.R2, R3)`.

### A5. Contrato da API de lançamentos — CRÍTICA
**Create:** `packages/core/src/contracts/entries.ts`, `entries.test.ts`, `packages/core/src/contracts/period.ts`, `period.test.ts`; **Modify:** `contracts/index.ts`.
**Produces (Zod 4 + tipos inferidos; nomes exatos):**
- `businessDateSchema` (`AAAA-MM-DD` válido), `centsSchema` (inteiro seguro ≥ 0), `ENTRY_FLAGS`, `ENTRY_SORTS`, `ORIGIN_CHANNELS`.
- `entryListQuerySchema`: `from`, `to` (obrigatórios, `from <= to`, intervalo ≤ 24 meses), `type?`, `unitIds?`, `categoryIds?`, `supplierId?`, `paymentMethodId?`, `salesChannelId?`, `createdBy?`, `originChannel?`, `flags?`, `q?` (≤ 100), `sort` (padrão `created_at`), `dir` (padrão `desc`), `cursor?`, `limit` (padrão 50, 1 a 100). Listas aceitam valor repetido na query string (`unitIds=a&unitIds=b`).
- `entryItemSchema`: `id`, `version`, `type`, `occurredOn`, `paidOn`, `description`, `quantity`, `quantityUnit`, `orders`, `amountCents`, `feeCents`, `netCents`, `category {id,name}`, `supplier {id,name}|null`, `paymentMethod {id,name}|null`, `salesChannel {id,name}|null`, `unit {id,name}`, `createdBy {id,name}`, `originChannel`, `flags`, `createdAt`, `canEdit`, `canDelete`, `canRestore`.
- `entryListResponseSchema { items, nextCursor }`; `entryTotalsSchema { revenueCents, expenseCents, resultCents (pode ser negativo), count, hasRestricted }`.
- `entryOptionsSchema { categories[{id,name,kind,parentId,requiresQuantity}], suppliers[{id,name}], paymentMethods[{id,name}], salesChannels[{id,name}], units[{id,name}], members[{id,name}] }`.
- `entryVersionSchema { version, action, channel, changedBy {id,name}, changedAt, restricted, changes[{ field, before, after }] }` (`before`/`after`: `string | number | null`; `field` de `ENTRY_CHANGE_FIELDS`).
- `entryDetailSchema` = item + `feePercentBp`, `feeFixedCents`, `updatedAt`, `deleted { at, by {id,name}, reason, restorableUntil } | null`, `versions`.
- `entrySourceSchema { channel, kind: "text"|"audio"|"image"|"none", text, transcription, accessKey, sentBy {id,name}|null, sentAt, restricted, mediaAvailable }`.
- Escrita (usada no F3b): `entryPatchSchema` (campos do RF23, todos opcionais; `supplier: {id}|{name}|null`; `amountCents` > 0; `description` 1 a 200), `entryUpdateBodySchema { expectedVersion, patch, markReviewed }` (recusa `patch` vazio com `markReviewed` falso), `entryDeleteBodySchema { reason? ≤ 200 }`, `batchBodySchema { ids (1 a 100, sem repetidos), reason? }`, `batchPreviewSchema { count, totalCents }`, `trashQuerySchema { deletedFrom, deletedTo, unitIds?, deletedBy?, cursor?, limit }`, `trashResponseSchema { items (item + deleted), nextCursor }`, `entryStaleSchema { code: "entry_stale", current: entryDetail }`.
- `period.ts`: `PERIOD_PRESETS`, `resolvePeriod(preset, today: string): { from: string; to: string }` (aritmética sobre o texto, sem fuso).
**Testes:** padrões aplicados; intervalo de 24 meses e 1 dia recusado; `limit=101` recusado; `resolvePeriod` em virada de mês e de ano e em 29/02; `entryUpdateBodySchema` vazio recusado; ids repetidos recusados.
- [ ] `pnpm --filter @app/core test contracts` e `pnpm typecheck`. Sugerir commit: `feat(core): contrato da API de lançamentos (D-F3, D-F4)`.

### A6. Migration 0018: índices da lista e da lixeira — NATIVA
**Modify:** `packages/db/schema/entries.ts`; **Create:** `packages/db/migrations/0018_*.sql`.
- [ ] Índices `entries_created_idx (tenant_id, created_at, id)` e `entries_trash_idx (tenant_id, deleted_at) where deleted_at is not null`. `pnpm db:generate` com `--name entries_list_indexes`; revisar o SQL (só `CREATE INDEX`; nenhuma tabela, política ou grant muda, então a contagem do `schema.test.ts` fica em 26).
- [ ] `pnpm --filter @app/db test && pnpm --filter @app/db test:int`. Entregar ao Luís o comando para aplicar no banco dev (`DATABASE_ADMIN_URL` exportada, regra 6 de `tabela-nova.md`). Sugerir commit: `feat(db): índices da lista e da lixeira de lançamentos (migration 0018)`.

### A7. Leitor: lista, cursor e totais — CRÍTICA
**Create:** `packages/db/src/entry-reader.ts`, `packages/db/test/entry-reader.int.test.ts`; **Modify:** `packages/db/src/index.ts`.
**Consumes:** `EntryScope` (A4), `EntryListQuery` (A5), `parseBRLInput` (A3), `Transaction` (`client.ts`).
**Produces:**
```ts
export interface EntryRow { /* campos de entryItemSchema sem can*, mais categoryIsSensitive, createdById, deletedAt */ }
export const entryReader: {
  list(tx: Transaction, scope: EntryScope, query: EntryListQuery): Promise<{ rows: EntryRow[]; nextCursor: string | null }>; // lança InvalidCursorError
  totals(tx: Transaction, scope: EntryScope, query: EntryListQuery): Promise<{ revenueCents: number; expenseCents: number; count: number; hasRestricted: boolean }>;
}
export class InvalidCursorError extends Error {}
```
Regras: 1.6, 1.7 e 1.9 (recorte, período sobre `occurred_on`, origem pela versão 1, busca em OU, cursor com texto do Postgres, `deleted_at is null`, totais sem os sensíveis invisíveis). O cursor carrega `sort` e `dir`; diferente dos pedidos → `InvalidCursorError`.
**Testes de integração (banco real, duas empresas):** página 1 + página 2 cobrem tudo sem repetir (R1, R2, nas quatro ordenações e nos dois sentidos); lançamento inserido entre as páginas não repete nem derruba nenhum (RF22.CA04); cada filtro isolado; busca `"450,00"` (RF22.CA05), por descrição, por fornecedor e por chave de 44 dígitos; R5; R3; lançador só vê os próprios; unidade fora do recorte não aparece; lixeira fora; totais iguais a um `SELECT sum` independente escrito no teste (RF22.CA02); empresa B invisível.
- [ ] `pnpm --filter @app/db test:int entry-reader`. Atualizar `.claude/dicionario-testes.md`. Sugerir commit: `feat(db): leitor paginado e totais de lançamentos (RF22)`.

### A8. Leitor: detalhe, versões, origem e opções — CRÍTICA
**Modify:** `packages/db/src/entry-reader.ts`, `packages/db/test/entry-reader.int.test.ts`.
**Produces (no mesmo `entryReader`):**
```ts
find(tx, scope: EntryScope, id: string, today: string): Promise<EntryRow & { feePercentBp: number; feeFixedCents: number; updatedAt: string; deleted: {...} | null } | null>; // inclui lixeira com restorable_until >= today
versions(tx, entryId: string): Promise<Array<{ version: number; action: string; channel: string; changedBy: { id: string; name: string }; changedAt: string; before: unknown; after: unknown }>>;
source(tx, entryId: string): Promise<{ channel: string; kind: "text"|"audio"|"image"|"none"; text: string | null; transcription: string | null; accessKey: string | null; sentBy: { id: string; name: string } | null; sentAt: string | null; siblingsSensitive: boolean } | null>;
options(tx, scope: EntryScope): Promise<EntryOptions>;
names(tx): Promise<{ categories: Map<string, { name: string; isSensitive: boolean }>; suppliers: Map<string,string>; paymentMethods: Map<string,string>; salesChannels: Map<string,string>; units: Map<string,string> }>;
```
- [ ] ⚠️ Passo 0: confirmar se o papel `app` lê o nome em `users` (grants e políticas nas migrations). Plano B: buscar nomes pelo `access` (papel `app_auth`) já usado em `listPanelMemberships` e montar na rota.
**Testes:** `find` devolve nulo para fora do recorte, para sensível sem permissão e para lixeira vencida; `versions` em ordem crescente com criação pelo WhatsApp e alteração pelo painel (RF25.CA01); `source` de texto, de áudio (transcrição) e de imagem com chave; `siblingsSensitive` verdadeiro quando a mensagem gerou um sensível; `options` sem categoria sensível para quem não vê e `members` vazio para lançador; `UPDATE` e `DELETE` em `entry_versions` com o papel `app` são recusados (RF25.CA04; se já existir teste igual, citar o arquivo em vez de duplicar); versões e documentos fiscais da empresa B invisíveis.
- [ ] Sugerir commit: `feat(db): detalhe, versões, origem e opções de lançamentos (RF25)`.

### A9. Rotas de lista, totais e opções — CRÍTICA
**Create:** `apps/api/src/http/entries/entries-routes.ts`, `entries-routes.test.ts`, `apps/api/test/entries-panel.int.test.ts`; **Modify:** `apps/api/src/app.ts`, `apps/api/src/composition.ts`.
**Consumes:** `requirePanelContext`, `requireTenantRoute`, `requirePermission` (`panel-context.ts`); `withTenant`; `entryReader`; `entryScopeFor`, `entryActions`; schemas de A5.
**Produces:** plugin `entriesRoutes: FastifyPluginAsync<{ deps: PanelDeps & { clock: Clock } }>` com `GET /api/entries`, `/api/entries/totals`, `/api/entries/options`; helper `scopeOf(request, requestedUnitIds?)` → `EntryScope` ou resposta 403; `toItem(row, actor, userId)`; `setErrorHandler` no padrão de `panel-routes.ts:35-43`.
**Testes:** unitário (query inválida → 400; R8); integração com duas empresas e a tabela `ROUTE_MATRIX` (rota × dono, gerente, gerente sem VER_FOLHA, lançador, contador, sessão restrita, conta somente leitura → status esperado), que as tarefas seguintes ampliam; R3, R4, R9; resposta valida contra `entryListResponseSchema`; sem `X-Context` → 409.
- [ ] `pnpm --filter @app/api test entries-routes && pnpm --filter @app/api test:int entries-panel`. Sugerir commit: `feat(api): lista, totais e opções de lançamentos (RF22, F2-3)`.

### A10. Rotas de detalhe e origem, e o diff de versões — CRÍTICA
**Create:** `packages/core/src/entry/version-diff.ts`, `version-diff.test.ts`; **Modify:** `entries-routes.ts`, `entries-panel.int.test.ts`.
**Produces:** `diffVersion(before: Entry | null, after: Entry, names): { restricted: boolean; changes: Array<{ field: EntryChangeField; before: string | number | null; after: string | number | null }> }` (criação lista os campos preenchidos com `before: null`; ids viram os nomes atuais do cadastro; sensível → `restricted` é decidido por quem chama, com `includeSensitive`); rotas `GET /api/entries/:id` e `GET /api/entries/:id/source`.
**Testes:** diff de valor, de categoria (nomes), de exclusão (motivo) e de restauração; R6; R7; R9; `:id` que não é UUID → 400; texto com `<script>` volta intacto como string (RF25.CA03 fecha na tela, A14); linhas novas na `ROUTE_MATRIX`.
- [ ] Sugerir commit: `feat(api): detalhe, histórico e origem do lançamento (RF25)`.

### A11. Cliente e filtros na URL — NATIVA
**Create:** `apps/web/features/entries/entries-api.ts`, `url-filters.ts`, `url-filters.test.ts`, `use-entries.ts`.
**Produces:** `parseFilters(params: URLSearchParams, today: string): EntryListQuery` (URL inválida cai no padrão, mês corrente); `serializeFilters(q): string` (omite padrões; ida e volta estável); `entriesApi(client: ApiClient)` com `list`, `totals`, `options`, `detail`, `source`; hooks `useEntries(query)` (`useInfiniteQuery`), `useEntryTotals`, `useEntryOptions`, `useEntryDetail`, `useEntrySource`, todos com `tenantKey(ctx, "entries", ...)`.
**Testes:** ida e volta de todos os filtros; parâmetro desconhecido ou malformado ignorado; datas nunca passam por `Date`.
- [ ] Sugerir commit: `feat(web): cliente e filtros na URL dos lançamentos (RF22.Obs1)`.

### A12. API falsa: leitura de lançamentos — HAIKU
**Modify:** `apps/web/e2e/fake-api.mjs`; **Create:** `apps/web/e2e/fake-entries.mjs`.
- [ ] 60 lançamentos fixos em memória (duas unidades, um em categoria sensível "Salários", três com sinais, um com origem de áudio, um de imagem com chave de 44 dígitos, um cujo texto original contém `<script>alert(1)</script>`), gerados por laço determinístico. Rotas `GET /api/entries`, `/totals`, `/options`, `/:id`, `/:id/source` no formato de A5, com `from`, `to`, `type`, `categoryIds`, `q`, `sort`, `dir`, `cursor` (índice) e `limit`. Personas pelo cookie: `-staff` só os de `createdBy` dele; `-manager` sem o sensível e `hasRestricted: true`; `-accountant` vê tudo com `can*` falsos.
- [ ] Verificação: `CI=true pnpm --filter @app/web test:e2e` continua verde. Sugerir commit: `test(web): API falsa com leitura de lançamentos`.

### A13. Tela de lista — NATIVA
**Modify:** `apps/web/app/(app)/lancamentos/page.tsx`; **Create:** em `apps/web/features/entries/`: `entries-view.tsx`, `entries-table.tsx`, `entry-card.tsx`, `filters-bar.tsx`, `totals-bar.tsx`, `flag-badges.tsx` e testes `*.test.tsx`.
**Consumes:** hooks de A11; `formatBRL`, `formatBusinessDate` (`@/lib/format`); `resolvePeriod`; componentes de A2.
- [ ] Conforme 1.8: colunas do RF22 (pagamento só quando difere da data; líquido e canal só em receita); cabeçalhos ordenáveis com `aria-sort`; filtros em `Sheet` no celular; totais com "Há valores restritos que não entram nestes totais." quando `hasRestricted`; vazio com o texto do RF22.Obs6; erro com "Tentar de novo"; "Carregar mais"; lançador sem o filtro "Lançado por".
**Testes de componente:** mudar filtro atualiza a URL; clicar em "Valor" alterna `sort` e `dir`; totais vêm do hook (nenhuma soma na tela: o teste dá um total diferente da soma das linhas e espera o do servidor); estados vazio e erro; descrição com HTML aparece como texto.
- [ ] Sugerir commit: `feat(web): lista de lançamentos com filtros, ordenação e totais (RF22)`.

### A14. Drawer do lançamento: dados, origem e histórico — NATIVA
**Create:** `apps/web/features/entries/entry-drawer.tsx`, `entry-data.tsx`, `entry-source.tsx`, `entry-history.tsx`, `field-labels.ts` e testes.
- [ ] Abre por `?entry=<id>` (fechar remove o parâmetro; voltar do navegador fecha). Abas de 1.8. Histórico: quem, quando, canal e ação com os rótulos do RF25.R4, antes e depois por campo (dinheiro com `formatBRL`, datas com `formatBusinessDate`), versão `restricted` como "Alteração com informação restrita". 404 mostra "Lançamento não encontrado".
**Testes:** `<script>` no texto original aparece como texto e nenhum elemento `script` é criado (RF25.CA03); `restricted` não mostra conteúdo; origem de áudio mostra a transcrição e o aviso de mídia; rótulos de ação e canal.
- [ ] Sugerir commit: `feat(web): ver origem e histórico do lançamento (RF25)`.

### A15. E2E da leitura — NATIVA
**Create:** `apps/web/e2e/entries.spec.ts`.
- [ ] Casos (Desktop Chrome e Pixel 7, regras de `e2e-painel.md`): filtros de período e categoria sobrevivem a recarregar e ao botão voltar (RF22.CA01); busca "450,00"; ordenar por valor; "Carregar mais" sem repetição; `-staff` com `createdBy` de outro na URL continua vendo só os seus; `-manager` vê o aviso de valores restritos e não vê "Salários"; abrir origem e histórico; celular sem rolagem horizontal e filtros na folha lateral.
- [ ] `CI=true pnpm --filter @app/web test:e2e`. Sugerir commit: `test(web): E2E da lista, filtros, origem e histórico`.

### A16. Fechamento do F3a — NATIVA
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int` e E2E com `CI=true`; conferir cada linha do Review Focus com o teste que a cobre.
- [ ] `painel.md` (tabela: F3 "Em andamento: F3a feita"), `andamento.md` (fechar F2-3 na parte de leitura), `apps/web/CLAUDE.md` (pasta `features/entries`, regra "a tela não soma" com o teste que a prova), `.claude/rules/rota-de-tenant.md` (apontar a `ROUTE_MATRIX`). Preencher "Desvios do desenho aprovado".
- [ ] Propor, sem criar, regras ou skills para o que repetiu.
- [ ] Roteiro à mão para o Luís: `pnpm db:seed:dev`, `pnpm dev`, `pnpm dev:worker`, `pnpm dev:chat` com três lançamentos (um de salário); entrar como dono, gerente e lançador e conferir lista, totais, busca, ordenação, origem e histórico.

## Ordem e dependências

A1 → A2 → A3, A4 → A5 → A6 → A7 → A8 → A9 → A10 → A11 → A12 → A13 → A14 → A15 → A16.

## Desvios do desenho aprovado

Nenhum no planejamento. A execução preenche (resultado dos ⚠️ de A2 e A8).

## Contagem por classe

HAIKU 2 (A1, A12); NATIVA 7 (A2, A6, A11, A13 a A16); CRÍTICA 7 (A3, A4, A5, A7 a A10). Total 16.

## Verificação de ponta a ponta

`pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`; `CI=true pnpm --filter @app/web test:e2e`; roteiro à mão de A16 com `pnpm dev`, `pnpm dev:worker` e `pnpm dev:chat`.
