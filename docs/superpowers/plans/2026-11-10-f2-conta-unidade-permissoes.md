# F2: Conta, unidade e permissões (plano)


> **Para quem executa:** use `executar-plano-hibrido` (Sonnet principal). A classe de cada tarefa diz como executá-la:
> - **HAIKU:** mecânica, com nomes e texto fixados aqui.
> - **NATIVA:** Sonnet sem subagente.
> - **CRÍTICA:** `superpowers:subagent-driven-development`, com revisor.
>
> Os passos são caixas `- [ ]` e seguem TDD (`superpowers:test-driven-development`). **Nunca commitar sem pedido:** cada tarefa termina sugerindo a mensagem de commit.

**Goal:** empresa e unidade ativas revalidadas pela API a cada requisição, um seletor no topo do painel, menu e rotas filtrados por `can()`, faixas de RF37, renovação de sessão pelo navegador e 401 levando ao login.

**Architecture:**
- Cookie de contexto `fr_ctx`, gravado só pela API.
- Resolução pura no `core` (`resolvePanelContext`, `accountAllows`).
- Leitura dos vínculos pelo `app_auth` (migration 0017, só grants e políticas).
- Dados de tenant pelo pool `app` com `withTenant`.
- Guards Fastify `requirePanelContext`, `requireTenantRoute`, `requirePermission` e `requireWritable`.
- No web: `Me` no servidor, `X-Context` e tratamento global de 401 e 409 no cliente, fábrica de chaves `tenantKey`, `SessionKeeper` e `ContextSwitcher`.

