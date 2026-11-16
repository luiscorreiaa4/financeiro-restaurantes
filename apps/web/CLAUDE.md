# CLAUDE.md do painel (`apps/web`)

Regras deste módulo. As gerais estão no `CLAUDE.md` da raiz; a ordem das etapas, em `docs/planos/painel.md`. Desenho e plano da F0: `docs/superpowers/specs/2026-11-06-f0-fundacao-web-design.md` e `docs/superpowers/plans/2026-11-06-f0-fundacao-web.md`.

## Regras que não podem quebrar

1. **Nunca `use cache` (nem cache compartilhado) em dado de tenant.** O Cache Components está ligado (`cacheComponents` e `partialPrefetching` em `next.config.ts`). `use cache` só para conteúdo público. Dado do tenant vem da API, em `<Suspense>`.
2. **O painel não calcula dinheiro.** Ele formata o que a API devolveu. Use `formatBRL` de `@/lib/format` (reexporta `@app/core`). Dinheiro no JSON é `number` inteiro em centavos (D-F4).
3. **Data de negócio é texto `YYYY-MM-DD`.** Formate com `formatBusinessDate`. Nunca `new Date("YYYY-MM-DD")` (lê como UTC e pode mostrar o dia anterior).
4. **A autorização real é da API.** Esconder botão é conforto. O `proxy.ts` (F1) só redireciona quem não tem cookie.
5. **Toda chamada à API passa por `lib/api`** (`createApiClient`), com schema Zod na resposta. Erro vira `ApiError` (`status` 0 = API fora do ar). Nunca use dado da API sem validar.
6. **Toda chave de query de dado de tenant usa `tenantKey(ctx, ...)`** (`lib/query/keys.ts`), que inclui empresa e unidade. Chave escrita à mão para dado de tenant é proibida. Dado do usuário (perfil) não é do tenant e usa chave própria. No servidor, `getQueryClient()` devolve um cliente novo por chamada.
7. Texto de mensagem de usuário é entrada não confiável: renderize como texto, nunca como HTML.

## Lançamentos (`features/entries`, F3a)

- Contrato da API em `@app/core/contracts` (Zod); o web não redefine schema de lançamento. Cliente em `entries-api.ts`, hooks em `use-entries.ts` (dentro de `EntriesProvider`, que entrega empresa, unidade e cliente).
- **A tela não soma, não subtrai e não reordena.** Totais e resultado vêm de `/api/entries/totals`; a ordenação é pedida ao servidor pela URL (DD-35). O teste "os totais são os do servidor" (`entries-view.test.tsx`) dá um total diferente da soma das linhas e espera o do servidor.
- Centavos do contrato são `number`: formate com `formatCents` (`@/lib/format`), que aceita o resultado negativo. `formatBRL` exige `Money` do core.
- O estado mora na URL: filtros, `sort`, `dir` e o lançamento aberto (`?entry=<id>`). Ler e escrever só por `parseFilters` e `serializeFilters` (`url-filters.ts`); `cursor` e `limit` nunca vão para a URL da tela.
- Campo controlado pela URL que o usuário marca (caixa de marcação) guarda o valor local até a navegação terminar (`useSynced` em `filters-bar.tsx`); sem isso a caixa volta ao estado antigo por um instante e o E2E falha em `check()`.
- TanStack Table instalado é a v9: `useTable`, `tableFeatures` e `table.FlexRender`, com recursos e colunas fora do componente. A API da v8 (`useReactTable`, `getCoreRowModel`) só existe em `@tanstack/react-table/legacy`.
- No jsdom o CSS não se aplica: a tabela do computador e os cartões do celular aparecem juntos no teste de componente. Escopo com `within(screen.getByRole("table"))`.

## Lançamentos: escrita (`features/entries`, F3b)

- Escrita só por `entriesApi` (`update`, `remove`, `restore`, `batchPreview`, `batchDelete`, `trash`); as mutações (`use-entries.ts`) invalidam `tenantKey(ctx, "entries")`. `isEntryStale(e)` devolve o detalhe atual do 409 `entry_stale`, que a tela trata (`StaleNotice`); o 409 `context_changed` continua do `browser-client` e o formulário não perde o digitado. O 409 do lote não traz `current`.
- Dinheiro digitado: `MoneyInput` (`components/money-input.tsx`) emite centavos inteiros; texto colado passa por `parseBRLInput` do core. A tela nunca soma: confirmação do lote usa quantidade e soma de `batch/preview`.
- Formulário (`entry-form.tsx`): React Hook Form, só o que mudou vai no `patch`, com `expectedVersion`; trava síncrona (`useRef`) contra duplo envio. `select` nativo e fornecedor com lista própria (`supplier-field.tsx`), não o `Combobox` do shadcn.
- Seleção de linhas do lote: só na tabela do desktop, só dono e gerente; a chave é `serializeFilters` (abrir o drawer não limpa, mudar filtro ou ordem limpa).
- Link com aparência de botão: `<Link className={buttonVariants(...)}>`, não `<Button render={<Link/>}>` (vira `role=button`).
- No E2E, a tabela de dono e gerente tem a coluna de seleção: não selecione célula por posição nem `getByLabel("Insumos")` sem `{ exact: true }` (as caixas se chamam "Selecionar Insumos #n"). A API falsa guarda estado: `POST http://localhost:4010/__reset` no `beforeEach` e no `afterEach` de spec que escreve.

