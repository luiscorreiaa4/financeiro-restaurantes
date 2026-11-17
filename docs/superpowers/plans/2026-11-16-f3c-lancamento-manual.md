# F3c Lançamento manual no painel: plano de implementação

> **Para quem executa:** `superpowers:subagent-driven-development` nas tarefas CRÍTICAS e `superpowers:executing-plans` nas demais; TDD em todas; passos com `- [ ]`; nunca commitar sem o Luís pedir (o último passo de cada tarefa sugere o commit). Não ler o `.env`. Verificação pelo menor conjunto que prova a mudança (skill `testes-direcionados`).

**Goal:** criar lançamento pelo painel (`/lancamentos/novo`, `POST /api/entries`) com idempotência por tentativa, sinais de duplicidade e data antiga, origem sem mensagem (versão 1, canal `web`) e "Salvar e lançar outro" (RF26).
**Architecture:** regras puras novas no `core` (`preparePanelCreate`, `isPossibleDuplicate`); gravação do painel em função própria de `packages/db` que recebe a `tx` (uma `withTenant` só para a rota inteira); contrato Zod em `@app/core/contracts`; formulário em `features/entries` com React Hook Form, `MoneyInput` e `SupplierField` da F3b. A chave `client_request_id` é coluna própria e nunca é `entries.id`.
**Tech Stack:** TypeScript strict, Fastify 5, Zod 4, Drizzle, Postgres (RLS), Next 16, React 19, `@tanstack/react-query`, `react-hook-form`, Vitest, Testcontainers, Playwright. Nenhuma dependência nova.
**Spec:** `docs/superpowers/specs/2026-11-16-f3c-lancamento-manual-design.md` (aprovado em 16/11/2026; DD-37 e requisitos 1.15 já gravados, então **não há tarefa de documento de regra**). "1.x" abaixo são seções do desenho. As tarefas "B#" são do plano da F3b (feito).

## Global Constraints

- Dinheiro: `number` inteiro em centavos, `amountCents` inteiro > 0; a tela não calcula taxa nem líquido (RF26.R1, RNF13).
- Datas de negócio `AAAA-MM-DD`, nunca `new Date("AAAA-MM-DD")`. Competência até **hoje + 60 dias** (`PANEL_FUTURE_DAYS`, "hoje" no fuso da unidade **escolhida**); mais de **60 dias** no passado (`OLD_DATE_DAYS`) grava com `old_date`. Pagamento padrão = competência (RF26.R2).
- Descrição 1 a 200 após `sanitizeDescription` (vazia depois da limpeza: `DescriptionEmpty`). Fornecedor novo: 2 a 120 caracteres (RF10.R1). Unidade de medida: `KG, G, L, ML, UN, DZ, CX, PCT, FD, SC, OUTRA` (RF12.R4).
- Duplicidade: últimas 24 h (`RECENT_WINDOW_MS`), critério atual do código (valor e fornecedor, ou descrição e data), só entre lançamentos do recorte do ator, sem sensível invisível, fora da lixeira (RF26.R4, RF12.R13).
- Respostas: **201** criado, **200** repetição, **409** `already_submitted` (repetição de lançamento hoje invisível, sem dado), **422** `{ code: "invalid_entry", reason, field? }`, **400** `invalid_request`, **403** `forbidden`/`account_read_only`. Erro só com `{ code }` (mais `reason` e `field` no 422); nada de valor, descrição ou nome em log (RNF11).
- Guards na ordem de `.claude/rules/rota-de-tenant.md` com `requireWritable()`; dado só dentro de `withTenant`; `find` com recorte e `entryDetailSchema.parse` na resposta (`sensivel-falha-fechado.md` 4 e 5).
- Nenhuma ação nova em `ACTIONS`, nenhuma tabela nova, nenhuma variável de ambiente. Uma migration só com coluna e índice (`tabela-nova.md` não se aplica; registrar a coluna em `arquitetura.md`).
- Testes com nomes em português; assunto novo atualiza `.claude/dicionario-testes.md`; Biome só nos arquivos tocados (`biome-escopo.md`).

## Review Focus (cada linha vira teste na tarefa dona)

| # | Entrada ou falha provável | Tarefa |
|---|---|---|
| R1 | Descrição só com CPF/número longo: vira vazia, responde 422 `DescriptionEmpty` com `field: description`, nada gravado | C2, C5 |
| R2 | Valor ou quantidade enormes, data `2026-02-30`, `1900-01-01`: 400/422 com código, nunca 500; `1900-01-01` grava com `old_date` | C2, C3, C5 |
| R3 | Mesma `clientRequestId` com **corpo diferente**: devolve o primeiro lançamento (200), não grava o segundo | C5 |
| R4 | Fornecedor novo com nome igual a um existente, mudando caixa ou espaços: associa o existente, não cria outro | C5 |
| R5 | Corrida de duas requisições com a mesma chave **e** fornecedor novo: um só lançamento e um só fornecedor novo (o 23505 desfaz a transação inteira) | C4a, C5 |
| R6 | Unidade de medida de lançamento antigo fora da lista (ex.: minúscula do canal) continua legível e editável | C2, C9 |
| R7 | Trocar de empresa ou unidade em outra aba no meio do preenchimento (`context_changed`): o digitado não se perde | C9 |
| R8 | Chave igual de **outro usuário** ou de **outra empresa** não colide nem revela nada | C4a, C5 |

