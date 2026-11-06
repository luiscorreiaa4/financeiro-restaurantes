# F0: Fundação do web (desenho)

> **Papel deste documento:** desenho aprovado da etapa F0 do painel (DD-18). Não copia regra de negócio: a ordem das etapas está em [`../../planos/painel.md`](../../planos/painel.md) (seção 7, F0), as regras em [`../../requisitos.md`](../../requisitos.md) e o porquê em [`../../decisoes.md`](../../decisoes.md). Em conflito, vale `requisitos.md`.

Data: 06/11/2026. Etapa: F0, marco FM1. Tamanho: **M**, uma única entrega (opção A, escolhida pelo Luís).

## 1. Intenção e porquê

`apps/web` hoje é um esqueleto: `layout.tsx`, uma `page.tsx` com "Painel em construção" e pastas com `.gitkeep`. A F0 cria a **base técnica** sobre a qual F1 a F13 vão construir, para que nenhuma etapa seguinte precise discutir ferramenta, teste ou CI.

O Luís quer que a F0 seja planejada a partir do que os planos e o código dizem, sem receita genérica. Por isso os itens marcados ⚠️ no `painel.md` foram conferidos na documentação oficial antes deste desenho (seção 8).

## 2. Requisitos que a etapa cumpre

Conforme a tabela "Requisitos por etapa" do `painel.md`: **RNF05.R3 e RNF09** (base: casca e estados de tela), **RNF10.R2** (PWA; o manifest é da F7, aqui só a casca responsiva) e **RNF14** (testes). Nenhum RF de negócio. Localizar as regras com Grep pelo título `### RNFnn` em `requisitos.md`.

## 3. Metas

1. `next.config.ts` com `cacheComponents: true` e `partialPrefetching: true` explícitos.
2. Tailwind 4 e shadcn/ui inicializados direto em `apps/web` (D-F2), com o tema neutro padrão.
3. Casca da aplicação: layout, navegação que funciona no celular e no desktop, e páginas de erro, carregando e não encontrado.
4. `lib/api` (cliente tipado da API, com `rewrites` de `/api/*` para a API), `lib/format` (`formatBRL` reexportado de `@app/core` e datas de negócio) e `lib/query` (TanStack Query).
5. Testes: Vitest com Testing Library (jsdom) e Playwright com projetos desktop e celular.
6. Cabeçalhos de segurança básicos.
7. CI com os jobs `e2e` e `integration`.

## 4. Não-metas

- Identidade visual: **não haverá** nesta etapa (decisão do Luís). Tema neutro, genérico, só para desenvolvimento. Marca, paleta e tipografia ficam para depois.
- Qualquer tela de negócio, login, `proxy.ts`, Better Auth (F1) e endpoints novos na API.
- React Hook Form, TanStack Table e o gráfico real do dashboard (F3 e F4). O Recharts entra apenas como prova de compatibilidade (seção 7).
- Manifest do PWA e service worker (F7), CSP completa e orçamento de JavaScript (F8).

## 5. Anti-metas (seria falha mesmo com tudo verde)

- Dado de tenant em cache compartilhado do servidor (`use cache`). Nada disso nasce aqui.
- Cálculo de dinheiro no painel. O painel só formata o que a API devolve (princípio do `painel.md`, seção 1).
- Dependência sem motivo, ou mexer em `packages/core`, `db`, `ai` e `whatsapp` além do estritamente necessário.
- Testes que dependem da API, de rede externa ou de "hoje".

## 6. Restrições

- Regras do `CLAUDE.md` (TypeScript strict, Biome, Conventional Commits, `packages/core` sem infra).
- Dependências permitidas sem perguntar são as que o `painel.md` nomeia para a F0: Tailwind 4 (`@tailwindcss/postcss`), shadcn/ui, TanStack Query, Vitest com Testing Library, Playwright. Qualquer outra pergunta antes.
- `@app/web` passa a depender de `@app/core` (`workspace:*`). Hoje o `next.config.ts` já o transpila, mas o `package.json` só lista `@app/config`.
- O web não carrega o `loadEnv` completo de `@app/config` (exige variáveis do banco e do WhatsApp). Precisa de um esquema Zod mínimo próprio (só `API_URL`).

