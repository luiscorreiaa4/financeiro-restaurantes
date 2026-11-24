# F6a: formas, canais, unidades, assistente e reaplicação de taxa, plano de implementação

> **Para quem executa:** `superpowers:subagent-driven-development` nas tarefas CRÍTICAS e `superpowers:executing-plans` nas demais; TDD; skill `testes-direcionados` para escolher o que rodar; nunca commitar sem o Luís pedir; não ler o `.env`.

**Convenções (valem para F6a, F6b e F6c):**
- Classe no título: **HAIKU** (mecânica, nomes e comportamento fixados aqui), **NATIVA** (Sonnet sem subagente), **CRÍTICA** (subagente com revisor: permissão, RLS, sessão, dinheiro, contrato compartilhado).
- Toda rota nova: guardas na ordem de `.claude/rules/rota-de-tenant.md`, um `withTenant`, teste com duas empresas e linha na `ROUTE_MATRIX` (`apps/api/test/support/route-matrix.ts`). Toda migration: `.claude/rules/tabela-nova.md`. Toda página nova: `APP_ROUTES` (`apps/web/e2e/routes.ts`). Biome só nos arquivos tocados (`.claude/rules/biome-escopo.md`).
- Erros de domínio novos entram na união `DomainError` do `core` e no mapa de textos da tela (padrão `DOMAIN_ERRORS`). HTTP: 409 `{ code: "name_taken" | "already_member" | "reapply_in_progress" }`; 422 `{ code: "validation", field, reason }` com `reason` em snake_case.

**Goal:** o dono configura formas de pagamento, canais e unidades, vê o líquido calculado pelo servidor, reaplica uma taxa a um período passado e passa pelo assistente inicial; gerente e contador só consultam.
**Architecture:** `core` (validadores em `registry/`, `money/percent.ts`, `entry/fee-reapply.ts`), contrato `contracts/settings.ts`; `db` (`catalog-settings-repo.ts`, `unit-settings-repo.ts`, `fee-reapply-repo.ts`, migration 0023); `api` (`http/settings/*`, `modules/fee-reapply/*`, worker); `web` (`features/settings/*`, `app/(app)/configuracoes/*`).
**Tech Stack:** TypeScript strict, Fastify + Zod, Drizzle, pg-boss, Next.js App Router, TanStack Query, React Hook Form, Vitest, Testcontainers, Playwright.
**Spec:** `docs/superpowers/specs/2026-11-23-f6-configuracoes-design.md` (RF04, RF08, RF09, RF01.Obs3, RF04.R6; CA: RF04.CA01–CA05, RF08.CA01–CA05, RF09.CA01–CA03).

## Global Constraints
- Taxa: 0–10000 bp (RF08.R3, CA05 recusa 120 %); taxa fixa inteiro ≥ 0 em centavos; nunca float; `computeFee` e `resolveFeeRule` são as únicas contas.
- Nomes de forma e canal 2–40, únicos sem caixa nem acento; apelidos ≤ 10. Unidade: nome 2–60; apelidos ≤ 5, ≤ 30 caracteres, únicos entre nomes e apelidos das unidades da empresa (RF04.R1, R2).
- Mudar taxa não recalcula lançamento (RF08.CA03); só a reaplicação explícita, com versão `web` por lançamento.
- Não se inativa a última unidade ativa (RF04.CA02). Gerente e contador recebem 403 em toda escrita (RF04.CA05).
- "Não informada"/"Não informado" (`NOT_INFORMED_PAYMENT_METHOD`, `NOT_INFORMED_SALES_CHANNEL` em `packages/core/src/registry/catalog-types.ts:25-26`) são somente leitura.

## Review Focus (cada linha vira teste na tarefa dona)
1. Gerente manda `PATCH` de forma com o `x-context` de outra empresa em que é dono → grava só na empresa do contexto, e a matriz confirma 403 na empresa em que é gerente (A5).
2. Duas formas marcadas como cartão padrão em requisições paralelas → no fim há exatamente uma (índice único parcial + `FOR UPDATE`) (A4).
3. Reaplicação com lançamento editado pelo painel entre a prévia e o job → o job não sobrescreve a edição (guarda de versão), conta como pulado ou recalcula sobre a versão nova (A8).
4. Reaplicação de forma "Crédito" sobre receita no canal iFood com comissão > 0 → lançamento não muda (P06: a comissão manda) (A7).
5. Sessão restrita tenta reativar unidade de empresa em que é só gerente, ou id de unidade de outra empresa → 404 sem revelar (A9).