## Desvios do desenho aprovado

- **D1 (chamada minha, conferir):** categoria sensível sem permissão responde **422 `UnknownReference`** com `field: categoryId`, igual a categoria inexistente, e não 403 como diz o desenho (1.5 e 1.13). Motivo: a F3b (B3, revisão final de segurança) já fez assim para não permitir sondar categoria sensível por id; o teste do desenho ("gerente sem VER_FOLHA e lançador com categoria sensível") passa a esperar 422 e nada gravado. 403 continua para unidade fora do acesso (RF06.R5) e para quem não tem `entry:create`.
- **D2:** `sensitiveExpression` não é exportada hoje (a regra diz que é); C4b a exporta.
- **D3:** o desenho diz "mesma função da F3b" para o fornecedor por nome; hoje isso é `findSupplier` (core) mais código solto no PATCH (`entries-routes.ts:507-532`). C5 extrai `resolveSupplierChoice` para o `core` e o PATCH passa a usá-la (testes do PATCH verdes).
- **D4:** o 422 hoje não tem `field`. C3 cria a lista fechada `ENTRY_FIELD_NAMES` e `entryErrorField`; o PATCH também passa a devolver `field` (campo opcional novo, a tela da F3b continua mapeando por `reason`).
- **D5:** a gravação não reusa `EntryStore.register` nem `applyChanges` (um é de mensagem, o outro só faz UPDATE): nova `insertPanelEntry(tx, ...)` em arquivo próprio; `EntryStore` não muda.
- **D7 (chamada minha, conferir):** na `ROUTE_MATRIX` os papéis que podem lançar esperam **422** (corpo com categoria inexistente, que chega à validação sem gravar), não 201 como diz o desenho 1.11: com 201 cada rodada da matriz gravaria quatro lançamentos e sujaria o cenário (padrão das outras escritas da matriz). O 201 fica nos testes de `entries-create.int.test.ts`.
- **D8 (chamadas minhas, textos e regras pequenas):** mensagem do 409 `already_submitted` na tela: "Este lançamento já foi enviado, mas você não pode mais vê-lo."; 403: "Você não tem permissão para lançar nesta unidade."; a chave só é trocada depois de **sucesso** (erro de rede, 5xx e 409 reenviam a mesma); data de pagamento: qualquer data válida, sem regra de ordem em relação à competência e sem teto; unidade inexistente na empresa → 422 `UnknownReference` `unitId`, existente mas fora de `actor.units` → 403; a hora da Origem é formatada em `America/Sao_Paulo` (padrão do sistema).
- **D6 (chamada minha):** teto de `quantity` no contrato (`QUANTITY_MAX`, valor a confirmar na coluna do banco no passo 0 da C3) e `SUPPLIER_NAME_MIN = 2` também na edição, o que fecha metade da F3b-2. O limite de período da lixeira (outra metade) **não** entra: segue em `andamento.md`. F3b-1 (corrida de fornecedor novo) também segue aberta; R5 só cobre a corrida da mesma chave.

## Estrutura de arquivos

| Pacote | Create | Modify |
|---|---|---|
| core | `entry/duplicate.ts`, `entry/quantity-units.ts`, `entry/panel-create.ts`, `entry/error-field.ts` e testes | `entry/build-drafts.ts`, `errors/domain-errors.ts`, `contracts/entries.ts`, `index.ts` |
| db | `migrations/0019_*.sql`, `src/panel-entry-writer.ts` | `schema/entries.ts`, `src/entry-reader.ts`, `src/entry-store.ts` (só o `loadCatalog` com `tx`), `src/schema.test.ts` não muda (sem tabela) |
| api | `test/entries-create.int.test.ts` | `src/http/entries/entries-routes.ts`, `src/modules/entries/entry-handlers.ts` (importa `RECENT_WINDOW_MS` do core), `test/support/route-matrix.ts` |
| web | `features/entries/create-form-values.ts`, `entry-create-form.tsx`, `entry-create-screen.tsx`, `app/(app)/lancamentos/novo/page.tsx`, `e2e/entries-create.spec.ts` | `entries-api.ts`, `use-entries.ts`, `entries-view.tsx`, `entries-screen.tsx`, `entry-source.tsx`, `entry-form.tsx` (unidade de medida), `entries-test-helpers.tsx`, `e2e/fake-entries.mjs`, `e2e/fake-api.mjs`, `e2e/routes.ts` |

## Tarefas