## 7. Abordagens consideradas

| | Ordem | Troca |
|---|---|---|
| **1 (escolhida)** | Rede de segurança primeiro: Vitest, Playwright e os jobs de CI com a página atual; depois Tailwind, shadcn, casca e `lib/` | Cada passo nasce protegido por um E2E de fumaça. A casca só aparece no meio da etapa. |
| 2 | Visual primeiro, testes e CI depois | Vê-se a tela cedo, mas o código nasce sem teste, contra o TDD do projeto. |
| 3 | Fatia fina de ponta a ponta e depois alargar | Acha problemas de integração cedo, mas a mudança fica difícil de revisar por passos. |

Escolhida a 1 pelo Luís, com a F0 inteira numa só entrega (a alternativa de duas fatias foi recusada).

## 8. O que foi conferido (06/11/2026)

- **shadcn:** suporte a Tailwind 4 e React 19 confirmado em ui.shadcn.com/docs/tailwind-v4. A página **não** descreve o que o `init` gera; conferir ao rodá-lo (`components.json`, CSS, `tw-animate-css` no lugar de `tailwindcss-animate`, `sonner` no lugar de `toast`).
- **Playwright:** `webServer` aceita lista de servidores e espera a URL responder; `projects` com `devices['Desktop Chrome']` e `devices['Pixel 7']`; no CI, 1 worker, relatório enviado com `if: ${{ !cancelled() }}`, **sem** cache de navegadores.
- **Versões no npm:** `tailwindcss` e `@tailwindcss/postcss` 4.3.4, `shadcn` 4.23, `@tanstack/react-query` 5.106, `@playwright/test` 1.65, `recharts` 3.10 (aceita React 19; `react-is` na mesma versão do `react`), `@testing-library/react` 16.3, `jsdom` 31.
- **Ainda ⚠️ e a conferir na execução:** as flags `cacheComponents` e `partialPrefetching` no Next 16.4.3 (a doc do `painel.md` é de 27/10), a convenção de cabeçalhos no `next.config.ts`, a integração do Testing Library com Vitest 5.

## 9. Achados que mudam o escopo

1. **O job `integration` não existe.** O CI de hoje roda só `lint`, `typecheck` e `test`; o `test:int` (Testcontainers) nunca roda lá, nem para a API e o banco já feitos. O job criado na F0 vale para o repositório inteiro. Se alguma suíte de integração falhar no CI pela primeira vez, **diagnosticar a causa real**, sem enfraquecer o teste; se a correção sair do escopo do web, registrar como pendência em `andamento.md`.
2. **O E2E de fumaça não precisa da API.** Sobe só o web. A API do painel nasce na F1. O `rewrites` e o cliente tipado são exercitados com um servidor falso, apenas no teste.

## 10. Ordem de execução (abordagem 1)

Cada passo termina com `pnpm typecheck && pnpm lint && pnpm test` verdes.