## Desvios do desenho aprovado
Nenhum.

## Tarefas

### A1. Decisões e requisitos — HAIKU (PRIMEIRA tarefa)
**Modify:** `docs/decisoes.md`, `docs/requisitos.md` (versão 1.21, 23/11/2026), `docs/planos/painel.md`, `docs/arquitetura.md`, `docs/planos/andamento.md`, `docs/planos/pendencias.md`.
- [ ] `decisoes.md`: **DD-43** (F6 em três subetapas; rotas `/api/settings/*`; repetição pela chave natural; histórico de cadastro só em `audit_log`, sem tela; `display_name` por vínculo; encerrar sessões do usuário em todas as empresas ao reduzir acesso; reaplicação de taxa em fila com taxa conferida no job; gerente mescla fornecedor sem ver o fora do recorte; categorias do sistema realinhadas ao RF07.Obs2; `supplier:view` e `supplier:manage`). Uma linha de porquê para cada item, copiando as "Chamadas minhas" 1–14 do desenho.
- [ ] `requisitos.md`: subir para 1.21; nota em RF08.Obs2 e RF09.Obs2 ("Não informada" e "Não informado" continuam como cadastros do sistema, somente leitura, taxa zero, DD-43); nota em RF10.Obs1 (`supplier:manage` para Dono e Gerente; mesclagem atinge todos os lançamentos da empresa, prévia no recorte); nota em RF05.R2 (nome exibido por vínculo, `display_name`); linha de fornecedores na matriz 2.3 (Dono e Gerente: editar e mesclar; Contador: consulta).
- [ ] `painel.md`: tabela de progresso com F6a, F6b e F6c "A fazer"; rotas da seção de API trocadas para `/api/settings/*`. `arquitetura.md`: divergências de `suppliers` e `categories` apontando para F6c. `andamento.md` + `pendencias.md`: pendência nova "tela de histórico de cadastro" (sem etapa) e F2-2/F2-4 apontando para F6a/F6b.
- [ ] Sugerir commit: `docs: decisões da F6 (DD-43) e requisitos 1.21`.

### A2. Domínio de forma e canal — NATIVA
**Create:** `packages/core/src/registry/names.ts`, `payment-method.ts`, `sales-channel.ts`, `packages/core/src/money/percent.ts`, testes ao lado. **Modify:** `packages/core/src/errors` (união `DomainError`), `packages/core/src/index.ts`.
**Produces:**
- `validateCatalogName(value: string, bounds: { min: number; max: number }): Result<string, DomainError>` (apara; `InvalidName`).
- `validateAliases(values: readonly string[], bounds: { max: number; maxLength: number }): Result<string[], DomainError>` (apara, descarta vazio, deduplica pelo normalizado; `AliasesTooMany`, `AliasTooLong`).
- `findNameCollision(candidate: { id?: string; name: string; aliases: readonly string[] }, existing: readonly { id: string; name: string; aliases: readonly string[] }[]): string | null` (compara com `normalizeName`, ignora o próprio id).
- `parsePercentToBp(text: string): Result<number, DomainError>` ("3,2" → 320, "3,25" → 325, "100" → 10000, "120" → `InvalidFeeRate`, mais de 2 casas → `InvalidFeeRate`) e `formatBp(bp: number): string` (320 → "3,20 %").
- `validatePaymentMethod(input: PaymentMethodInput, ctx: { existing: readonly CatalogRow[]; currentName?: string }): Result<PaymentMethodInput, DomainError>`; `PaymentMethodInput = { name; type: PaymentMethodType; feePercentBp; feeFixedCents; aliases; status: "active" | "inactive"; isDefaultCard }`. Regras: `DefaultCardType` (cartão padrão só `credit`/`debit`), `DefaultCardInactive`, `SystemCatalogReadOnly` quando `currentName` é o protegido, `NameTaken`.
- `validateSalesChannel(input: SalesChannelInput, ctx)` igual, sem taxa fixa e sem cartão padrão.
- `isProtectedCatalogName(kind: "payment_method" | "sales_channel", name: string): boolean`.
- [ ] Testes: RF08.CA05 (120 % recusado); "centro"/"Centro" colidem; apelido de outra forma colide com nome; 11 apelidos recusados; cartão padrão em PIX recusado; editar "Não informada" recusado; `parsePercentToBp` nos casos acima.
- [ ] Run: `pnpm --filter @app/core exec vitest run registry money/percent`. Sugerir commit: `feat(core): validação de formas e canais`.