### C1. Duplicidade como função única no core — CRÍTICA
**Files:** Create `packages/core/src/entry/duplicate.ts`, `duplicate.test.ts`; Modify `build-drafts.ts` (trecho 167-176), `index.ts`, `apps/api/src/modules/entries/entry-handlers.ts:75,282,580`.
**Produces:** `RECENT_WINDOW_MS = 24*60*60*1000` (movida do handler); `RecentEntry` (mesmo tipo, movido para `duplicate.ts` e reexportado de `build-drafts.ts`); `isPossibleDuplicate(candidate: { inboundMessageId: string | null; amountCents: number; supplierId: string | null; description: string; occurredOn: string }, recent: readonly RecentEntry[]): boolean`. Regra: ignora um recente só quando os **dois** `inboundMessageId` são não nulos e iguais; o resto do critério é o do código atual (valor e fornecedor não nulo, ou `normalizeName(description)` e data).
- [ ] Teste primeiro em `duplicate.test.ts`: "dois lançamentos do painel sem mensagem se reconhecem"; "mesma mensagem não conta"; "mensagem diferente conta"; "valor igual com fornecedor nulo não conta"; "descrição igual com data diferente não conta".
- [ ] Extrair e fazer `buildDrafts` chamar `isPossibleDuplicate`; handlers importam a constante do core.
- [ ] Run: `pnpm --filter @app/core test duplicate build-drafts` e `pnpm --filter @app/api exec vitest run entry-handlers`. Expected: todos PASS (o comportamento do canal não muda).
- [ ] Sugerir commit: `refactor(core): duplicidade em função única para canal e painel (RF12.R13)`.

### C2. Regras de criação do painel no core — CRÍTICA
**Files:** Create `packages/core/src/entry/panel-create.ts`, `panel-create.test.ts`, `quantity-units.ts`; Modify `errors/domain-errors.ts` (novos `CategoryTypeMismatch{categoryId}`, `DescriptionEmpty`), `index.ts`.
**Consumes:** `sanitizeDescription`, `OLD_DATE_DAYS`, `PANEL_FUTURE_DAYS`, `resolveFeeRule`, `isPossibleDuplicate` (C1), `CatalogSnapshot`, `EntryDraft`.
**Produces:** `QUANTITY_UNITS` (tupla da lista de Global Constraints) e `type QuantityUnit`; `toQuantityUnit(raw: string): QuantityUnit | null` (ignora caixa); `type PanelCreateInput = { type; occurredOn; paidOn?: string; description; amountCents; categoryId; unitId; supplier: { id: string } | null; paymentMethodId: string | null; salesChannelId: string | null; orders: number | null; quantity: number | null; quantityUnit: QuantityUnit | null }`; `preparePanelCreate(args: { input: PanelCreateInput; catalog: CatalogSnapshot; today: string; recent: readonly RecentEntry[] }): Result<EntryDraft, PanelCreateError>` (`inboundMessageId: null`; `flags` com `old_date` e/ou `possible_duplicate`; nunca `category_to_review` nem `channel_to_review`).
- [ ] ⚠️ Passo 0: ler `normalizeUnit` (`build-drafts.ts:57`) e o que o canal grava em `quantity_unit`. Se for minúscula ou outra forma, `QUANTITY_UNITS` fica em maiúsculas e `toQuantityUnit` faz a ponte (R6); registrar em "Desvios". Conferir também o valor literal de `field` em `UnknownReference` e o campo de status da unidade no `CatalogSnapshot`.
- [ ] Testes (nomes do desenho 1.13): competência hoje+60 aceita e +61 `DateTooFarAhead` (23h30 em America/Sao_Paulo com unidade em America/Manaus); mais de 60 dias atrás grava com `old_date`; `2026-02-30` → `InvalidBusinessDate`; receita com categoria de despesa → `CategoryTypeMismatch`; receita sem canal → `SalesChannelRequired`; categoria que exige quantidade sem quantidade → `QuantityRequired`; unidade inativa → `UnitInactive`; categoria, forma ou canal inativos ou ausentes → `UnknownReference`; descrição só com CPF → `DescriptionEmpty` (R1); descrição com CPF e texto grava sem o CPF; taxa da receita vem da forma e o canal aplicativo substitui (P06); despesa tem `NO_FEE`; pagamento omitido = competência; `possible_duplicate` quando `recent` tem igual; "quantidade e unidade de medida andam juntas".
- [ ] Run: `pnpm --filter @app/core test panel-create`. Expected: PASS.
- [ ] Sugerir commit: `feat(core): regras de criação de lançamento pelo painel (RF26.R1, R2, R5)`.