**Tech Stack:** TypeScript strict, Fastify, Zod 4, Drizzle e Postgres 16 (RLS), Next.js 16.4 (App Router, Cache Components), TanStack Query 5, shadcn `base-nova`, Vitest, Testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-f2-conta-unidade-permissoes-design.md`. Requisitos:
- RF02.R6 e RF02.CA05, CA06, CA07.
- RF05.R3 a R8 e RF05.CA09 (parte "próxima requisição").
- RF06.R1, R2, R5, R6 e RF06.CA06.
- RF37.R3 e R6.
- RNF02.R6 e RNF02.CA01.
- DD-03, DD-04, DE-22, DE-23, DE-25, DD-25.

## Global Constraints
- **Regras inegociáveis:**
  - Dado de tenant só dentro de `withTenant(appDb, tenantId, ...)` (regra 2).
  - Nunca logar o valor de cookie, o e-mail ou o nome (regra 9).
  - Validação Zod em toda fronteira: corpo de `POST /api/context`, resposta do `/api/me` no web e o cookie parseado.
- **Cookie:**
  - Nome `fr_ctx`, ou `__Secure-fr_ctx` quando `secureCookies`.
  - Valor `^<uuid>\.(<uuid>|all)$`, `Max-Age=31536000`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
  - Valor fora do formato é tratado como ausente, nunca como erro 500.
- **Códigos de erro (corpo `{ code }`):**
  - `context_invalid` (403)
  - `context_changed` (409)
  - `forbidden` (403)
  - `account_read_only` (403)
  - 401 continua com o `authError(401)` atual.
- **Cabeçalho:** `X-Context: <tenantId>.<unitId|all>`, com o mesmo formato do cookie.
- **Fallback da empresa:** `preferred_at` desc com nulos por último, depois `createdAt` asc, depois `id` asc (DE-25). O contador entra na lista do painel; o canal o ignora (DE-26), e isso não muda.
- **Unidade:**
  - "Todas" (`all`) só com `all_units = true` (RF02.R6, RF05.R5).
  - Unidade inativa (`units.status = 'inactive'`) não entra no seletor. O contexto com ela vira fallback na próxima requisição, porque `/api/units` só lista as ativas.
- **Situação da conta:**
  - `active`: lê e escreve.
  - `read_only`: lê.
  - `canceled`: só o owner lê.
  - `closed`: ninguém.
- **Web:**
  - Proibido `use cache` com dado de tenant.
  - Toda chave de dado de tenant usa `tenantKey`.
  - Toda tela nova tem teste no Pixel 7.
  - Nenhuma dependência nova.
- **Verificação:** `pnpm typecheck && pnpm lint && pnpm test`, mais `pnpm test:int` (db e api) e `pnpm --filter @app/web test:e2e`.

## Review Focus (cada linha vira teste na tarefa dona)
1. Cookie `fr_ctx` com uma empresa onde o vínculo foi **desativado depois** de gravado: `GET /api/units` dá 403 `context_invalid` e `/api/me` devolve o fallback com `contextSource: "invalid_cookie"` (Tarefa 5, RF02.CA06).
2. Gerente com unidades `[A]` e cookie `<tenant>.all`, ou `<tenant>.<B>`: contexto inválido, sem nunca listar B (Tarefa 2 e Tarefa 5, RF06.R5).
3. Duas abas: a aba 1 troca de empresa e a aba 2 chama `/api/units` com o `X-Context` antigo, então recebe 409 `context_changed` e nenhum dado (Tarefa 5 e E2E na Tarefa 9).
4. Contador numa empresa `canceled`: a empresa some de `companies` e o fallback vai para outra. Se era a única, a resposta é 401 (Tarefa 2 e Tarefa 3).
5. Mudar o papel no banco entre duas requisições faz `allowedActions` mudar já na segunda, sem novo login (Tarefa 5, RF05.CA09 e RF06.R6).

## Desvios em relação ao `painel.md` (F2)
- **CONTADOR:** `painel.md:310` diz "Fase 2". Vale o requisito: o Contador entra no seletor. A lista de empresas e o convite ficam na F13 (escolha sua). A correção do texto é a Tarefa 1.
- **"Conta desativada" não existe no RF37:** a F2 trata `read_only`, `canceled` e `closed`, e "desativado" fica sendo situação do vínculo.
- **Filtro de categoria sensível na resposta (RF06.R3, CA02):** vai para a F3, onde existem lançamentos. A F2 entrega o ator.
- **Matriz papel × ação na API (RF06.CA06):** a F2 testa os guards com uma rota registrada só no teste. Cada etapa seguinte acrescenta as linhas das suas rotas.
- **RF05.CA09, "sessão encerrada":** fica para a F6. A F2 cobre a parte "na próxima requisição".

## Itens ⚠️ (confirmar antes de depender)
- ⚠️ **GRANT de colunas com Drizzle:**
  - **Premissa:** um `select` só com as colunas concedidas (`id`, `name`, `status`) funciona sob `GRANT SELECT (cols)`.
  - **Plano B:** criar a view `tenant_names_for_auth` (`security_barrier`), dona do esquema, com `GRANT SELECT` ao `app_auth`.
  - **Onde se confirma:** Tarefa 3, passo 1.
- ⚠️ **`pageshow` com `persisted` no Chromium do Playwright:**
  - **Premissa:** voltar depois de `location.assign` restaura a página do bfcache.
  - **Plano B:** testar o resultado (a tela mostra a empresa atual depois de voltar), sem depender do evento.
  - **Onde se confirma:** Tarefa 9.
- ⚠️ **Rewrite do Next e `Set-Cookie` do `GET /api/me`:**
  - **Premissa:** o rewrite repassa os dois cookies (sessão renovada e `fr_ctx`). O login da F1 já depende disso para um cookie.
  - **Onde se confirma:** Tarefa 9, no E2E: o cookie `fr_ctx` existe no contexto do navegador depois de abrir a casca.

---

### Tarefa 1: Decisão e requisito primeiro — HAIKU (Haiku)
**Files:** Modify `docs/decisoes.md`, `docs/requisitos.md`, `docs/planos/painel.md`, `docs/planos/pendencias.md`

- [ ] **`docs/decisoes.md`, DD-31:** acrescentar no fim da tabela DD a linha **DD-31 (10/11/2026) Contexto do painel**. Texto:
  > Empresa e unidade ativas do painel ficam no cookie `fr_ctx` (httpOnly, 1 ano, por aparelho), gravado só pela API e revalidado a cada requisição contra `memberships` e `tenants.status`. Sem cookie, vale o `preferred_at` mais recente (DE-25). O painel não grava `preferred_at`, então trocar no painel não muda o WhatsApp. Com outra aba desatualizada, `X-Context` diferente responde 409. O `app_auth` passa a ler `tenants(id, name, status)`, `units(id, tenant_id, status)` e `membership_units`. Login e sair apagam o `fr_ctx`. O Contador entra no seletor; a lista e o convite ficam na F13. Aplica-se a F2, F3 e seguintes.
- [ ] **`docs/decisoes.md`, linha 119:** trocar o início `$1| DD-24` por `| DD-24`. Registrar em `pendencias.md` "DD-23 citada em README.md:33 e andamento.md:53, mas ausente de decisoes.md: recuperar pelo git log (Luís)".
- [ ] **`docs/requisitos.md`:**
  - Versão do topo: `1.7 (10/11/2026)` passa a `1.8 (10/11/2026)`, com uma linha no histórico: "1.8: Contador no MVP corrigido em §1.6 e no mapeamento de enums; RF02.R6 aponta DD-31".
  - §1.6 (linha ~171): a frase "Papel Contador ... na Fase 2. O código atual tem três papéis" passa a "Papel Contador no MVP (DD-03, RF36); o código tem os quatro papéis desde a E11".
  - Linha ~2680: `accountant` (futuro) passa a `accountant`.
  - Fim do RF02.R6: acrescentar "(DD-31)".
- [ ] **`docs/planos/painel.md`, linha 310:** trocar "(DONO, GERENTE, LANCADOR; CONTADOR é da Fase 2)" por "(DONO, GERENTE, LANCADOR e CONTADOR, este no MVP pelo DD-03; lista de empresas do contador na F13)".
- [ ] **`docs/planos/painel.md`, linha 315:** trocar "conta desativada ou em somente leitura (RF37)" por "conta em somente leitura, cancelada ou encerrada (RF37); vínculo desativado leva ao login".
- [ ] **Conferir:** `rg -n "Fase 2" docs/planos/painel.md` não mostra a F2. `rg -n '^\$1' docs/decisoes.md` não acha nada.
- [ ] **Sugerir commit:** `docs: DD-31 contexto do painel e contador no MVP (requisitos 1.8)`

### Tarefa 2: `core`, contexto do painel e situação da conta — CRÍTICA (Sonnet + revisor)
**Files:** Create `packages/core/src/access/panel-context.ts` e `panel-context.test.ts`; Modify `packages/core/src/access/index.ts` (exporta)

**Interfaces (Produces):**
```ts
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]; // reutiliza signup-defaults
export interface PanelMembership {
  membershipId: string; tenantId: string; tenantName: string; accountStatus: AccountStatus;
  role: Role; permissions: readonly AdditionalPermission[]; panelAccess: boolean;
  allUnits: boolean; unitIds: readonly string[]; defaultUnitId: string | null;
  preferredAt: Date | null; createdAt: Date;
}
export type UnitChoice = string | "all";
export interface PanelContext {
  membershipId: string; tenantId: string; unitId: UnitChoice; actor: Actor; accountStatus: AccountStatus;
}
export type ContextSource = "cookie" | "fallback" | "invalid_cookie";
export type PanelContextResolution =
  | { ok: true; context: PanelContext; source: ContextSource; companies: readonly PanelMembership[] }
  | { ok: false; reason: "no_access" };