### A3. Contrato de configurações (F6a) — CRÍTICA (contrato compartilhado)
**Create:** `packages/core/src/contracts/settings.ts` + teste. **Modify:** `packages/core/src/contracts/index.ts`.
**Produces** (todos `.strict()`; dinheiro `number` inteiro): `paymentMethodSettingsSchema` (`id, name, type, feePercentBp, feeFixedCents, aliases, status, isDefaultCard, protected`), `paymentMethodInputSchema`, `paymentMethodPatchSchema` (parcial), `salesChannelSettingsSchema` / `InputSchema` / `PatchSchema`, `unitSettingsSchema` (`id, name, aliases, cnpj, uf, city, timezone, status, defaultSalesChannelId, onlyUnitMemberCount`), `unitInputSchema`, `unitPatchSchema`, `feePreviewSchema` (`grossCents: 10000, feeCents, netCents`), `feeReapplicationPreviewInputSchema` (`targetKind, targetId, from, to`), `feeReapplicationPreviewSchema` (`matched, deltaNetCents, feePercentBp, feeFixedCents`), `feeReapplicationInputSchema` (preview input + `clientRequestId: uuid`), `feeReapplicationSchema` (`id, targetKind, targetId, from, to, status, errorCode, matched, updated, skipped, createdAt, finishedAt`), `restrictedUnitsSchema` (`{ units: { id, name, tenantName }[] }`).
- [ ] Testes: campo extra recusado; `feePercentBp` 10001 recusado; `deltaNetCents` negativo aceito; `from > to` recusado.
- [ ] Run: `pnpm --filter @app/core exec vitest run contracts/settings`. Sugerir commit: `feat(core): contrato de configurações`.

### A4. Repositório de formas e canais — CRÍTICA (RLS)
**Create:** `packages/db/src/catalog-settings-repo.ts`, `packages/db/test/catalog-settings-repo.int.test.ts`.
**Consumes:** A2, A3, `withTenant`, `auditLog`.
**Produces:** `createCatalogSettingsRepo(db): { listPaymentMethods(tenantId, f: { type?; status? }); createPaymentMethod(tenantId, actorId, input); updatePaymentMethod(tenantId, actorId, id, patch): Promise<Result<PaymentMethodSettings, DomainError> | null>; listSalesChannels; createSalesChannel; updateSalesChannel }`. Atualização: lê com `FOR UPDATE`, chama o validador do `core`, desmarca o cartão padrão anterior na mesma transação, recusa inativar canal que é padrão de unidade (`ChannelIsUnitDefault`), grava `audit_log` (`payment_method.update`, `{ before, after }` só do que mudou). 23505 do nome vira `NameTaken`.
- [ ] Testes (duas empresas): A não vê nem altera forma de B (id de B → `null`); cartão padrão único com duas atualizações em paralelo (Review Focus 2); auditoria tem `before`/`after`; inativar canal padrão de unidade recusado.
- [ ] Run: `pnpm --filter @app/db test:int -- catalog-settings-repo`. Sugerir commit: `feat(db): repositório de formas e canais`.

### A5. Rotas de formas, canais e prévia — CRÍTICA (permissões)
**Create:** `apps/api/src/http/settings/catalog-routes.ts` + `.test.ts`, `apps/api/test/settings-catalog.int.test.ts`. **Modify:** `apps/api/src/app.ts`, `composition.ts`, `apps/api/test/support/route-matrix.ts`.
**Produces:** `GET|POST /api/settings/payment-methods`, `PATCH /api/settings/payment-methods/:id`, idem `sales-channels`, `GET /api/settings/fee-preview?feePercentBp&feeFixedCents` (calcula `computeFee(10000, …)`). Leitura `catalog:view`; escrita `catalog:manage` + `requireWritable()`.
- [ ] Testes: matriz (dono 200/201; gerente, contador 200 na leitura e 403 na escrita; lançador 403; restrita 401); Review Focus 1; prévia de RF08.CA01 (320 → 320/9680) e CA02 (325 bp não se aplica a 10000; testar no `core` com 1010 → 33); resposta passa pelo `parse` do contrato.
- [ ] Run: `pnpm --filter @app/api test:int -- settings-catalog`. Sugerir commit: `feat(api): rotas de formas, canais e prévia de taxa`.

