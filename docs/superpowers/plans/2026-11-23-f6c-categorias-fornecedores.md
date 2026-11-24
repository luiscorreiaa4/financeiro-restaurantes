# F6c: categorias e fornecedores, plano de implementação

> **Para quem executa:** `superpowers:subagent-driven-development` nas tarefas CRÍTICAS e `superpowers:executing-plans` nas demais; TDD; skill `testes-direcionados`; nunca commitar sem o Luís pedir; não ler o `.env`. As convenções de classe, rotas, migrations e erros são as do plano F6a (`2026-11-23-f6a-catalogos-taxas.md`). **Pré-requisito:** F6a e F6b feitas.

**Goal:** categorias do sistema iguais ao RF07.Obs2; dono cria e edita subcategorias; dono e gerente editam e mesclam fornecedores, com totais no recorte.
**Architecture:** `db/system-categories.ts` + script de realinhamento; `core/reports/indicators.ts` (grupos); `core/registry/{category.ts,supplier.ts}`; migration de fornecedores; `api/http/settings/{categories,suppliers}-routes.ts`; `web/features/settings/{categories,suppliers}/*`.
**Tech Stack:** o da F6a.
**Spec:** `docs/superpowers/specs/2026-11-23-f6-configuracoes-design.md` (RF07 e RF10; CA: RF07.CA01–CA05, RF10.CA01–CA03).

## Global Constraints
- Categoria: nome 2–60 único entre irmãs; 2 níveis; pai da subcategoria é do sistema; tipo, grupo, sensível e exige quantidade herdados; natureza só em despesa; palavras de apoio ≤ 30, ≤ 40 caracteres; trocar o pai é proibido (RF07).
- Sensível falha fechado (`.claude/rules/sensivel-falha-fechado.md`): gerente sem VER_FOLHA e lançador nunca recebem categoria sensível, nem valor de folha no total do fornecedor.
- Fornecedor: nome 2–120; apelidos ≤ 10; documento com dígitos válidos, único na empresa; CPF mascarado para quem não é dono nem tem `export:data` (RF10.R2, CA03).
- Mesclagem: todos os lançamentos da origem passam ao destino com versão cada (CA02); teto de 5.000.
- Evals da extração não podem cair (`pnpm --filter @app/ai eval`).

## Review Focus (cada linha vira teste na tarefa dona)
1. Gerente sem VER_FOLHA pede `GET /api/settings/categories?search=sal` → nada de "Salários" nem de subcategoria dela (C5).
2. Fornecedor com lançamentos só de folha: total do gerente sem VER_FOLHA é zero e a última compra é nula (C6).
3. Mesclar A em B e, depois, o WhatsApp manda "paguei 50 pro A" → o lançamento vai para B, sem criar fornecedor (C3/C4).
4. Mesclagem com lançamento na lixeira → ele muda de fornecedor e, restaurado, aparece no destino (C6).
5. Script de realinhamento rodado duas vezes → a segunda não cria versão nem categoria (C1).

## Desvios do desenho aprovado
Nenhum.

## Tarefas

### C1. Categorias do sistema realinhadas — CRÍTICA (dados)
**Modify:** `packages/db/src/system-categories.ts` (lista do RF07.Obs2, todas no 1º nível, `kind` com `deduction` e `investment`, natureza e grupo do RF07.R4/R5), `packages/core/src/reports/indicators.ts` (`DRE_GROUP_LABELS` com os 11 grupos do RF07.R5; `manutencao`/`outras` → `operacionais`), `packages/db/src/dev-seed.ts`, referências de nome em `apps/api/src/http/reports/reports-routes.ts` e `apps/web/e2e/fake-*.mjs`. **Create:** `packages/db/src/realign-system-categories.ts` (de-para do desenho, chamada minha 6) + script `db:realign-categories` no `package.json` da raiz e do `db`, teste de integração.
- [ ] ⚠️ Passo 0: listar todo uso de nome de categoria fora de `docs/` (`Grep` por "Salão", "Insumos", "Folha de pagamento", "Balcão", "Delivery", "receita_bruta", incluindo testes) e conferir a lista do levantamento (`system-categories.ts`, `dev-seed.ts`, `signup-defaults.ts`, `build-drafts.ts`, `catalog-types.ts`, `packages/ai/src/evals/*`, `reports-routes.ts`, `fake-*.mjs`, migrations 0008 e 0009).
- [ ] Testes: Review Focus 5; lançamento em "Balcão" passa a "Vendas" com versão `system` e o canal intacto; "Folha de pagamento" → "Salários" segue sensível; categoria antiga fica inativa; dashboard (`reportReader`) agrupa pelos grupos novos.
- [ ] Run: `pnpm --filter @app/db test:int -- realign` e `pnpm --filter @app/core exec vitest run reports`. Commit: `feat(db): categorias do sistema conforme RF07`.