export function accountAllows(status: AccountStatus, role: Role): { read: boolean; write: boolean };
export function parseContextValue(raw: string | undefined | null): { tenantId: string; unitId: UnitChoice } | null;
export function formatContextValue(c: { tenantId: string; unitId: UnitChoice }): string;
export function panelActor(m: PanelMembership): Actor;
export function resolvePanelContext(memberships: readonly PanelMembership[], requested: { tenantId: string; unitId: UnitChoice } | null): PanelContextResolution;
export function validateContextChoice(memberships: readonly PanelMembership[], choice: { tenantId: string; unitId: UnitChoice }): PanelContext | null;
export function allowedActions(actor: Actor): readonly Action[]; // can() sem unidade, na ordem de um array ACTIONS exportado
```
Para isso, `permissions.ts` passa a exportar `ACTIONS` (array `as const` com as 18 ações). `Action` vira `(typeof ACTIONS)[number]`, sem mudar comportamento.

- [ ] **Testes que falham** (nomes em português, tabela onde couber):
  - `accountAllows`: a tabela das 4 situações × owner e não owner.
  - `parseContextValue`: aceita `uuid.uuid` e `uuid.all`. Recusa `""`, `abc`, `uuid.`, `uuid.uuid.x`, maiúsculas fora de UUID e espaço.
  - `resolvePanelContext`:
    - "sem vínculos → no_access".
    - "cookie válido → source cookie".
    - "cookie de empresa sem vínculo → invalid_cookie e fallback por preferred_at" (Review Focus 1).
    - "gerente com [A] e cookie all → invalid_cookie" (RF 2).
    - "gerente com [A] e cookie B → invalid_cookie".
    - "sem cookie: owner → all; gerente com default acessível → default; default fora do acesso → menor id acessível".
    - "empate de preferred_at nulo → createdAt mais antigo".
    - "contador em canceled some e cai no próximo; só ele → no_access" (RF 4).
    - "closed some para todos".
    - "staff sem panelAccess não entra".
    - "lista de companies exclui as filtradas".
  - `validateContextChoice`: mesmas regras e devolve `null` quando inválido.
  - `allowedActions`:
    - owner contém `subscription:manage`.
    - staff com painel contém só ações `entry:*` e `panel:access`.
    - contador não contém `entry:edit`.
- [ ] Rodar `pnpm --filter @app/core test -- panel-context`: deve FALHAR.
  - "empresa do cookie válida e unidade inválida → mantém a empresa, recalcula a unidade, source invalid_cookie" (chamada 2).
  - "vínculo sem unidade acessível ativa fica fora de companies" (chamada 7).
- [ ] Implementar. Reusar `can`. `unitIds` já chega com as unidades **acessíveis e ativas** (Tarefa 3).
  - Unidade de fallback: `all` se `allUnits`; senão `defaultUnitId`, se estiver em `unitIds`; senão o menor de `unitIds` em ordem lexicográfica.
  - `unitIds` vazio: o vínculo não serve ao painel e é filtrado.
  - Fallback em dois níveis: primeiro mantém a empresa do cookie, depois recorre ao global.
- [ ] Rodar o teste: deve PASSAR. Rodar também `pnpm --filter @app/core typecheck` e `pnpm lint`.
- [ ] Atualizar `.claude/dicionario-testes.md` (regra `dicionario-testes.md`).
- [ ] **Sugerir commit:** `feat(core): contexto do painel e situação da conta (RF02.R6, RF37, DD-31)`

### Tarefa 3: `db`, migration 0017 e leitura dos vínculos do painel — CRÍTICA (Sonnet + revisor)
**Files:**
- Modify `packages/db/src/schema/tenant-base.ts` (política `tenants_auth_select`) e `packages/db/src/schema/tenants.ts` (política `membership_units_auth_select`).
- Create `packages/db/migrations/0017_panel_context.sql` (gerada e depois editada) e `packages/db/src/panel-access-store.ts`.
- Modify `packages/db/src/auth-store.ts` (`hasActiveMembership`) e `packages/db/src/index.ts`.
- Test: `packages/db/test/panel-access-store.int.test.ts` e `packages/db/test/auth-store.int.test.ts` (casos novos).

**Interfaces:**
- Consumes `PanelMembership` (Tarefa 2).
- Produces:
  - `createPanelAccessStore(db: Database): { listPanelMemberships(userId: string): Promise<PanelMembership[]> }`
  - `createTenantUnitsReader(): { listActiveUnits(tx: Transaction): Promise<{ id: string; name: string }[]> }`. É só leitura, ordenada por nome, e roda dentro de `withTenant`.

- [ ] **Passo 1 ⚠️:** num teste de integração curto, conectar como `app_auth` e rodar `select id, name, status from tenants`, que deve funcionar, e `select cnpj from tenants`, que deve dar `permission denied`. Se o Drizzle gerar `select *` ou falhar, aplicar o plano B (a view) e registrar em "Desvios".
- [ ] Editar o schema, com as políticas `tenants_auth_select`, `membership_units_auth_select` e `units_auth_select`, todas `FOR SELECT TO app_auth USING (true)`. Rodar `pnpm --filter @app/db db:generate --name panel_context`. Revisar o SQL e acrescentar à mão:
  - `GRANT SELECT (id, name, status) ON tenants TO app_auth;`
  - `GRANT SELECT ON membership_units TO app_auth;`
  - `GRANT SELECT (id, tenant_id, status) ON units TO app_auth;`
- [ ] Em `listPanelMemberships`, `unitIds` traz as unidades ativas da empresa quando `all_units`. Nos outros casos, traz a interseção de `membership_units` com as unidades ativas. Não há tabela nova, então `TABLES` e a contagem em `schema.test.ts` não mudam (`tabela-nova.md`, só os passos 1, 2 e 5).
- [ ] **Testes que falham:**
  - "app_auth lê nome e situação da empresa, não o cnpj".
  - "listPanelMemberships traz só vínculos ativos com painel, com unitIds, de todas as empresas do usuário e de nenhum outro usuário".
  - "hasActiveMembership falso quando a única empresa está closed".
  - "hasActiveMembership falso para gerente em empresa canceled e verdadeiro para owner".
  - "listActiveUnits sob withTenant(A) não vê unidade de B" (RNF02.CA01).
  - "app_auth lê id, tenant_id e status de units, não o name".
  - "unitIds exclui unidade inativa; com all_units traz todas as ativas".
  - "hasActiveMembership concorda com resolvePanelContext(listPanelMemberships) em todas as personas" (chamada 6).
- [ ] Rodar `pnpm --filter @app/db test:int -- panel-access`: deve FALHAR. Implementar. Rodar de novo: deve PASSAR. Rodar a suíte `test:int` inteira do `db`, porque o meta-teste de isolamento continua verde.
- [ ] **Sugerir commit:** `feat(db): app_auth lê empresa e unidades de acesso para o contexto do painel (DD-31)`

### Tarefa 4: API, pool `app` e guards — CRÍTICA (Sonnet + revisor)
**Files:**
- Create `apps/api/src/http/panel/panel-context.ts` (guards e cookie) e `apps/api/src/http/panel/panel-context.test.ts` (inject com rota de teste).
- Modify `apps/api/src/composition.ts` (`composeAuth` ganha `appPool = createPool(env.DATABASE_URL)`, `appDb`, `panelAccess` e `close()` fecha os dois pools) e `apps/api/src/app.ts` (tipo `AppDeps["panel"]`).

**Interfaces:**
- Consumes `checkSession`, `createPanelAccessStore` e `resolvePanelContext`.
- Produces:
```ts
declare module "fastify" { interface FastifyRequest { panel: (PanelContext & { source: ContextSource; companies: readonly PanelMembership[] }) | null } }
export const CONTEXT_COOKIE: (secure: boolean) => "fr_ctx" | "__Secure-fr_ctx";
export function contextCookieHeader(value: string, secure: boolean): string; // atributos das Global Constraints
export function requirePanelContext(deps: { checkSession: CheckSession; access: PanelAccessStore; secure: boolean }): preHandlerAsyncHookHandler; // 401 sem sessão/no_access; preenche request.session e request.panel
export function requireTenantRoute(): preHandlerAsyncHookHandler; // depois do anterior: invalid_cookie→403 context_invalid; X-Context ausente/diferente→409 context_changed
export function requirePermission(action: Action): preHandlerAsyncHookHandler; // can(actor, action, { unitId: unitId === "all" ? undefined : unitId }) senão 403 forbidden
export function requireWritable(): preHandlerAsyncHookHandler; // accountAllows(...).write senão 403 account_read_only
```
- [ ] **Testes que falham**, com Fastify `inject`, uma rota `GET /t` registrada só no teste e um `checkSession` e um `access` falsos:
  - "sem sessão → 401".
  - "no_access → 401".
  - "cookie inválido em rota de tenant → 403 context_invalid sem corpo de dados".
  - "X-Context ausente → 409".
  - "X-Context diferente → 409".
  - "papel sem a ação → 403 forbidden".
  - "read_only em requireWritable → 403 account_read_only".
  - "tudo certo → 200 e request.panel preenchido".
  - "set-cookie da sessão renovada é repassado".
  - **Matriz RF06.CA06 nos guards:** `it.each` sobre os 4 papéis × 18 ações (de `ACTIONS`), comparando o status com `can()`.
- [ ] Rodar `pnpm --filter @app/api test -- panel-context`: deve FALHAR. Implementar. Rodar de novo: deve PASSAR.
- [ ] **Sugerir commit:** `feat(api): guards de contexto e permissão do painel (RF02.R6, RF06.R2)`

### Tarefa 5: API, rotas `/api/me`, `/api/context` e `/api/units` — CRÍTICA (Sonnet + revisor)
**Files:**
- Create `apps/api/src/http/panel/panel-routes.ts`.
- Modify `apps/api/src/http/auth/auth-routes.ts`:
  - Tira o `/api/me` dali.
  - Nas respostas 2xx de `sign-in/email`, `sign-in/email-otp` e `sign-out`, acrescenta à lista de `set-cookie` um `fr_ctx` expirado (`Max-Age=0`; chamada 5).
- Modify `apps/api/src/app.ts` (registra `panelRoutes`).
- Test: `apps/api/test/panel-context.int.test.ts`. Ajustar `apps/api/test/auth-login.int.test.ts`, se ele checa o formato antigo do `/api/me`.

**Interfaces (contratos HTTP):**
- `GET /api/me` (`requirePanelContext`) responde `200`:
```json
{ "userId","name","email",
  "companies":[{"tenantId","name","role","accountStatus"}],
  "context":{"tenantId","unitId":"<uuid>|all","role","permissions":[],"allUnits":true,"unitIds":[],"accountStatus","allowedActions":[]},
  "contextSource":"cookie|fallback|invalid_cookie" }