### A6. Unidades: domínio, repositório e rotas — CRÍTICA
**Create:** `packages/db/src/unit-settings-repo.ts`, `apps/api/src/http/settings/units-routes.ts`, testes de integração. **Modify:** `packages/core/src/registry/unit.ts` (`validateUnitAliases` com colisão entre unidades), `route-matrix.ts`, `app.ts`, `composition.ts`.
**Produces:** `GET|POST /api/settings/units`, `PATCH /api/settings/units/:id`, `POST /api/settings/units/:id/deactivate`, `/reactivate`. Repositório com `FOR UPDATE` em todas as unidades da empresa ao inativar (`ensureNotLastActiveUnit`), canal padrão só ativo e não protegido, `onlyUnitMemberCount` (colaboradores ativos sem TODAS cuja única unidade é esta), auditoria.
- [ ] Testes: RF04.CA01, CA02, CA05; apelido igual a nome de outra unidade recusado; canal padrão de outra empresa → 422 (`UnknownReference`); trocar fuso não muda `occurred_on` de lançamento existente; duas inativações paralelas das duas últimas ativas → uma recusada.
- [ ] Run: `pnpm --filter @app/core exec vitest run registry/unit` e `pnpm --filter @app/api test:int -- settings-units`. Sugerir commit: `feat(api): gestão de unidades`.

### A7. Reaplicação: tabela e cálculo — CRÍTICA (dinheiro, RLS)
**Create:** migration `packages/db/migrations/0023_fee_reapplications.sql` (via `drizzle-kit generate --name fee_reapplications`), `packages/db/schema/fee-reapplications.ts`, `packages/core/src/entry/fee-reapply.ts` + teste. **Modify:** `packages/db/schema/index.ts`, `packages/db/test/fixtures.ts`, `packages/db/src/schema.test.ts` (27 → 28).
**Tabela:** `id`, `tenant_id`, `target_kind` (`payment_method`|`sales_channel`), `target_id`, `from_date`, `to_date`, `fee_percent_bp`, `fee_fixed_cents` (bigint), `status` (`queued`|`running`|`done`|`failed`), `error_code`, `matched`, `updated`, `skipped`, `created_by`, `client_request_id`, `created_at`, `finished_at`. Únicos parciais: `(tenant_id, created_by, client_request_id)`; `(tenant_id, target_kind, target_id) WHERE status in ('queued','running')`. CHECK `to_date >= from_date` e `to_date - from_date <= 366`. RLS `tenantIsolation`, `FORCE RLS`.
**Produces:** `planFeeReapplication(entries: readonly Entry[], catalog: { paymentMethods: ReadonlyMap<string, FeeSource>; salesChannels: ReadonlyMap<string, FeeSource & { type }> }, ctx: ChangeContext): { changes: EntryChange[]; matched: number; deltaNetCents: Money }`: só receita não excluída; regra por `resolveFeeRule`; igual à do lançamento → pula; senão `editEntry(entry, { feePercentBp, feeFixedCents }, ctx)`; soma com as funções de `money`.
- [ ] Testes: Review Focus 4; RF08.CA04 (despesa nunca muda); 320 bp em receita de 10000 com taxa antiga 0 → delta −320; lançamento excluído ignorado; idempotência (rodar sobre o resultado não gera mudança).
- [ ] Run: `pnpm --filter @app/core exec vitest run fee-reapply` e `pnpm --filter @app/db test:int`. Sugerir commit: `feat: tabela e cálculo da reaplicação de taxa`.

