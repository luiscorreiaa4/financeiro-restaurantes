# F0: Fundação do web — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** executado em 06/11/2026 (tarefas 1 a 8; desvios registrados no spec, seção 15).

**Goal:** Dar a `apps/web` a base técnica da F0 (testes, CI, Tailwind/shadcn, casca, `lib/` e cabeçalhos) para que F1 a F13 não precisem discutir ferramenta.

**Architecture:** Rede de segurança primeiro (Vitest e Playwright com a página atual, depois CI), e só então Tailwind, shadcn e a casca, sempre com o E2E de fumaça verde. O E2E sobe o web numa porta própria (3100) com `API_URL` apontando para uma API falsa, o que permite testar o `rewrites` sem a API real.

**Tech Stack:** Next.js 16.4 (App Router, Cache Components), React 19, Tailwind 4.3, shadcn/ui, TanStack Query 5, Vitest 5 + Testing Library + jsdom, Playwright 1.65, Recharts 3, Zod 4, Biome.

**Spec:** [`../specs/2026-11-06-f0-fundacao-web-design.md`](../specs/2026-11-06-f0-fundacao-web-design.md). Contexto de produto: `docs/planos/painel.md` (F0), `CLAUDE.md`.

## Global Constraints

- Dependências novas permitidas sem perguntar: `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `shadcn` (e o que o `init` instalar), `@tanstack/react-query`, `vitest` (já na raiz), `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@playwright/test`, `recharts`, `react-is` (mesma versão do `react`), `zod`, `@app/core` (`workspace:*`). Qualquer outra: perguntar ao Luís.
- Sem identidade visual: tema neutro padrão do shadcn, nada de paleta, fonte ou logotipo de marca.
- `packages/core`, `db`, `ai` e `whatsapp` não são alterados. Dinheiro nunca é calculado no web; `formatBRL` vem de `@app/core`.
- Datas de negócio (`YYYY-MM-DD`) nunca passam por `new Date("YYYY-MM-DD")`.
- Nenhum `use cache` em dado de tenant. Nada de tela de negócio, `proxy.ts`, Better Auth, React Hook Form ou TanStack Table.
- Testes: nomes em português descrevendo comportamento; unitários ao lado do arquivo (`*.test.ts(x)`), E2E em `apps/web/e2e/`; sem rede externa, sem relógio real.
- Playwright no CI: `workers: 1`, navegador instalado com `--with-deps` (Chromium), **sem** cache de navegadores, relatório enviado com `if: ${{ !cancelled() }}`. Projetos: `Desktop Chrome` e `Pixel 7`.
- Cabeçalhos de segurança (valores fixados aqui): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Não commitar** (regra do `CLAUDE.md`). Cada tarefa termina sugerindo a mensagem de Conventional Commits; o Luís decide quando commitar.
- Fim de cada tarefa: `pnpm typecheck && pnpm lint && pnpm test` verdes.

## Review Focus

1. Data de negócio inválida (`"2026-13-45"`, `"27/10/2026"`, `""`) → `formatBusinessDate` lança `RangeError` em vez de devolver "Invalid Date" (Tarefa 1).
2. Rota inexistente responde **HTTP 404**, não 200 com a página de "não encontrado" (Tarefa 5).
3. Em viewport de celular a casca não tem rolagem horizontal (Tarefa 5).
4. API fora do ar, resposta não-2xx ou corpo fora do contrato → `ApiError`, nunca exceção solta nem dado sem validar (Tarefa 6).
5. Cabeçalhos de segurança também nas páginas de erro e 404, não só na home (Tarefa 4).
6. O Vitest não pode executar os `*.spec.ts` do Playwright, nem o Playwright os testes do Vitest (Tarefa 2).

## Mapa de arquivos

```
apps/web/
  package.json, vitest.config.ts, vitest.setup.ts, playwright.config.ts, postcss.config.mjs, components.json
  next.config.ts                     (modificar)
  app/layout.tsx                     (modificar: providers, globals.css)
  app/globals.css                    (criar: Tailwind + tema neutro)
  app/error.tsx, loading.tsx, not-found.tsx
  app/(app)/layout.tsx, page.tsx     (casca; página inicial) + page.tsx de lancamentos, dashboard, exportacoes, configuracoes
  app/page.tsx                       (remover: vira app/(app)/page.tsx)
  components/app-shell.tsx(+test), components/providers.tsx, components/ui/*  (shadcn)
  lib/env.ts(+test), lib/navigation.ts, lib/format/{index.ts,format.test.ts}
  lib/api/{client.ts,client.test.ts}, lib/query/{get-query-client.ts,get-query-client.test.ts}
  lib/charts/recharts-compat.test.tsx
  e2e/{smoke.spec.ts,fake-api.mjs}
.github/workflows/ci.yml             (modificar: jobs e2e e integration)
turbo.json, package.json (raiz), biome.json, .gitignore   (ajustes pequenos)
```

---

### Task 1: Vitest no web e `lib/format`

**Files:**
- Modify: `apps/web/package.json` (dependências e script)
- Create: `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`, `apps/web/lib/format/index.ts`
- Test: `apps/web/lib/format/format.test.ts`

**Interfaces:**
- Produces: `formatBRL(amount: Money): string` (reexportado de `@app/core`); `formatBusinessDate(date: string): string` → `"dd/MM/yyyy"`, lança `RangeError` se a entrada não for `YYYY-MM-DD` de data real.

- [x] **Step 1: Instalar** em `@app/web`: `@app/core` (`workspace:*`), e como dev `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`. Conferir que `pnpm install` não altera outros pacotes.
- [x] **Step 2: Configurar o Vitest** em `vitest.config.ts`: `environment: "jsdom"`, `setupFiles: ["./vitest.setup.ts"]` (importa `@testing-library/jest-dom/vitest`), `globals: false`, `exclude` com `e2e/**` e `node_modules`. Alias não necessário.
- [x] **Step 3: Escrever o teste que falha** em `lib/format/format.test.ts`:
  - `formatBRL(money(123456).value)` → `"R$ 1.234,56"`; `formatBRL(ZERO)` → `"R$ 0,00"` (`money()` devolve `Result` e rejeita negativo; usar o helper de `ok` do `core` ou `.value` conforme o tipo `Result`, como em `packages/core/src/money/money.test.ts`).
  - `formatBusinessDate("2026-10-27")` → `"27/10/2026"`; `formatBusinessDate("2026-01-01")` → `"01/01/2026"` (prova que não houve deslocamento de fuso).
  - `formatBusinessDate("2026-13-45")`, `("27/10/2026")` e `("")` → `toThrow(RangeError)` (Review Focus 1).
- [x] **Step 4: Rodar e ver falhar:** `pnpm --filter @app/web test` → falha por `./index` inexistente.
- [x] **Step 5: Implementar** `lib/format/index.ts`: `export { formatBRL } from "@app/core";` e `formatBusinessDate(date: string): string` validando com regex `^\d{4}-\d{2}-\d{2}$` e checando que o dia existe (montar `Date.UTC(y, m - 1, d, 12)` e comparar de volta ano/mês/dia); formatar com `Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" })`. Meio-dia UTC evita virar o dia no fuso.
- [x] **Step 6: Rodar** `pnpm --filter @app/web test` → PASS; depois `pnpm typecheck && pnpm lint && pnpm test`.
- [x] **Step 7:** Sugerir commit `test(web): configura Vitest e adiciona lib/format`.

---

### Task 2: Playwright e E2E de fumaça (página atual)

**Files:**
- Modify: `apps/web/package.json` (script `test:e2e`), `turbo.json` (tarefa `test:e2e` sem cache), `package.json` raiz (script `test:e2e`: `turbo run test:e2e`), `.gitignore` (`playwright-report/`, `test-results/`)
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fake-api.mjs`
- Test: `apps/web/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: servidor web de teste em `http://localhost:3100` com `API_URL=http://localhost:4010`; API falsa em `:4010` com `GET /api/health` → `{"ok":true}`. Script `pnpm --filter @app/web test:e2e`.

- [x] **Step 1: Instalar** `@playwright/test` em `@app/web` (dev) e baixar o Chromium: `pnpm --filter @app/web exec playwright install chromium`.
- [x] **Step 2: `e2e/fake-api.mjs`:** servidor `node:http` na porta 4010, só `GET /api/health` (200 JSON `{"ok":true}`); qualquer outra rota 404 JSON. Sem dependências.
- [x] **Step 3: `playwright.config.ts`:** `testDir: "./e2e"`, `workers: process.env.CI ? 1 : undefined`, `retries: process.env.CI ? 1 : 0`, `reporter: [["html", { open: "never" }]]`, `use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" }`, projetos `Desktop Chrome` e `Mobile Chrome` (`devices['Pixel 7']`). `webServer` como lista: (1) `node e2e/fake-api.mjs` com `url: "http://localhost:4010/api/health"`; (2) web com `url: "http://localhost:3100"`, `env: { API_URL: "http://localhost:4010", PORT: "3100" }`, comando `process.env.CI ? "pnpm build && pnpm start -p 3100" : "pnpm dev -p 3100"` (o `package.json` do web fixa `-p 3000` nos scripts; usar `pnpm exec next ...` com a porta 3100 se houver conflito), `reuseExistingServer: false`, `timeout: 180_000`. Dar `name` a cada servidor.
- [x] **Step 4: Escrever o teste** `e2e/smoke.spec.ts` ("a página inicial abre e responde sem erro no console"): coletar `page.on("console")` com tipo `error` e `page.on("pageerror")`; `goto("/")` com `response.status() === 200`; `expect(consoleErrors).toEqual([])`; título com "Finanças para restaurantes".
- [x] **Step 5: Rodar** `pnpm --filter @app/web test:e2e` → PASS nos dois projetos (a página atual já satisfaz).
- [x] **Step 6: Verificar o isolamento (Review Focus 6):** `pnpm --filter @app/web test` continua verde e **não** lista `smoke.spec.ts`; `playwright test --list` não lista `format.test.ts`.
- [x] **Step 7:** Sugerir commit `test(web): adiciona Playwright com projetos desktop e celular`.

---

### Task 3: Jobs `e2e` e `integration` no CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm --filter @app/web test:e2e` (Tarefa 2); `pnpm test:int` (já existe na raiz).

- [x] **Step 1: Job `e2e`** (`ubuntu-latest`): mesmos passos de checkout/pnpm/node 24/`pnpm install --frozen-lockfile` do job `check`; `pnpm --filter @app/web exec playwright install --with-deps chromium`; `pnpm --filter @app/web test:e2e` com `CI=true`; `actions/upload-artifact@v5` de `apps/web/playwright-report/` com `if: ${{ !cancelled() }}`, `retention-days: 30`.
- [x] **Step 2: Job `integration`:** mesmos passos de instalação; `pnpm test:int` (o runner tem Docker para o Testcontainers).
- [x] **Step 3: Validar localmente** a sintaxe (`pnpm dlx @action-validator/cli` ou revisão manual) e rodar `pnpm test:int` na máquina do Luís **se o Docker estiver ativo**; se uma suíte falhar, diagnosticar a causa real, não enfraquecer teste; se sair do escopo do web, registrar em `docs/planos/andamento.md` seção 5.
- [x] **Step 4:** Sugerir commit `ci: adiciona jobs e2e e integration`. O resultado real só aparece depois do push (avisar o Luís; não empurrar).

---

### Task 4: Next (Cache Components), cabeçalhos e ambiente do web

**Files:**
- Modify: `apps/web/next.config.ts`
- Create: `apps/web/lib/env.ts`
- Test: `apps/web/lib/env.test.ts`, `apps/web/e2e/smoke.spec.ts` (acrescentar cabeçalhos)

**Interfaces:**
- Produces: `parseWebEnv(source: Record<string, string | undefined>): { API_URL: string }` (Zod, `API_URL` obrigatória e URL válida; lança `ZodError`).

- [x] **Step 1: Conferir na documentação oficial do Next 16.4** (nextjs.org/docs) o nome e o lugar das flags `cacheComponents` e `partialPrefetching` e a forma de definir `headers()` e `rewrites()` no `next.config.ts`; anotar o que confirmou na mensagem final.
- [x] **Step 2: Teste de `parseWebEnv`:** aceita `{ API_URL: "http://localhost:4000" }`; rejeita ausente e `"nao-e-url"`.
- [x] **Step 3: Implementar `lib/env.ts`** (só Zod; não importar `@app/config/env`, que exige banco e WhatsApp).
- [x] **Step 4: Teste E2E de cabeçalhos** em `smoke.spec.ts`: `GET /` **e** `GET /rota-que-nao-existe` retornam os quatro cabeçalhos das Global Constraints (Review Focus 5). Rodar e ver falhar.
- [x] **Step 5: `next.config.ts`:** manter `transpilePackages`; adicionar `cacheComponents: true`, `partialPrefetching: true`, `headers()` aplicando os cabeçalhos a `/:path*`, e `rewrites()` de `/api/:path*` para `${API_URL}/api/:path*` usando `parseWebEnv(process.env)`.
- [x] **Step 6: Rodar** E2E + `pnpm --filter @app/web build` (o build precisa de `API_URL`; definir no `.env.example` já existe como `API_URL`, e o CI passa a variável no job `e2e`). Se o Cache Components acusar uso de API dinâmica fora de `<Suspense>`, corrigir na página, não desligar a flag.
- [x] **Step 7:** Sugerir commit `feat(web): ativa Cache Components, cabeçalhos de segurança e ambiente do web`.

---

### Task 5: Tailwind, shadcn e a casca

**Files:**
- Modify: `apps/web/app/layout.tsx`, `biome.json` (se o Biome rejeitar diretivas do Tailwind: `css.parser.tailwindDirectives: true`)
- Create: `apps/web/postcss.config.mjs`, `app/globals.css`, `components.json` (gerado), `components/ui/*` (gerados), `lib/navigation.ts`, `components/app-shell.tsx`, `app/error.tsx`, `app/loading.tsx`, `app/not-found.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/{lancamentos,dashboard,exportacoes,configuracoes}/page.tsx`
- Remove: `apps/web/app/page.tsx`
- Test: `apps/web/components/app-shell.test.tsx`, `apps/web/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `NAV_ITEMS: readonly { href: string; label: string }[]` em `lib/navigation.ts` com `Início /`, `Lançamentos /lancamentos`, `Dashboard /dashboard`, `Exportações /exportacoes`, `Configurações /configuracoes`; `<AppShell>{children}</AppShell>` (menu lateral no desktop, botão "Abrir menu" com folha lateral no celular).

- [x] **Step 1: Instalar** `tailwindcss`, `@tailwindcss/postcss`, `postcss`; criar `postcss.config.mjs` com o plugin e `@import "tailwindcss";` em `globals.css`.
- [x] **Step 2: `shadcn init`** em `apps/web` (usar `pnpm dlx shadcn@latest init --help` para as opções não interativas): base color **Neutral**, variáveis CSS, sem monorepo (D-F2). Registrar o que o `init` gerou (a doc não descreve). Adicionar os componentes `button` e `sheet`. Rodar `pnpm format`; se o Biome rejeitar `@theme`/`@import`, ligar `css.parser.tailwindDirectives`.
- [x] **Step 3: Teste de componente que falha** em `components/app-shell.test.tsx`: renderiza um link para cada item de `NAV_ITEMS` (`getByRole("link", { name })`) e o `children`; o botão "Abrir menu" existe e, ao clicar (user-event), mostra a navegação do celular. Pode ser necessário um polyfill de `ResizeObserver` em `vitest.setup.ts` por causa do Radix.
- [x] **Step 4: Implementar** `lib/navigation.ts` e `AppShell` (client component só no que tem estado); mover a home para `app/(app)/page.tsx` com título "Início"; cada rota com `<h1>` e a frase "Em construção." em `app/(app)/<rota>/page.tsx`; `app/(app)/layout.tsx` usa `AppShell`; `app/layout.tsx` importa `globals.css`.
- [x] **Step 5: Estados de tela:** `app/loading.tsx` (esqueleto simples), `app/error.tsx` (`"use client"`, botão "Tentar de novo" chama `reset`), `app/not-found.tsx` ("Página não encontrada").
- [x] **Step 6: Ampliar o E2E** (`smoke.spec.ts`): (a) no desktop, os links do menu são visíveis e levam a `/lancamentos`; (b) no celular, clicar em "Abrir menu" e navegar até `/dashboard`; (c) **sem rolagem horizontal** no celular: `document.documentElement.scrollWidth <= clientWidth` em `/` (Review Focus 3); (d) `GET /rota-que-nao-existe` retorna **status 404** e mostra "Página não encontrada" (Review Focus 2).
- [x] **Step 7: Rodar** teste de componente, E2E nos dois projetos, e `pnpm typecheck && pnpm lint && pnpm test`.
- [x] **Step 8:** Sugerir commit `feat(web): adiciona Tailwind, shadcn e a casca da aplicação`.

---

### Task 6: `lib/api`, `lib/query` e provedor

**Files:**
- Modify: `apps/web/package.json` (`@tanstack/react-query`, `zod`), `app/layout.tsx` (usar `Providers`)
- Create: `lib/api/client.ts`, `lib/query/get-query-client.ts`, `components/providers.tsx`
- Test: `lib/api/client.test.ts`, `lib/query/get-query-client.test.ts`, `e2e/smoke.spec.ts` (rewrite)

**Interfaces:**
- Produces: `class ApiError extends Error { status: number; body: unknown }`; `createApiClient(options: { baseUrl: string; fetch?: typeof fetch }): { get<T>(path: string, schema: z.ZodType<T>): Promise<T> }`; `getQueryClient(): QueryClient` (novo a cada chamada no servidor; singleton no navegador); `<Providers>` (client component com `QueryClientProvider`).

- [x] **Step 1: Testes que falham** de `createApiClient` com `fetch` falso: (a) 200 e corpo válido → devolve o dado tipado; (b) 500 → `ApiError` com `status: 500`; (c) 200 com corpo fora do schema → `ApiError`; (d) `fetch` rejeitando (API fora do ar) → `ApiError` (`status: 0`) (Review Focus 4); (e) chama `${baseUrl}${path}` com `credentials: "include"`.
- [x] **Step 2: Teste de `getQueryClient`** (`// @vitest-environment node`): duas chamadas no servidor devolvem instâncias diferentes.
- [x] **Step 3: Rodar e ver falhar; implementar** os dois módulos e `Providers`; `app/layout.tsx` envolve `children` em `Providers`.
- [x] **Step 4: Teste E2E do rewrite:** `request.get("/api/health")` na `baseURL` devolve `{"ok":true}` (vem da API falsa pela reescrita) nos dois projetos.
- [x] **Step 5: Rodar** unitários, E2E e a verificação completa.
- [x] **Step 6:** Sugerir commit `feat(web): adiciona cliente tipado da API e provedor do TanStack Query`.

---

### Task 7: Prova de compatibilidade do Recharts

**Files:**
- Modify: `apps/web/package.json` (`recharts`, `react-is` na mesma versão do `react`)
- Test: `apps/web/lib/charts/recharts-compat.test.tsx`

- [x] **Step 1: Instalar** `recharts` e `react-is` (versão igual à do `react` instalado).
- [x] **Step 2: Teste** "o Recharts renderiza um gráfico de barras com React 19": `BarChart` com `width`/`height` fixos (sem `ResponsiveContainer`, que não mede no jsdom) e dois pontos; esperar o `svg.recharts-surface` no documento e nenhum erro/aviso no console.
- [x] **Step 3: Rodar.** Se falhar por incompatibilidade, registrar em `painel.md` (seção 8, riscos) e parar para decidir com o Luís; não contornar com mocks.
- [x] **Step 4:** Sugerir commit `test(web): prova a compatibilidade do Recharts com React 19`.

---

### Task 8: Fechamento da etapa

**Files:**
- Modify: `docs/planos/painel.md` (tabela: F0 "Feita (data)" + observação; "Atualizado em"), `docs/planos/andamento.md` (resumo, seção 6 e pendências do CI), `CLAUDE.md` ("Estado atual": F0 feita), `docs/superpowers/specs/2026-11-06-f0-fundacao-web-design.md` (registrar desvios, abaixo)

- [x] **Step 1: Verificação completa** (skill `superpowers:verification-before-completion`): `pnpm typecheck && pnpm lint && pnpm test`, `pnpm test:int` (se houver Docker) e `pnpm test:e2e`; colar a saída resumida.
- [x] **Step 2: Conferir cada item** de "Metas" (seção 3 do spec) e o "Pronto quando" (seção 12), um a um, dizendo se cumpriu.
- [x] **Step 3: Registrar os desvios do spec** no próprio spec: (a) `Money` não admite negativo, então o teste de `formatBRL` cobre zero e valor comum, não negativo; (b) o E2E usa a porta 3100 com API falsa e `next dev` localmente / `build` + `start` no CI.
- [x] **Step 4: Atualizar** os documentos listados (tabela do `painel.md`, `andamento.md`, `CLAUDE.md`).
- [x] **Step 5: Rever o contexto do Claude** (fechamento de etapa do `painel.md`): **propor, sem criar**, regras, skills, hooks ou `CLAUDE.md` do módulo que valham pelo que repetiu nesta etapa (candidatos: `apps/web/CLAUDE.md` com as regras de cache e de dinheiro; regra `.claude/rules/web-testes.md`).
- [x] **Step 6: Entregar** o resumo com: o que foi criado; o que o Luís decidiu; o que eu decidi por padrão; o que ficou pendente; **como testar à mão** (`pnpm dev` e abrir `http://localhost:3000`, redimensionar para celular, abrir o menu, acessar uma rota inexistente); e a mensagem de commit sugerida, sem commitar.