### C3. Contrato da criação — CRÍTICA
**Files:** Modify `packages/core/src/contracts/entries.ts`, `contracts/entries.test.ts`; Create `packages/core/src/entry/error-field.ts`, `error-field.test.ts`; Modify `index.ts`.
**Produces:** `ENTRY_FIELD_NAMES` (`type, occurredOn, paidOn, description, amountCents, categoryId, unitId, supplier, paymentMethodId, salesChannelId, orders, quantity, quantityUnit`) e `type EntryFieldName`; `entryCreateBodySchema` (`z.strictObject`, campos e refinamentos do desenho 1.7; `clientRequestId: z.uuid()`; `quantityUnit: z.enum(QUANTITY_UNITS).nullable()`; `supplier.name` com `SUPPLIER_NAME_MIN = 2`); `type EntryCreateBody`; `entryInvalidSchema = { code: "invalid_entry", reason: string, field?: EntryFieldName }`; `entryAlreadySubmittedSchema = { code: "already_submitted" }`; `entryErrorField(error: DomainError): EntryFieldName | undefined`; `entryOptionsSchema` com campos **opcionais** `active` (categorias, formas, canais, unidades), `defaultSalesChannelId` e `timezone` (unidades), sem `isSensitive` (as categorias já trazem `kind` e `requiresQuantity`, que o formulário usa).
- [ ] ⚠️ Passo 0: confirmar a precisão da coluna `quantity` em `packages/db/schema/entries.ts` e fixar `QUANTITY_MAX` com o maior valor que a coluna aceita (convertido pela regra de `quantityToMilli`); se a coluna não limitar, `1_000_000` (D6). `InvalidBusinessDate` ganha `field?: "occurredOn" | "paidOn"` (campo opcional novo no erro) e `entryErrorField` o repassa. Mapa completo de `entryErrorField`: `DateTooFarAhead`, `InvalidBusinessDate` (pelo seu `field`, senão `occurredOn`) ; `AmountNotPositive`, `InvalidAmount`, `MoneyOverflow`, `FeeExceedsAmount` → `amountCents`; `QuantityRequired` → `quantity`; `DescriptionEmpty` → `description`; `CategoryTypeMismatch` → `categoryId`; `SalesChannelRequired` → `salesChannelId`; `InvalidOrders` → `orders`; `UnitInactive` → `unitId`; `UnknownReference` pelo seu `field` (category→`categoryId`, unit→`unitId`, supplier→`supplier`, paymentMethod→`paymentMethodId`, salesChannel→`salesChannelId`); o resto sem `field`. `entryOptionsSchema` não ganha `isSensitive`.
- [ ] Testes: corpo mínimo válido; sem `amountCents` → recusado; `amountCents: 0` e `1.5` recusados; despesa com canal ou pedidos recusada; receita sem canal recusada; quantidade sem unidade de medida e o inverso recusadas; `quantityUnit: "XX"` recusado; chave extra recusada (strict); `quantity` acima do teto recusada (R2); `entryErrorField` mapeia `DateTooFarAhead`→`occurredOn`, `QuantityRequired`→`quantity`, `DescriptionEmpty`→`description`, `CategoryTypeMismatch`→`categoryId`, `UnknownReference` pelo seu `field`. O `entryPatchSchema` ganha enum de unidade, nome de fornecedor mínimo 2 e teto de `quantity`.
- [ ] Rodar os testes de edição que quebrarem (`pnpm --filter @app/api exec vitest run entries-routes`; `pnpm --filter @app/web exec vitest run entry-form`) e corrigir só fixtures de unidade de medida inválida.
- [ ] Run: `pnpm --filter @app/core test contracts error-field` e `pnpm --filter @app/core typecheck`. Expected: PASS.
- [ ] Sugerir commit: `feat(core): contrato de criação de lançamento e campo no 422 (RF26)`.

### C4a. Migration e gravação do painel no db — CRÍTICA
**Files:** Modify `packages/db/schema/entries.ts`; Create `packages/db/migrations/0019_entries_client_request.sql` (gerar com `drizzle-kit generate --name entries_client_request`), `packages/db/src/panel-entry-writer.ts`, `packages/db/test/panel-entry-writer.int.test.ts`; Modify `packages/db/src/entry-store.ts` (extrair `loadCatalogIn(tx, tenantId)`; `loadCatalog` o chama).
**Produces:** coluna `client_request_id uuid` e índice único parcial `entries_client_request_unique (tenant_id, created_by, client_request_id) WHERE client_request_id IS NOT NULL`, CHECK `entries_origin_exclusive_check (client_request_id IS NULL OR inbound_message_id IS NULL)`; `insertPanelEntry(tx: Transaction, tenantId: string, change: EntryChange, extra: { clientRequestId: string; newSuppliers?: readonly { id: string; name: string }[] }): Promise<void>` (fornecedor novo, `entries` com `position` 0 e versão 1 com canal `web`; a chave não entra no `Entry` nem no retrato); `findByClientRequest(tx: Transaction, userId: string, clientRequestId: string): Promise<string | null>` (id); `isUniqueViolation(error: unknown, constraint: string): boolean`; `loadCatalogIn(tx: Transaction, tenantId: string): Promise<CatalogSnapshot>`.
- [ ] ⚠️ Passo 0: ver a forma do erro do driver/Drizzle para 23505 (`cause.code`, `cause.constraint_name`) e cobrir `isUniqueViolation` com teste que provoca a colisão de verdade.
- Contexto exato: `createEntry(draft: EntryDraft, ctx: { id: string; tenantId: string; actorId: string; channel: Channel; at: Date }): Result<EntryChange, EntryError>`; `EntryChange = { entry: Entry; version: ... }` (já em `entry.ts`). `insertPanelEntry` grava `created_by = change.entry.createdBy`, `tenant_id` do argumento e `position` 0.
- [ ] A migration é a 0019 (a última é a 0018). O `drizzle-kit generate` pode não emitir o índice parcial nem o CHECK: declare-os no `schema/entries.ts` (`uniqueIndex(...).where(...)`, `check(...)`) e confira o SQL; se faltarem, escreva à mão no `.sql`.
- [ ] Revisar o SQL gerado (sem `FORCE RLS`/`GRANT` novos: a tabela já os tem). Exportar `entryValues`/`versionValues` do `entry-store.ts` ou duplicar o mínimo, sem mudar o `register`.
- [ ] Testes de integração (R5, R8): dois lançamentos do painel sem mensagem não colidem; mesma chave do mesmo usuário colide (`isUniqueViolation` verdadeiro); mesma chave de outro usuário e de outra empresa não colide; CHECK recusa chave junto com mensagem; a falha do 23505 desfaz o fornecedor novo da mesma transação; versão 1 tem canal `web`; `loadCatalog` segue igual (testes do canal verdes).
- [ ] Run: `pnpm --filter @app/db test:int panel-entry-writer entry-store`; `pnpm --filter @app/db typecheck`. Expected: PASS. Registrar a coluna em `docs/arquitetura.md`.
- [ ] Sugerir commit: `feat(db): chave de tentativa e gravação de lançamento do painel (RF26.R3)`.