### A8. Reaplicação: rotas e job — CRÍTICA (dinheiro; usar a skill `novo-worker-pgboss`)
**Create:** `packages/db/src/fee-reapply-repo.ts`, `apps/api/src/modules/fee-reapply/{queues.ts,run-fee-reapply.ts}`, `apps/api/src/infra/fee-reapply-worker.ts`, `apps/api/src/http/settings/fee-reapply-routes.ts`, testes de integração. **Modify:** `composition.ts` (como `startExportWorker`, `composition.ts:372`), `app.ts`, `route-matrix.ts`.
**Produces:** `FEE_REAPPLY_QUEUE = "fee-reapply"` + DLQ; `POST /api/settings/fee-reapplications/preview`; `POST /api/settings/fee-reapplications` (idempotente por `clientRequestId`, regra `escrita-idempotente.md`; 409 `reapply_in_progress`); `GET /api/settings/fee-reapplications?targetKind&targetId` (última). Só `catalog:manage`. Job: `running` → confere taxa atual = gravada (senão `failed`/`rate_changed`) → lotes de 200 via `planFeeReapplication` + `entryStore.applyChanges` (`packages/db/src/entry-store.ts:380`); `false` da guarda → relê o lote uma vez, o que ainda falhar conta em `skipped` → `done`.
- [ ] Testes: Review Focus 3; mesma `clientRequestId` duas vezes → uma linha e um job; taxa mudada entre confirmar e rodar → `failed`, nenhuma versão; job rodado duas vezes → versões só uma vez; versão criada tem canal `web` e autor = dono; gerente 403.
- [ ] Run: `pnpm --filter @app/api test:int -- fee-reapply`. Sugerir commit: `feat(api): reaplicação de taxa em fila`.

### A9. Reativar unidade no acesso restrito (F2-2) — CRÍTICA (sessão)
**Create:** `apps/api/src/http/restricted/restricted-units-routes.ts` + teste de integração; método novo no `panel-access-store.ts` (`app_auth`): `ownedInactiveUnits(userId): Promise<{ id; name; tenantId; tenantName }[]>` (dono ativo, unidade inativa, empresa sem unidade ativa).
- [ ] ⚠️ Passo 0: ler em `docs/superpowers/specs/2026-11-11-pos-f2-design.md` qual guarda aceita sessão restrita e como `/acesso-restrito` lê dados; reusar. Plano B, se nenhuma rota aceita sessão restrita: guarda nova `requireRestrictedSession` que só confere a sessão (sem `fr_ctx`).
- [ ] `GET /api/restricted/units` e `POST /api/restricted/units/:id/reactivate` (tenant da própria unidade; grava pelo `app` em `withTenant`; auditoria `unit.reactivate`).
- [ ] Testes: Review Focus 5; dono com unidade de outra empresa inativa não vê; depois de reativar, a entrada do painel volta a `full`; sessão completa também é aceita só para as próprias empresas.
- [ ] Run: `pnpm --filter @app/api test:int -- restricted-units`. Sugerir commit: `feat(api): reativar unidade no acesso restrito`.

### A10. Web: índice, formas e canais — NATIVA
**Create:** `apps/web/features/settings/shared/{settings-api.ts,aliases-input.tsx,percent-input.tsx,status-badge.tsx,read-only-notice.tsx}`, `features/settings/payment-methods/*`, `features/settings/sales-channels/*`, páginas `app/(app)/configuracoes/{page.tsx,formas-de-pagamento/page.tsx,canais-de-venda/page.tsx}`. **Modify:** `apps/web/e2e/routes.ts`.
- [ ] Índice com cartões por cadastro conforme `allowedActions`. `PercentInput` usa `parsePercentToBp`/`formatBp` do `core`; prévia por `GET /api/settings/fee-preview` com atraso de 300 ms, texto "Venda de R$ 100,00 rende R$ 96,80 líquidos" (RF08.Obs3). Sem `catalog:manage`: formulário somente leitura. 409 `name_taken` mostra "Já existe" com link. Selo "do sistema" nos protegidos.
- [ ] Testes (Vitest): gerente não vê botão de gravar; prévia usa o valor do servidor (a tela não calcula); `PercentInput` recusa "120".
- [ ] Run: `pnpm --filter @app/web exec vitest run features/settings`. Sugerir commit: `feat(web): formas de pagamento e canais`.

### A11. Web: unidades — NATIVA
**Create:** `features/settings/units/*`, `app/(app)/configuracoes/unidades/page.tsx`.
- [ ] Município pela lista IBGE como no autocadastro (`loadMunicipalities`, `apps/web/features/signup/company-form.tsx:197`); fuso sugerido pela UF; canal padrão em `select` só com ativos não protegidos; diálogo de inativar mostra `onlyUnitMemberCount`; após gravar, invalida `tenantKey(ctx, "units")` e a consulta do seletor (`components/context-switcher.tsx:65`).
- [ ] Testes: CA02 mostra a explicação; criar unidade atualiza o seletor.
- [ ] Run e commit: `feat(web): unidades`.