```
- `POST /api/context` (`requirePanelContext`), corpo Zod `{ tenantId: uuid, unitId: uuid | "all" }`:
  - Válido: `204` com `Set-Cookie fr_ctx`.
  - Inválido: `403 { code: "context_invalid" }` e nenhum `Set-Cookie`.
  - Corpo torto: `400`.
- `GET /api/units` (`requirePanelContext` + `requireTenantRoute`) responde `200 { units: [{ id, name }] }`, filtrado por `actor.units`, dentro de `withTenant(appDb, tenantId)`.

- [ ] **Testes de integração que falham** (Testcontainers, usuários de fixture e login por senha como em `profile.int.test.ts`):
  - "me sem cookie → fallback pelo preferred_at".
  - "POST context válido grava cookie e o próximo me vem com source cookie".
  - "cookie forjado para empresa alheia → me com invalid_cookie e units 403" (RF02.CA06).
  - "vínculo desativado após o login → 401 na próxima" (RF02.CA07).
  - "papel trocado no banco → allowedActions muda na próxima" (RF 5).
  - "X-Context antigo após troca → 409 e nenhum dado" (RF 3).
  - "units de A nunca traz unidade de B; gerente vê só as suas" (RNF02.CA01, RF06.R5).
  - "POST context com all para gerente limitado → 403".
  - "contador com 2 empresas lista as 2".
  - "o log não contém o valor do cookie": captura do logger, como nos testes existentes.
  - "login e sair expiram o fr_ctx" (chamada 5).
  - "unidade inativada com cookie apontando para ela → me mantém a empresa e devolve outra unidade, com invalid_cookie" (chamada 2).
- [ ] Rodar `pnpm --filter @app/api test:int -- panel-context`: deve FALHAR. Implementar. Rodar de novo: deve PASSAR. Rodar a suíte `test:int` da API inteira.
- [ ] **Sugerir commit:** `feat(api): /api/me com contexto, /api/context e /api/units (RF02.R6, RNF02.R6)`

### Tarefa 6: web, contrato, cliente e chaves — NATIVA (Sonnet)
**Files:**
- Create `apps/web/lib/api/me-contract.ts`, `apps/web/lib/query/keys.ts` (+ `.test.ts`) e `apps/web/lib/api/browser-client.ts` (+ `.test.ts`).
- Modify `apps/web/lib/api/client.ts` (+ teste), `apps/web/lib/auth/session.ts` (+ teste), `apps/web/lib/query/get-query-client.ts` (+ teste) e `apps/web/CLAUDE.md` (regra 6: "use `tenantKey`").

**Interfaces:**
```ts
// me-contract.ts
export const meSchema: z.ZodType<Me>; export type Me = {...contrato da Tarefa 5...};
export function contextHeaderOf(me: Me): string; // `${tenantId}.${unitId}`
// client.ts — opções novas, retrocompatíveis
createApiClient(options: { baseUrl: string; fetch?: typeof fetch; contextHeader?: () => string | null; onError?: (e: ApiError) => void })
// keys.ts
export function tenantKey(ctx: { tenantId: string; unitId: string }, ...parts: readonly unknown[]): readonly unknown[]; // ["t", tenantId, unitId, ...parts]
// browser-client.ts
export function handleBrowserApiError(e: ApiError, kind: "query" | "mutation", nav: { assign(url: string): void; reload(): void; pathname: string; search: string }): void; // 401→/login?next=<safe> (os dois); 409 context_changed→reload só em "query"
export const CONTEXT_CHANGED_MESSAGE = "A empresa foi trocada em outra aba. Recarregue para continuar.";
export function browserApi(contextHeader: () => string | null): ApiClient;
// server-api.ts (Create apps/web/lib/api/server-api.ts) — para Server Components
export async function serverApi(): Promise<ApiClient>; // repassa (await cookies()).toString() e X-Context de requireCurrentSession()
// session.ts
getSession(...) : Promise<Me | null>; currentSession / requireCurrentSession devolvem Me
```
- [ ] **Testes que falham:**
  - `client`: "envia X-Context quando contextHeader devolve valor"; "não envia quando null"; "onError recebe o ApiError do 401".
  - `keys`: "tenantKey começa com t, tenant e unidade"; "duas unidades geram chaves diferentes".
  - `browser-client`:
    - "401 leva a /login com next seguro" (reusar `safe-next`).
    - "409 context_changed em query recarrega".
    - "409 em mutation não recarrega".
    - "409 com outro code não recarrega".
  - `server-api`: "repassa cookie e X-Context do contexto da sessão".
  - `session`: "resposta sem context → null" (o contrato antigo deixa de valer).
  - `get-query-client`: "QueryCache do navegador chama handleBrowserApiError".
- [ ] Rodar `pnpm --filter @app/web test`: deve FALHAR. Implementar. Rodar de novo: deve PASSAR, junto com o typecheck do web.
- [ ] **Sugerir commit:** `feat(web): contrato do /api/me, X-Context, 401 e 409 globais e tenantKey (RNF02.R6)`

### Tarefa 7: web, casca com seletor, menu filtrado, faixas e SessionKeeper — NATIVA (Sonnet)
**Files:**
- Create `apps/web/components/context-switcher.tsx` (+ teste), `apps/web/components/session-keeper.tsx` (+ teste), `apps/web/components/account-banner.tsx` (+ teste) e `apps/web/components/require-action.tsx` (+ teste).
- Modify `apps/web/lib/navigation.ts` (`NavItem.action?: Action`, com o mapa do desenho), `apps/web/components/app-shell.tsx` (+ teste), `apps/web/app/(app)/layout.tsx` e as páginas `dashboard`, `lancamentos`, `exportacoes` e `configuracoes` (envolver em `<RequireAction>`).

**Interfaces:**
- `AppShell({ children, me }: { children; me: Me })`
- `ContextSwitcher({ me }: { me: Me })`: carrega `/api/units` com `useQuery(tenantKey(ctx, "units"))`.
- `SessionKeeper({ me })`
- `AccountBanner({ status, role })`
- `RequireAction({ me, action, children })`

- [ ] **Testes que falham** (Vitest com jsdom e Testing Library):
  - Seletor de empresa:
    - "uma empresa e uma unidade: sem seletor".
    - "duas empresas: seletor de empresa".
    - "mais de 8 empresas: campo de busca filtra por nome".
    - "trocar chama POST /api/context e depois location.assign('/')" (fetch e location falsos).
  - Seletor de unidade:
    - "gerente sem allUnits: sem opção Todas as unidades".
    - "owner: com Todas as unidades".
  - Menu: "staff com painel vê só Lançamentos, Perfil e Nova empresa"; "contador não vê Configurações? vê": conferir com `allowedActions` (`catalog:view` está no contador, então vê).
  - Faixas: "read_only mostra faixa"; "canceled mostra faixa para owner".
  - `SessionKeeper`:
    - "contextSource fallback dispara POST /api/context".
    - "cookie não dispara".
    - "pageshow persisted recarrega".
    - "invalid_cookie recarrega com ?aviso=acesso-removido".
  - `AppShell`:
    - "contextSource diferente de cookie: mostra Carregando… e não renderiza a página" (chamada 3).
    - "?aviso=acesso-removido mostra o aviso uma vez".
    - "empresa cancelada aparece com a etiqueta cancelada no seletor".
  - `RequireAction`: "sem a ação mostra 'Você não tem acesso a esta página'".
- [ ] Implementar com os componentes shadcn já instalados (sem `shadcn add` que traga dependência nova; se faltar componente, usar `<select>`/`Sheet`/`Input` existentes). Seletor no topo do celular, no lugar do texto fixo de `app-shell.tsx:56-58`, e no topo da barra lateral no desktop.
- [ ] Rodar `pnpm --filter @app/web test` e o typecheck: devem PASSAR.
- [ ] **Sugerir commit:** `feat(web): seletor de empresa e unidade, menu por permissão e faixas da conta (RF02.R6, RF06, RF37)`

### Tarefa 8: web, perfil lido no servidor (F1c-6) — HAIKU (Haiku)
**Files:** Modify `apps/web/app/(app)/perfil/page.tsx` e `apps/web/features/profile/profile-view.tsx`.
- [ ] Na página: `const qc = getQueryClient(); await qc.prefetchQuery({ queryKey: PROFILE_KEY, queryFn: <get /api/profile com cookie, como em session.ts> })` e `<HydrationBoundary state={dehydrate(qc)}>`, dentro de `<Suspense>`. O perfil é do usuário, não do tenant, então a chave continua `["profile"]` (anotar num comentário). O componente continua com `useQuery(PROFILE_KEY)`.
- [ ] O E2E `profile.spec.ts` existente deve continuar verde. Rodar `pnpm --filter @app/web test:e2e -- profile`: deve PASSAR.
- [ ] **Sugerir commit:** `refactor(web): perfil lido no servidor com hidratação (F1c-6)`

### Tarefa 9: E2E, matriz de menu, troca de empresa, 401 e duas abas — NATIVA (Sonnet)
**Files:** Modify `apps/web/e2e/fake-api.mjs`; Create `apps/web/e2e/context.spec.ts`

- [ ] **`fake-api.mjs`:** personas pelo valor do cookie de sessão (`sessao-falsa-owner2`, `-manager`, `-staff`, `-accountant`, `-readonly`). O `GET /api/me` lê `fr_ctx`. `POST /api/context` grava `fr_ctx`. `GET /api/units` confere `X-Context` e responde 409 se diferente. Um valor `sessao-falsa-expira` faz `/api/units` responder 401. Os dados ficam fixos no arquivo, sem a regra (a regra está nos testes da API).
- [ ] **Specs (Desktop e Pixel 7):**
  - "owner com 2 empresas troca e a tela mostra só a nova; voltar não mostra a anterior" (RF02.CA05).
  - "fr_ctx existe depois de abrir a casca" (⚠️ rewrite).
  - "menu por papel": `it.each` para owner, manager, staff e accountant.
  - "gerente não vê Todas as unidades".
  - "read_only mostra faixa".
  - "401 numa chamada leva a /login?next=".
  - "duas abas: a aba 2 recarrega ao receber 409".
  - "Pixel 7 sem rolagem horizontal com o seletor".
- [ ] Rodar `pnpm --filter @app/web test:e2e`: deve PASSAR.
- [ ] **Sugerir commit:** `test(web): E2E do seletor, do menu por papel e do 409 (RF02.CA05, RF06.CA06)`

### Tarefa 10: Fechamento — HAIKU (Haiku), com a verificação feita pelo `verificador`
**Files:** Modify `docs/planos/painel.md` (tabela: F2 "Feita (data)", desenho e plano), `docs/planos/andamento.md` e `docs/planos/pendencias.md` (fechar F1a-1, F1b-12 e F1c-6; abrir as que sobrarem), `docs/arquitetura.md` (tabela de papéis com 4 papéis; `memberships` sem `unit_id`; seção "Contexto do painel" de 3 linhas citando DD-31) e `CLAUDE.md` (Estado atual: F2 feita, próxima F3).
- [ ] Rodar `pnpm typecheck && pnpm lint && pnpm test`, `pnpm --filter @app/db test:int`, `pnpm --filter @app/api test:int` e `pnpm --filter @app/web test:e2e` (`superpowers:verification-before-completion`).
- [ ] **Roteiro à mão para o Luís** (banco dev, `pnpm dev` com `pnpm db:seed:dev`):
  1. Entrar como dono com duas empresas (criar a segunda por "Criar outra empresa"): o seletor aparece. Trocar e conferir que o nome no topo e as unidades mudam. Apertar voltar e conferir que continua a empresa nova.
  2. Abrir duas abas, trocar a empresa numa e clicar no menu da outra: ela recarrega na empresa nova.
  3. No banco: `update memberships set status='deactivated', deactivated_at=now() where ...` e recarregar: vai para `/login`.
  4. No banco: `update tenants set status='read_only' ...`: aparece a faixa.
  5. No DevTools, editar o cookie `fr_ctx` com o id de outra empresa e recarregar: abre na empresa de fallback. A chamada a `/api/units` com o `X-Context` velho dá 409 e a aba recarrega.
  6. Fechar o navegador com "manter conectado" e voltar no dia seguinte (ou conferir no DevTools que o `Max-Age` do cookie de sessão é renovado a cada carregamento).
- [ ] **Propor, sem criar:** regra `.claude/rules/rota-de-tenant.md` (toda rota de dado de tenant usa `requirePanelContext` + `requireTenantRoute` + `requirePermission` + `withTenant` e ganha linha na matriz) e o que mais tiver se repetido.
- [ ] **Sugerir commit:** `docs: F2 feita (painel.md, andamento, arquitetura, CLAUDE.md)`

## Autorrevisão
- **Cobertura:** cada objetivo do desenho tem tarefa.
  - Objetivo 1: Tarefas 2 a 5.
  - Objetivo 2: Tarefas 5 e 7.
  - Objetivo 3: Tarefas 4 e 7.
  - Objetivo 4: Tarefas 5, 6, 7 e 9.
  - Objetivo 5: Tarefas 2 e 7.
  - Objetivo 6: Tarefas 6 e 7.
  - Herança F1c-6: Tarefa 8.
- **Nomes:** `PanelMembership`, `PanelContext`, `resolvePanelContext`, `validateContextChoice`, `accountAllows`, `allowedActions`, `fr_ctx`, `X-Context`, `tenantKey`, `requirePanelContext` e `requireTenantRoute` são iguais em todas as tarefas.
- **Dependências:**
  - 1 primeiro.
  - 2, depois 3, depois 4, depois 5.
  - 6 só precisa do contrato (o desenho) e pode correr em paralelo com 3 a 5.
  - 7 vem depois de 6.
  - 8 é independente.
  - 9 vem depois de 7.
  - 10 é a última.
- **Classes:** HAIKU 3 (1, 8, 10); NATIVA 3 (6, 7, 9); CRÍTICA 4 (2, 3, 4, 5).