1. **Vitest no web** com Testing Library e jsdom; um teste real de `lib/format` (`formatBRL` e data sem deslocamento de fuso) escrito primeiro. Adicionar a dependência em `@app/core`.
2. **Playwright** com projetos desktop e celular, `webServer` do web e um E2E de fumaça sobre a página atual (abre, responde, sem erro no console).
3. **CI:** job `e2e` (navegadores com dependências, relatório como artefato, 1 worker, build e start do web) e job `integration` (`test:int`). Os dois jobs rodam na página atual, antes de qualquer visual.
4. **Next:** `cacheComponents` e `partialPrefetching` explícitos, cabeçalhos de segurança básicos, esquema de ambiente mínimo do web. O E2E de fumaça continua verde.
5. **Tailwind 4, shadcn e a casca:** tema neutro, layout autenticável no futuro, navegação para celular e desktop (rotas dos `.gitkeep`, cada uma com uma página mínima), páginas de erro, carregando e não encontrado. O E2E de fumaça passa a validar a casca em viewport de celular.
6. **`lib/api`, `lib/query` e `rewrites`:** cliente tipado, provedor do TanStack Query com `QueryClient` novo por requisição no servidor, e um teste contra servidor falso.
7. **Prova do Recharts:** renderiza um gráfico mínimo em teste de componente com React 19. Sem página.
8. **Fechamento:** conferir o "Pronto quando", atualizar a tabela do `painel.md` e o `andamento.md`, rever o contexto do Claude (propor, sem criar) e sugerir a mensagem de commit.

## 11. Testes

- **Unitário:** `formatBRL` (centavos para "R$ 1.234,56" e zero; `Money` não admite negativo) e datas `YYYY-MM-DD` formatadas em `America/Sao_Paulo` sem passar por `new Date("YYYY-MM-DD")`.
- **Componente:** casca (navegação, estados vazio, carregando e erro).
- **E2E de fumaça:** a página abre, responde 200, sem erro no console, nos projetos desktop e celular; navegação do menu funciona no celular.
- **Contrato do cliente:** `lib/api` contra servidor falso, incluindo o repasse de `/api/*`.
- Dados determinísticos; nenhum teste depende de relógio real ou rede externa.

## 12. Pronto quando

`pnpm typecheck && pnpm lint && pnpm test` passam; o E2E de fumaça e a suíte de integração passam no CI; a casca abre bem em viewport de celular (FM1 do `painel.md`).

## 13. Decisões deste desenho

**Do Luís:** F0 inteira numa só entrega; ordem com a rede de segurança primeiro; sem identidade visual.

**Minhas, para o Luís corrigir:**
- Tema neutro padrão do shadcn, sem tokens de marca.
- Formatação de datas em `apps/web/lib/format`, e não no `core`, porque é apresentação (a regra "formatação só na borda" do `CLAUDE.md`). `formatBRL` continua vindo do `core`.
- No CI, o E2E roda sobre `next build` e `next start` (comportamento de produção, onde o Cache Components importa); localmente reaproveita o servidor de desenvolvimento.
- Navegação com as rotas já previstas nas pastas (`lancamentos`, `dashboard`, `exportacoes`, `configuracoes`), cada uma com página de "em construção".
- Recharts apenas como prova de compatibilidade, sem página.

## 14. Deixado ao construtor

Nome e conteúdo exatos dos cabeçalhos de segurança; estrutura interna de `lib/`; como isolar o esquema de ambiente do web; layout de teste (arquivos `*.test.ts` ao lado do código, `test/` para E2E); detalhes que o `shadcn init` decidir.

## 15. Desvios registrados na execução (06/11/2026)

- `Money` não admite negativo; o teste de `formatBRL` cobre valor comum e zero.
- O E2E usa a porta 3100 e uma API falsa na 4010: `next dev` localmente e `next build` + `next start` no CI (as duas portas evitam conflito com o `pnpm dev`).
- O `shadcn init` atual (4.23, preset `base-nova`) gera componentes sobre `@base-ui/react` (não Radix) e usa o pacote `cn`. Mantido como gerado. A fonte Geist do Google foi trocada por pilha do sistema (sem rede no build e sem fonte de marca).
- O Biome precisou de `css.parser.tailwindDirectives`; o Vitest, de JSX automático (`oxc`) e `cleanup` manual (o tsconfig usa `jsx: "preserve"` e não há `globals`).
- `rewrites()` usa `API_URL` padrão `http://localhost:4000` fora de produção; em produção a variável é obrigatória.