### C4b. Candidatos de duplicidade no recorte — CRÍTICA
**Files:** Modify `packages/db/src/entry-reader.ts` (exportar `sensitiveExpression`; novo método no `entryReader`), `packages/db/test/entry-reader.int.test.ts`.
`RecentEntry = { inboundMessageId: string | null; amountCents: number; supplierId: string | null; description: string; occurredOn: string }`; janela por `created_at`, não por `occurredOn`.
- [ ] ⚠️ Passo 0: ler `EntryScope` (`entryScopeFor`, `@app/core`) e como ele diz se inclui sensíveis; a consulta usa esse indicador.
**Produces:** `entryReader.recent(tx: Transaction, scope: EntryScope, since: Date): Promise<readonly RecentEntry[]>` — últimas 24 h por `created_at`, fora da lixeira, só unidades do recorte, `sensitiveExpression` aplicada quando o escopo não inclui sensíveis, colegas incluídos.
- [ ] Testes (spec 1.13): exclui sensível invisível; exclui outra unidade; exclui outra empresa; exclui excluído; inclui lançamento de colega na mesma unidade; exclui o criado há 25 h.
- [ ] Run: `pnpm --filter @app/db test:int entry-reader`. Expected: PASS.
- [ ] Sugerir commit: `feat(db): candidatos de duplicidade no recorte do ator (RF26.R4)`.

### C5. `POST /api/entries` — CRÍTICA
**Files:** Modify `apps/api/src/http/entries/entries-routes.ts` (rota antes do PATCH; PATCH passa a usar `resolveSupplierChoice` e a devolver `field`), `apps/api/test/support/route-matrix.ts`, `apps/api/test/entries-panel.int.test.ts` (matriz); Create `apps/api/test/entries-create.int.test.ts`; Modify `packages/core` (`resolveSupplierChoice(catalog, choice: { id: string } | { name: string } | null, newId: () => string): { supplierId: string | null; newSupplier?: { id: string; name: string } }`, em `entry/catalog.ts`, com teste).
**Consumes:** C1 a C4b, `writeGuards("entry:create")`, `deps.clock`, `deps.newId`, `can`, `entryReader.find`, `entryDetailSchema`.
- [ ] Ordem dentro do `withTenant`: chave (passo 1) → `loadCatalogIn(tx)` → unidade pelo catálogo (ausente: 422 `unitId`; fora de `actor.units`: 403) → `today = clock.today(unit.timezone)` → `entryReader.recent` → `resolveSupplierChoice` → `preparePanelCreate` → `createEntry` → `insertPanelEntry` → `find` + `entryDetailSchema.parse`. O 23505 é capturado **fora** do `withTenant` (a transação já foi desfeita), só quando `isUniqueViolation(e, "entries_client_request_unique")`; qualquer outro 23505 propaga (500, como hoje; F3b-1 segue aberta). `resolveSupplierChoice` assume nome já validado pelo contrato, associa por `findSupplier` (ignora caixa e espaços) e deixa `{ id }` inexistente para o `UnknownReference` (`supplier`) do `preparePanelCreate`.
- [ ] ⚠️ Confirmar que `GET /api/entries?originChannel=web` já existe; se não, remover esse teste e registrar em "Desvios".
- [ ] Fluxo do desenho 1.8, passos 1 a 9, em **um** `withTenant`; corpo inválido → 400; unidade fora de `actor.units` → 403; categoria sensível sem permissão ou inexistente → 422 `UnknownReference` `field: categoryId` (D1); erro de domínio → `invalidEntry(reply, error.code, entryErrorField(error))`; 23505 de `entries_client_request_unique` → transação nova só com o passo 1 e resposta 200; `find` que não enxerga → 409 `already_submitted` sem dado.
- [ ] Linha(s) na `ROUTE_MATRIX` (`POST /api/entries`): dono, gerente, gerente sem VER_FOLHA e lançador esperam o status do caso sem gravar (corpo que chega à validação e dá 422, ex.: categoria inexistente), contador 403, restrita 401, somente leitura 403, lançador sem painel 401; `body(fixture)` gera chave nova a cada chamada.
- [ ] Testes de integração (nomes do desenho 1.13 mais Review Focus): cria com 201, versão 1 com canal `web` e origem sem mensagem, `inbound_message_id` nulo; duplo envio grava um só e devolve 200 com o mesmo id; corrida de duas requisições com a mesma chave grava um só (R5); **mesma chave com corpo diferente devolve o primeiro** (R3); repetição de lançamento hoje invisível (reclassificado para sensível ou unidade retirada) responde 409 sem dado; gerente sem VER_FOLHA e lançador com categoria sensível → 422 e nada gravado; lançador em unidade fora do acesso → 403; categoria de outra empresa → 422; unidade inativa → 422; descrição só com CPF → 422 `description` (R1); `1900-01-01` grava com `old_date`, `2026-02-30` → 422, valor `9007199254740991` → 422 sem 500 (R2); fornecedor novo com nome existente em outra caixa associa o existente (R4); duas empresas: a outra não vê o lançamento (R8); sem `Origin` → 403 e nada gravado; duplicidade: segundo igual em 24 h grava com `possible_duplicate`, mas não se o igual é de sensível invisível; filtro `originChannel=web` da lista acha o lançamento.
- [ ] Run: `pnpm --filter @app/api exec vitest run entries-create entries-panel entries-routes` (Docker aberto). Expected: PASS.
- [ ] Sugerir commit: `feat(api): lançamento manual com idempotência por tentativa (RF26)`.

