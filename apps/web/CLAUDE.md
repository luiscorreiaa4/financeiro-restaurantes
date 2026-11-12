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

## Estrutura e UI

- `app/(app)/` é a área com a casca (`components/app-shell.tsx`); `app/(public)/` é para login (F1). Navegação em `lib/navigation.ts` (`NAV_ITEMS`).
- Componentes de `components/ui/` vêm do shadcn (preset `base-nova`, sobre `@base-ui/react`, pacote `cn`). Adicione com `pnpm dlx shadcn@latest add <componente>` dentro de `apps/web`; `--overwrite` apaga edição local.
- **Sem identidade visual por enquanto (D-F8).** Tema neutro, fonte do sistema, cores só pelos tokens de `app/globals.css`. Não invente paleta nem fonte.
- Ambiente do web: `lib/env.ts` (`parseWebEnv`). Não use `loadEnv` de `@app/config` aqui. `API_URL` é obrigatória em produção (padrão `http://localhost:4000` só fora dela).

## Testes

- Unitários e de componente: Vitest com jsdom, `*.test.ts(x)` ao lado do código. O Vitest ignora `e2e/` e o JSX é transformado pelo `oxc` (o tsconfig usa `jsx: "preserve"`).
- E2E: Playwright em `e2e/*.spec.ts`, projetos `Desktop Chrome` e `Pixel 7`. `pnpm --filter @app/web test:e2e`. Sobe o web em `:3100` e uma API falsa em `:4010` (`e2e/fake-api.mjs`); com `CI=true` faz `next build` + `next start`, sem `CI` usa `next dev`. Instalar o navegador uma vez: `pnpm --filter @app/web exec playwright install chromium`.
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

- Página nova em `app/(app)/` entra em `APP_ROUTES` (`e2e/routes.ts`). `lib/routes-list.test.ts` compara a lista com o disco e falha se faltar.
- Escrita feita pelo servidor do Next, ou webhook novo, exige entrada explícita em `ORIGIN_EXEMPT_PATHS` da API (`apps/api/src/http/origin-guard.ts`; ver `.claude/rules/rota-de-tenant.md`, regra 6). Sem isso a API recusa por `origin_forbidden`.