### C2. Evals da extração — NATIVA
**Modify:** `packages/ai/src/evals/context.ts` (categorias novas), `packages/ai/src/evals/dataset.jsonl` (esperados que citam categoria antiga).
- [ ] Avisar o Luís antes (gasta crédito). Rodar `pnpm --filter @app/ai eval`. Taxa igual ou maior que o baseline; se cair, parar e relatar, sem mexer no prompt sozinho. Commit: `test(ai): evals com as categorias novas`.

### C3. Domínio de subcategoria e fornecedor — CRÍTICA
**Create:** `packages/core/src/registry/supplier.ts` + teste. **Modify:** `registry/category.ts`, `entry/catalog.ts` (`findSupplier` ignora `mergedIntoId !== null`), `entry/entry.ts` (nova `reassignSupplier(entry: Entry, supplierId: string, ctx: ChangeContext): Result<EntryChange, DomainError>`, aceita excluído, versão `update`).
**Produces:** `validateSubcategoryPatch(current: Category, patch: SubcategoryPatch, siblings): Result<…>` (`ParentChangeForbidden`, `SystemCategoryReadOnly`, `NatureOnlyForExpense`, sensível não se desmarca); `isValidCpf(digits: string): boolean`; `normalizeDocument(text: string): Result<{ kind: "cpf" | "cnpj"; digits: string }, DomainError>`; `maskCpf(digits: string): string` ("•••.•••.789-01"); `validateSupplierPatch(…)`; `planSupplierMerge(source: Supplier, target: Supplier): Result<{ target: { aliases: string[]; document: string | null }; source: { status: "inactive"; mergedIntoId: string } }, DomainError>` (`AliasesOverflow`, `DocumentConflict`, `SameSupplier`, `AlreadyMerged`).
- [ ] Testes: RF07.CA01–CA03; CPF válido e inválido; apelidos somados com o nome da origem e sem repetir; 11 apelidos → `AliasesOverflow`; `reassignSupplier` em excluído.
- [ ] Run: `pnpm --filter @app/core exec vitest run registry entry/entry`. Commit: `feat(core): subcategorias e fornecedores`.

### C4. Migration de fornecedores e origem — CRÍTICA (RLS, escrita do canal)
**Create:** migration `0025_supplier_status_merge.sql` (`0026` se o plano B da B4 usou a 0025). **Modify:** `packages/db/schema/catalog.ts` (`status` default `active` com CHECK; `merged_into_id` com FK composta `(tenant_id, merged_into_id)`; `origin` nulo com CHECK `message|invoice|panel|import`; CHECK apelidos ≤ 10; índice único parcial `(tenant_id, document) WHERE document IS NOT NULL AND merged_into_id IS NULL`; índice de nome `suppliers_tenant_name_norm_unique` recriado com `WHERE merged_into_id IS NULL`), `entry-store.ts:330` e `:384` (`origin: "message"`), `panel-entry-writer.ts:24` (`origin: "panel"`), leitores de catálogo do canal e do painel (trazem `mergedIntoId`; opções escondem mesclados).
- [ ] Seguir `.claude/rules/tabela-nova.md` (índices parciais declarados no schema, SQL revisado, fixtures).
- [ ] Testes: Review Focus 3; documento repetido na empresa → 23505; dois fornecedores com o mesmo nome, um mesclado → aceito; fornecedor novo do painel grava `panel`.
- [ ] Run: `pnpm --filter @app/db test:int` e `pnpm --filter @app/api test:int -- entries-create`. Commit: `feat(db): status, mesclagem e origem do fornecedor`.

### C5. Categorias: permissão, repositório e rotas — CRÍTICA (sensível)
**Create:** `packages/db/src/categories-settings-repo.ts`, `apps/api/src/http/settings/categories-routes.ts`, testes. **Modify:** `route-matrix.ts`, `app.ts`, `composition.ts`.
**Produces:** `GET /api/settings/categories?search&kind&status` (árvore; `catalog:view`; sensível só com `includeSensitive` do escopo, com `sensitiveExpression`/`is_sensitive is not false`), `POST /api/settings/categories` (subcategoria; `catalog:manage`; pai lido sob RLS, regra 7 da `tabela-nova.md`), `PATCH /api/settings/categories/:id`. Auditoria.
- [ ] Testes: Review Focus 1; contador vê sensível (DD-04); pai de outra empresa → 422; pai do sistema editado → 422 (CA01); busca por palavra de apoio.
- [ ] Run: `pnpm --filter @app/api test:int -- settings-categories`. Commit: `feat(api): subcategorias`.