### A12. Web: reaplicação de taxa — NATIVA
**Create:** `features/settings/fee-reapply/{fee-reapply-dialog.tsx,use-fee-reapply.ts}`.
- [ ] Diálogo na forma e no canal: período (padrão: mês corrente), prévia do servidor ("312 lançamentos; o líquido muda em −R$ 1.234,56", `formatBRL`), confirmar com `clientRequestId` por tentativa (`escrita-idempotente.md`), estado da última com consulta a cada 3 s enquanto `queued`/`running`.
- [ ] Testes: chave só muda depois do sucesso; 409 `reapply_in_progress` mostra o estado atual.
- [ ] Run e commit: `feat(web): reaplicar taxa a lançamentos passados`.

### A13. Web: assistente inicial e acesso restrito — NATIVA
**Create:** `app/(app)/configuracoes/primeiros-passos/page.tsx`, `features/settings/onboarding/*`. **Modify:** `apps/web/features/signup/welcome.tsx` (botão "Configurar agora"), página de `/acesso-restrito` (lista e "Reativar").
- [ ] Passos: canal padrão por unidade, taxas (reusa o formulário de A10 em modo compacto), colaboradores desabilitado "em breve". "Pular" em cada passo.
- [ ] Testes: dono reativa e é levado ao painel; passo 3 desabilitado.
- [ ] Run e commit: `feat(web): assistente inicial e reativação de unidade`.

### A14. API falsa do E2E — HAIKU
**Create:** `apps/web/e2e/fake-settings.mjs` com `answerSettings(method, url, body, ctx)` e `resetSettings()`. **Modify:** `fake-api.mjs` (bloco `pathname.startsWith("/api/settings")` e `/api/restricted`, antes do `GET /api/units` da linha 341; `resetSettings` no `POST /__reset`).
- [ ] Estado em memória com as 6 formas e 5 canais do `SIGNUP_DEFAULTS`, duas unidades; mesmas respostas e códigos das rotas reais (403 para `manager`/`accountant` na escrita; prévia com 320 → 320/9680); ids e datas fixos.
- [ ] `CI=true pnpm --filter @app/web test:e2e` segue verde nas specs existentes. Commit: `test(web): API falsa de configurações`.

### A15. E2E — NATIVA
**Create:** `apps/web/e2e/settings-catalog.spec.ts` (`--workers=1`, `__reset`; regras em `.claude/rules/e2e-painel.md`).
- [ ] Dono muda a taxa do Crédito e vê a prévia; gerente abre formas e não encontra botão de salvar; dono cria unidade e ela aparece no seletor; celular (Pixel 7) sem rolagem horizontal; axe sem violação.
- [ ] Run: `pnpm --filter @app/web test:e2e -- settings-catalog`. Commit: `test(web): E2E de formas, canais e unidades`.

### A16. Fechamento da F6a — NATIVA
- [ ] `pnpm typecheck && pnpm lint && pnpm test` e `CI=true pnpm --filter @app/web test:e2e`; conferir CAs da F6a.
- [ ] `painel.md` (F6a feita), `andamento.md` (F2-2 fechada), `CLAUDE.md` "Estado atual" com uma frase; roteiro à mão em `docs/planos/f6-roteiro.md` (seção F6a: mudar taxa no painel e lançar receita pelo `pnpm dev:chat`; reaplicar a um mês; inativar a penúltima unidade).
- [ ] Propor (sem criar) regra/skill do que repetiu. Sugerir commit: `docs: F6a feita`.

**Contagem F6a:** HAIKU 2 · NATIVA 7 · CRÍTICA 7 (16 tarefas).

## Ordem e dependências
A1 → A2 → A3 → (A4, A6, A7 em paralelo) → A5 → A8 → A9 → A10 → (A11, A12, A13) → A14 → A15 → A16.

## Verificação de ponta a ponta
Por tarefa, o comando de cada uma (skill `testes-direcionados`). Ao fim: `pnpm typecheck && pnpm lint && pnpm test`, `pnpm --filter @app/db test:int`, `pnpm --filter @app/api test:int`, `CI=true pnpm --filter @app/web test:e2e`. À mão (Luís): `pnpm dev` + `pnpm dev:worker` + `pnpm dev:chat` com `pnpm db:seed:dev`, roteiro de A16.
