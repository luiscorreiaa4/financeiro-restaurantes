---
name: nova-rota-de-escrita-de-lancamento
description: Cria uma rota de escrita de lançamento no painel (POST, PATCH, DELETE sob /api/entries) com guardas, withTenant único, recorte na resposta, matriz de papéis, testes de duas empresas e API falsa do E2E. Use ao adicionar uma operação nova de escrita sobre lançamentos.
---

# Nova rota de escrita de lançamento

Modelo de referência: `POST /api/entries` (F3c) e `PATCH /api/entries/:id` (F3b), em `apps/api/src/http/entries/entries-routes.ts`. Leia antes `.claude/rules/rota-de-tenant.md`, `.claude/rules/sensivel-falha-fechado.md` e, se a escrita pode ser repetida pelo navegador, `.claude/rules/escrita-idempotente.md`. Regras de negócio: o RF da operação em `docs/requisitos.md` (busque `### RFnn`).

1. **Regra pura no `core` primeiro** (TDD): função que recebe dados e devolve `Result`, sem banco. Erro novo ganha classe em `errors/domain-errors.ts` e entrada em `entryErrorField` (campo do 422).
2. **Contrato Zod** em `packages/core/src/contracts/entries.ts` (`z.strictObject`; tetos de número e de texto para nunca dar 500). Teste do contrato primeiro.
3. **Gravação no `db`** recebendo a `tx` (não abra `withTenant` dentro). Histórico em `entry_versions` com o canal `web`. Coluna ou tabela nova: `.claude/rules/tabela-nova.md`.
4. **Rota**, guardas na ordem: `requirePanelContext`, `requireTenantRoute`, `requireEntryAction(action)`, `requireWritable()`. Um `withTenant` só. Unidade fora de `actor.units` → 403; referência inexistente, de outra empresa ou categoria sensível sem permissão → 422 `UnknownReference` (sem sondagem). Erros só com `{ code }` (mais `reason` e `field` no 422).
5. **Resposta pelo `entryReader.find`** (com recorte) e `entryDetailSchema.parse`; nunca devolva o que acabou de gravar sem passar por ele.
6. **Linha na `ROUTE_MATRIX`** (`apps/api/test/support/route-matrix.ts`): dono, gerente, gerente sem VER_FOLHA, lançador, lançador sem painel, contador, sessão restrita, conta somente leitura. Corpo que chega à validação sem gravar (ex.: 422) para não sujar o cenário.
7. **Testes de integração** (`apps/api/test/`): caminho feliz, sem `Origin` → 403 e nada gravado, duas empresas (a outra não vê nem colide), gerente sem VER_FOLHA e lançador com categoria sensível, valores absurdos (data `2026-02-30`, número gigante) sem 500, texto com CPF.
8. **Painel**: método em `entries-api.ts`, mutação em `use-entries.ts` (invalida `tenantKey(ctx, "entries")`), tela com trava síncrona contra duplo clique.
9. **API falsa do E2E** (`apps/web/e2e/fake-entries.mjs`, `fake-api.mjs`) com o mesmo formato de `entryDetailSchema`, ids e datas fixos, personas `-manager`, `-staff`, `-accountant`, `-readonly`; spec em `apps/web/e2e/` (regras em `.claude/rules/e2e-painel.md`).
10. **Fecho**: `.claude/dicionario-testes.md`, `docs/arquitetura.md` (se mudou o modelo), tabela do plano e `f3-como-testar.md`.