### C6. Fornecedores: permissões, repositório e rotas — CRÍTICA (permissões, dinheiro)
**Create:** `packages/db/src/suppliers-settings-repo.ts`, `apps/api/src/http/settings/suppliers-routes.ts`, testes. **Modify:** `packages/core/src/permissions/permissions.ts` (`supplier:view` dono, gerente e contador; `supplier:manage` dono e gerente) + teste da matriz, `apps/web/e2e/fake-api.mjs` (`ACTIONS_BY_ROLE`), `route-matrix.ts`, `app.ts`, `composition.ts`.
**Produces:** `GET /api/settings/suppliers?search&status&from&to` (total gasto e última compra somados pelo banco no recorte do ator: unidades e `sensitiveExpression`; padrão mês corrente; sem mesclados), `PATCH /:id`, `POST /:id/merge/preview` (`{ visibleEntries }`), `POST /:id/merge` (`{ targetId }`; trava os dois e os lançamentos com `FOR UPDATE`; teto 5.000 → 422 `merge_too_large`; `reassignSupplier` por lançamento; `entry_versions` por lançamento; auditoria).
- [ ] Testes: Review Focus 2 e 4; RF10.CA02, CA03; gerente mescla com lançamento de unidade que não vê → movido, e a prévia não o conta; documento de outra empresa igual → aceito (único por empresa); lançador 403.
- [ ] Run: `pnpm --filter @app/core exec vitest run permissions` e `pnpm --filter @app/api test:int -- settings-suppliers`. Commit: `feat(api): fornecedores com mesclagem`.

### C7. Web: categorias — NATIVA
**Create:** `features/settings/categories/*`, `app/(app)/configuracoes/categorias/page.tsx`.
- [ ] Árvore com busca e filtros; do sistema com selo e somente leitura; nova subcategoria mostra o que herda (tipo, grupo, sensível, exige quantidade); natureza só em despesa; sem campo de pai na edição.
- [ ] Testes: herança exibida (CA02); sensível exibida travada (CA03). Commit: `feat(web): categorias`.

### C8. Web: fornecedores — NATIVA
**Create:** `features/settings/suppliers/*`, `app/(app)/configuracoes/fornecedores/page.tsx`.
- [ ] Lista com total e última compra (`formatBRL`, valor do servidor), período na URL; edição; mesclar: escolhe o destino, prévia com o aviso "lançamentos que você não vê também passam para o destino", confirmação.
- [ ] Testes: CPF mascarado vem do servidor (a tela não mascara); gerente vê "Mesclar". Commit: `feat(web): fornecedores e mesclagem`.

### C9. API falsa: categorias e fornecedores — HAIKU
**Modify:** `fake-settings.mjs` (árvore com as categorias do RF07.Obs2, "Salários" sensível escondida para `manager`; fornecedores com total fixo; mesclagem em memória). Specs existentes verdes. Commit: `test(web): API falsa de categorias e fornecedores`.

### C10. E2E — NATIVA
**Create:** `apps/web/e2e/settings-categories-suppliers.spec.ts`: dono cria "Frutos do mar" em Carnes; gerente não vê "Salários"; gerente mescla dois fornecedores; celular sem rolagem; axe. Commit: `test(web): E2E de categorias e fornecedores`.

### C11. Fechamento da F6 — NATIVA
- [ ] `pnpm typecheck && pnpm lint && pnpm test`, `CI=true pnpm --filter @app/web test:e2e`, conferir todos os CAs da F6.
- [ ] `painel.md` (F6 feita, F6a/b/c), `andamento.md`, `pendencias.md`, `arquitetura.md` (divergências fechadas), `CLAUDE.md` "Estado atual" (próxima etapa F7); roteiro à mão completo em `docs/planos/f6-roteiro.md` (seção F6c: rodar `pnpm db:realign-categories` no banco dev; criar subcategoria e lançar nela pelo `dev:chat`; mesclar e mandar mensagem com o nome antigo).
- [ ] Propor (sem criar) regras, skills, hooks ou `CLAUDE.md` de módulo (candidata: skill "nova tela de configuração" se A10/A11/B6/C7/C8 repetiram o mesmo molde). Commit: `docs: F6 feita`.

**Contagem F6c:** HAIKU 1 · NATIVA 5 · CRÍTICA 5 (11 tarefas).

## Ordem e dependências
C1 → C2 → C3 → C4 → (C5, C6) → (C7, C8) → C9 → C10 → C11.

**Total da F6:** 37 tarefas: HAIKU 6 · NATIVA 15 · CRÍTICA 16.

## Verificação de ponta a ponta
Por tarefa, o comando de cada uma (skill `testes-direcionados`). Por subetapa: `pnpm typecheck && pnpm lint && pnpm test`, `pnpm --filter @app/db test:int`, `pnpm --filter @app/api test:int`, `CI=true pnpm --filter @app/web test:e2e`. À mão (Luís): `pnpm dev` + `pnpm dev:worker` + `pnpm dev:chat` com `pnpm db:seed:dev`; roteiros de A16, B10 e C11 em `docs/planos/f6-roteiro.md`.