### C6. Opções com ativo, canal padrão e fuso — NATIVA
**Files:** Modify `packages/db/src/entry-reader.ts` (`options`, linhas ~918-965), `packages/db/test/entry-reader.int.test.ts`, `apps/api/test/entries-panel.int.test.ts`.
- [ ] ⚠️ Passo 0: ver se a F3b/F3a já trouxe algum desses campos (o recon diz que não). `options` passa a devolver `active` em categorias, formas, canais e unidades, e `defaultSalesChannelId` e `timezone` em unidades; continua listando inativos (o filtro precisa achar lançamento antigo).
- [ ] Testes: inativos vêm com `active: false`; unidade traz `timezone`; canal padrão da unidade; categoria sensível segue omitida para quem não vê (sem regressão da F3a).
- [ ] Run: `pnpm --filter @app/db test:int entry-reader` e `pnpm --filter @app/api exec vitest run entries-panel`. Sugerir commit: `feat(api): opções com ativo, canal padrão e fuso da unidade (F3c-2)`.

### C7. Cliente web e hook de criação — NATIVA
**Files:** Modify `apps/web/features/entries/entries-api.ts`, `use-entries.ts`, `entries-test-helpers.tsx` (`create: missing` em `fakeEntriesApi`), testes.
**Produces:** `EntriesApi.create(body: EntryCreateBody): Promise<EntryDetail>` (`POST /api/entries`, valida com `entryDetailSchema`); `isAlreadySubmitted(e: unknown): boolean`; `useCreateEntry()` (mutação que invalida `tenantKey(ctx, "entries")`).
- [ ] Testes: `create` envia o corpo e `x-context`; resposta fora do schema vira `ApiError`; `already_submitted` não dispara o tratamento de `context_changed`; a mutação invalida a chave de lançamentos.
- [ ] Run: `pnpm --filter @app/web exec vitest run entries-api use-entries`. Sugerir commit: `feat(web): cliente de criação de lançamento`.

### C8. API falsa do E2E: POST — HAIKU
**Files:** Modify `apps/web/e2e/fake-entries.mjs`, `fake-api.mjs` (linhas 113-125: `entry:create` em `ACTIONS_BY_ROLE` para owner, manager e staff).
- [ ] `POST /api/entries` sobre o estado em memória: 201 com o detalhe no formato de `entryDetailSchema`, canal `web`, uma versão; mesma `clientRequestId` do mesmo ator → 200 com o mesmo id; `-accountant` e `-readonly` → 403; receita calcula taxa e líquido do mesmo jeito da edição; igual em 24 h → `flags` com `possible_duplicate`; ids e datas fixos (sem `Math.random`/`Date.now`); a duplicidade na API falsa ignora o relógio: vale valor e fornecedor, ou descrição e data, entre os lançamentos que o estado já tem; a versão 1 usa o mesmo formato de versão que o `PATCH` da API falsa (canal `web`); as opções da API falsa ganham `active`, `timezone` e `defaultSalesChannelId` (C6); personas `-manager`, `-staff`, `-accountant`, `-readonly`.
- [ ] `CI=true pnpm --filter @app/web test:e2e` continua verde nas specs existentes. Sugerir commit: `test(web): API falsa com criação de lançamento`.