## Estrutura e UI

- `app/(app)/` é a área com a casca (`components/app-shell.tsx`); `app/(public)/` é para login (F1). Navegação em `lib/navigation.ts` (`NAV_ITEMS`).
- Componentes de `components/ui/` vêm do shadcn (preset `base-nova`, sobre `@base-ui/react`, pacote `cn`). Adicione com `pnpm dlx shadcn@latest add <componente>` dentro de `apps/web`; `--overwrite` apaga edição local.
- **Sem identidade visual por enquanto (D-F8).** Tema neutro, fonte do sistema, cores só pelos tokens de `app/globals.css`. Não invente paleta nem fonte.
- Ambiente do web: `lib/env.ts` (`parseWebEnv`). Não use `loadEnv` de `@app/config` aqui. `API_URL` é obrigatória em produção (padrão `http://localhost:4000` só fora dela).

## Testes

- Unitários e de componente: Vitest com jsdom, `*.test.ts(x)` ao lado do código. O Vitest ignora `e2e/` e o JSX é transformado pelo `oxc` (o tsconfig usa `jsx: "preserve"`).
- E2E: Playwright em `e2e/*.spec.ts`, projetos `Desktop Chrome` e `Pixel 7`. `pnpm --filter @app/web test:e2e`. Sobe o web em `:3100` e uma API falsa em `:4010` (`e2e/fake-api.mjs`); com `CI=true` faz `next build` + `next start`, sem `CI` usa `next dev`. Instalar o navegador uma vez: `pnpm --filter @app/web exec playwright install chromium`.
- Durante a tela, rode só a spec dela (`... exec playwright test <spec> --project="Desktop Chrome"`) e, ao concluir, a mesma spec nos dois projetos. Todas as specs com `CI=true` são nível 3 (skill `testes-direcionados`): mudança estrutural, fechamento de etapa, PR.
- Selecione por papel e texto acessível, não por classe CSS. Toda tela nova precisa de teste no celular (sem rolagem horizontal).
- Se o `typecheck` acusar `Cannot find module '../../app/...'` em `.next/types`, apague `apps/web/.next` (saída de build ignorada pelo git).
- Biome precisa de `css.parser.tailwindDirectives` (já ligado) para ler o `globals.css`.

## Rotas por estado de sessão

A API (`/api/me`) classifica a sessão; o `proxy.ts` só olha se há cookie. O E2E `e2e/routes.spec.ts` prova cada célula.

| Rota | Sem sessão | Sessão completa | Sessão restrita | Cookie inválido ou vencido |
|---|---|---|---|---|
| Grupo `(app)` | `/login?next=` | abre | `/acesso-restrito` | `/login` |
| `/acesso-restrito*` | `/login?next=` | `/` | abre | `/login` |
| `/login`, `/cadastro`, `/recuperar-senha` | abre | `safeNext(next)`, padrão `/` | `/acesso-restrito` (via `/`) | abre, sem laço |
| `/redefinir-senha` | abre | abre; ao concluir, sai e vai a `/login` | idem | abre |
| `/termos`, `/privacidade` | abre | abre | abre | abre |

`/lancamentos/lixeira` é do grupo `(app)` (linha 1 da tabela) e exige `entry:restore` (`PageGuard`): quem não tem vê "Você não tem acesso a esta página".

- Página nova em `app/(app)/` entra em `APP_ROUTES` (`e2e/routes.ts`). `lib/routes-list.test.ts` compara a lista com o disco e falha se faltar.
- Escrita feita pelo servidor do Next, ou webhook novo, exige entrada explícita em `ORIGIN_EXEMPT_PATHS` da API (`apps/api/src/http/origin-guard.ts`; ver `.claude/rules/rota-de-tenant.md`, regra 6). Sem isso a API recusa por `origin_forbidden`.