### C9. Formulário e página `/lancamentos/novo` — NATIVA
**Files:** Create `features/entries/create-form-values.ts`, `entry-create-form.tsx`, `entry-create-screen.tsx`, `app/(app)/lancamentos/novo/page.tsx`, testes; Modify `entries-view.tsx` e `entries-screen.tsx` (botão "Novo lançamento" no topo e no estado vazio, só com `entry:create` **e** `accountAllows(accountStatus, role).write`), `entry-form.tsx` e `entry-form-fields.tsx` (unidade de medida vira `NativeSelect` com `QUANTITY_UNITS`, também na edição; legado fora da lista aparece como opção extra, R6), `e2e/routes.ts` (`/lancamentos/novo`).
**Produces:** `initialCreateValues(options, ctx): CreateFormValues`; `buildCreateBody(values, clientRequestId: string): EntryCreateBody`; `keepForNext(values): CreateFormValues` (mantém tipo, competência e unidade); `<EntryCreateForm options onSaved />`.
- [ ] ⚠️ Passo 0: conferir o nome do campo de sinais em `entryDetailSchema` (`flags`?) e como `accountAllows(accountStatus, role)` chega ao cliente (importar de `@app/core` se existir). Plano B se `me` não trouxer a situação da conta: o botão aparece só por `entry:create` e a API recusa com 403 `account_read_only`, que a tela mostra como "Conta somente leitura: não é possível lançar."; registrar em "Desvios", sem parar; exportar `DOMAIN_ERRORS` do `entry-form.tsx` para reuso.
- [ ] Comportamento (desenho 1.10): ordem e padrões dos campos; categoria só ativa e compatível com o tipo; trocar tipo limpa categoria incompatível e, ao virar despesa, canal e pedidos; pagamento acompanha a competência até o usuário mexer; trava síncrona (`useRef`) e botões desativados no envio; chave nova por tentativa e **a mesma chave no reenvio após erro de rede**; "Salvar" vai a `/lancamentos?entry=<id>`; "Salvar e lançar outro" mantém tipo, competência e unidade, foco em Valor e região `role="status"` com valores **do servidor** ("Despesa de R$ 450,00 salva (líquido R$ 450,00)", link "Abrir", avisos de `possible_duplicate` e `old_date`); sem valor, "Informe o valor." no campo e nada enviado (CA01); 422 aponta o campo por `field`, senão por `reason`; `context_changed` mantém o digitado (R7); `PageGuard action="entry:create"`.
- [ ] Testes de componente: CA01; CA08 (mantém tipo, data e unidade, limpa o resto); CA07 (líquido do servidor, não calculado); duplo clique envia uma vez com a mesma chave; trocar para despesa limpa canal e pedidos; contador e conta somente leitura não veem o botão; 422 com `field` marca o campo; R7; descrição com CPF: a tela mostra a descrição salva pelo servidor, sem o CPF; 409 `already_submitted` mantém o digitado e a chave; R6 (edição abre lançamento com unidade `kg` sem perder o valor).
- [ ] Run: `pnpm --filter @app/web exec vitest run entry-create entries-view entry-form routes-list`; `pnpm --filter @app/web typecheck`. Sugerir commit: `feat(web): lançamento manual no painel (RF26)`.

### C10. Aba Origem para o canal web — NATIVA
**Files:** Modify `apps/web/features/entries/entry-source.tsx`, teste.
- [ ] Quando `originChannel === "web"`: "Lançado manualmente no painel por [createdBy] em dd/mm/aaaa hh:mm" a partir do detalhe (a API de origem segue `kind: "none"`); texto renderizado como texto; data com helper de `@/lib/format` (⚠️ conferir o que já formata data e hora, sem `new Date("AAAA-MM-DD")`).
- [ ] Teste: o texto exato com nome e hora; canal `whatsapp` segue igual. Run: `pnpm --filter @app/web exec vitest run entry-source`. Sugerir commit: `feat(web): origem de lançamento criado no painel (RF25.Obs3)`.

### C11. E2E — NATIVA
**Files:** Create `apps/web/e2e/entries-create.spec.ts`.
- [ ] `POST /__reset` no `beforeEach` e `afterEach`; criar e ver na lista com canal "Painel" e a criação no histórico (CA02); lançar três em sequência com "Salvar e lançar outro"; contador sem botão e `/lancamentos/novo` mostrando "Você não tem acesso a esta página"; Pixel 7 sem rolagem horizontal (`scrollWidth - clientWidth <= 0`) no formulário.
- [ ] Run: `pnpm --filter @app/web exec playwright test entries-create --project="Desktop Chrome"` e `--project="Pixel 7"`. Sugerir commit: `test(web): E2E do lançamento manual`.

### C12. Fechamento — NATIVA
- [ ] Verificação final (gatilhos da skill: contrato compartilhado e migration): `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`; `CI=true pnpm --filter @app/web test:e2e`; conferir Review Focus R1 a R8 e os CA01 a CA08.
- [ ] Docs: `painel.md` (F3c "Feita"), `andamento.md` e `pendencias.md` (fechar F3c-2 e F3b-5, F3b-2 em parte; manter F3b-1 e F3c-1), `escopo-por-fase.md` (RF26), `CLAUDE.md` da raiz ("Estado atual": F3c feita, próxima F4, conforme a tabela de `painel.md`), `apps/web/CLAUDE.md` (bloco "Lançamentos: criação"; rota `/lancamentos/novo`), `docs/arquitetura.md` (coluna), `.claude/dicionario-testes.md` (arquivos novos), `docs/planos/f3-como-testar.md` (linha da F3c). Preencher "Desvios" com o resultado dos ⚠️.
- [ ] Propor, sem criar, as cinco propostas do desenho 1.16 (regra `escrita-idempotente`, acréscimos em `sensivel-falha-fechado.md` e `tabela-nova.md`, skill de rota de escrita, hook de migration).
- [ ] Roteiro à mão para o Luís: dono lança três notas em sequência no celular; duplo clique; repetir a mesma nota (aviso de duplicidade); data de 70 dias atrás (aviso); gerente sem VER_FOLHA tentando categoria de folha; lançador em outra unidade; contador e conta somente leitura sem botão; trocar de empresa em outra aba no meio do preenchimento; ver origem e histórico com canal Painel.

## Ordem e dependências

C1 → C2 → C3 → C4a → C4b → C5 → C6 → C7 → C8 → C9 → C10 → C11 → C12. (C6 depende da C3; C8 depende da C3 e da C6; C10 não depende de ninguém.)

## Contagem por classe

CRÍTICA 6 (C1, C2, C3, C4a, C4b, C5); NATIVA 6 (C6, C7, C9, C10, C11, C12); HAIKU 1 (C8). Total 13 (o desenho previa 13 com a C0; aqui a C4 virou C4a e C4b e a C0 é este plano).

## Verificação de ponta a ponta

`pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`; `CI=true pnpm --filter @app/web test:e2e`; roteiro à mão da C12 com `pnpm dev` (aplicar antes a migration 0019 no banco de dev exportando `DATABASE_ADMIN_URL`).

## Resultado da execução (16/11/2026)

Todas as tarefas C1 a C12 feitas, sem commit (ordem do Luís). Revisão por tarefa crítica (Sonnet) e uma revisão final de segurança (Opus): nenhum Critical; um Important regrado e corrigido (teto de `orders`).

Resultado dos ⚠️ e rulings:

- **C2 ⚠️:** `normalizeUnit` do canal já grava maiúsculas e `OUTRA`, então `QUANTITY_UNITS` casa com ele; `toQuantityUnit` é só a ponte. `field` de `UnknownReference` usa `payment_method` e `sales_channel` (literais do código, não `paymentMethod`). `InvalidBusinessDate` ganhou `field?`. Quantidade sem unidade (ou o inverso) devolve `QuantityRequired`.
- **C3 ⚠️:** `QUANTITY_MAX = 99_999_999_999.999` (coluna `numeric(14,3)`). Mapa de `entryErrorField` ganhou `InvalidQuantity` → `quantity`. `ORDERS_MAX = 2_147_483_647` (revisão final: acima disso a coluna `integer` dava 500), na criação e na edição.
- **C4a ⚠️:** o driver é node-postgres; o 23505 chega como `DrizzleQueryError.cause { code, constraint }`. O `drizzle-kit` gerou o índice parcial e o CHECK sozinho. `entryValues` e `versionValues` ficaram exportados (saem pelo index do `@app/db`).
- **C4b ⚠️:** `recent` não reusa `scopeConditions` (ela filtra por autor para o lançador); aplica só unidade e sensível (`IS_SENSITIVE`). Sem LIMIT (F3c-4).
- **C5 ⚠️:** `GET /api/entries?originChannel=web` já existia. O teste da corrida com `Promise.all` não exercitava o 23505; ganhou o teste determinístico (linha do vencedor sem commit numa conexão admin), validado por mutação. Teto de dinheiro: `Number.MAX_SAFE_INTEGER` como no resto do sistema (F3c-3). D1, D7 e D8 do plano valeram.
- **C6:** as asserções antigas de `units` na API e no leitor trocaram `{id, name}` exato por campos novos.
- **C8 (Haiku):** `supplierFrom` e `settleFee` foram extraídas do PATCH da API falsa sem mudar o comportamento (os specs antigos passaram). O 403 de conta somente leitura usa `writeProblem` (`account_read_only`), como o PATCH e a API real.
- **C9 ⚠️:** a situação da conta chega em `me.context.accountStatus`; `accountAllows` vem de `@app/core` (o plano B não foi preciso). `DOMAIN_ERRORS` e `FALLBACK_ERROR` saíram de `entry-form.tsx`.
- **C10:** `EntrySource` ganhou a prop opcional `created={{ by, at }}`; hora em `America/Sao_Paulo` (`formatInstant`).
- **C11:** o `next` 16.4.3 imprime um aviso de vulnerabilidade e aborta o `next build` (`CI=true`) e a primeira subida do `next dev` (pendência F3c-6). Os E2E rodaram com `next dev` e API falsa subidos à mão, um worker, config temporária sem `webServer` (apagada): `entries-create` + `entries-write` + `entries.spec` 33 passam, 5 pulados. Com mais de um worker a API falsa (estado em memória) colide e 6 testes falham, como o `CI` (um worker) evita.
- **Revisão final (Opus), minors aceitos:** (1) unidade inexistente 422 × fora do acesso 403 (id UUID v7, D8); (2) `possible_duplicate` revela lançamento de colega ao lançador (decisão 10 do grill); fornecedor novo não passa pela limpeza de CPF e a corrida de nome novo duplica o cadastro (F3b-1, já aberta).
- **Pendências novas:** F3c-3 a F3c-7 em `docs/planos/andamento.md`.

## Contagem final por classe

CRÍTICA 6 (C1, C2, C3, C4a, C4b, C5); NATIVA 6 (C6, C7, C9, C10, C11, C12); HAIKU 1 (C8, sem reprocesso). Opus: 1 consulta (revisão final de segurança); nenhuma consulta de Opus como sênior.
