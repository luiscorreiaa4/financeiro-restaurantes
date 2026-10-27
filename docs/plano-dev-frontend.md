# Plano de desenvolvimento: painel web (frontend)

Atualizado em 27/10/2026. Cobre a fase 4 do `docs/mvp.md` e o que o painel exige da API. O canal de WhatsApp e a IA têm plano próprio em `docs/plano-dev-canal-whatsapp.md`.

Legenda de confiança, usada em todo o documento:

- ✅ conferido na documentação oficial em 27/10/2026
- ⚠️ vem de fonte secundária, de lembrança minha ou não foi confirmado: **verificar antes de depender**
- 🧭 decisão nossa (recomendação), sujeita ao seu OK

## Como retomar este plano (leia primeiro)

**Para continuar em uma sessão nova:** leia `CLAUDE.md`, depois este arquivo, e execute a **primeira etapa com status "A fazer"** da tabela abaixo (respeitando as dependências da seção 9). Ao terminar uma etapa, atualize a tabela e o campo "Atualizado em".

| Etapa | Status | Observação |
|---|---|---|
| F0 Fundação do web | A fazer | Pode começar já. Ler as páginas do Playwright (`webServer`, `projects`, `auth`, CI) |
| F1 Autenticação e sessão | A fazer | Depende do banco (E2 do canal WhatsApp). Fazer prova de conceito do Better Auth com Fastify antes |
| F2 Conta, unidade e permissões | A fazer | |
| F3 Lançamentos | A fazer | |
| F4 Dashboard | A fazer | |
| F5 Exportação Excel/CSV | A fazer | Escolher a biblioteca de planilha (D-F7) |
| F6 Configurações | A fazer | |
| F7 PWA e responsividade | A fazer | |
| F8 Endurecimento e lançamento | A fazer | |

**Fechamento de etapa (sempre, antes de marcar "Feita"):**
1. Rodar `pnpm typecheck && pnpm lint && pnpm test` (e o E2E, quando a etapa tiver) e conferir que a etapa cumpre o "Pronto quando".
2. Atualizar a tabela de progresso e o campo "Atualizado em".
3. **Revisar o contexto do Claude.** Responder: o que repetiu ou deu errado nesta etapa e vale virar regra (`.claude/rules`), skill, hook, `CLAUDE.md` do módulo ou subagente? Usar o critério: erro repetido duas vezes vira regra ou `CLAUDE.md`; procedimento colado pela terceira vez vira skill; o que precisa acontecer sempre vira hook. **Propor e esperar aprovação; não criar sozinho.**
4. Sugerir a mensagem de commit em Conventional Commits. Não commitar sem pedido.

**Decisões já tomadas (27/10/2026):** D-F1 (Better Auth na API, com `rewrites` no web), D-F5 (login por e-mail primeiro, WhatsApp depois). As demais (D-F2, D-F3, D-F4, D-F6, D-F7) seguem como recomendação até você confirmar.

**Prazo (ajuste seu, 27/10/2026):** F0 a F2 juntas, de 2 a 3 semanas (8 a 15 dias úteis), não 3,5 a 5,5.

## 1. Objetivo e escopo

O painel é o lugar de **consulta, edição e exportação**. O lançamento do dia a dia é feito pelo WhatsApp. O dono do restaurante abre o painel principalmente no **celular**, e o contador no desktop.

**Dentro (MVP):** login por código, seleção de conta e unidade, lista de lançamentos com filtros, edição e lixeira, "ver origem" (texto, áudio ou imagem), histórico de versões, dashboard, exportação Excel/CSV, gestão de usuários e papéis, formas de pagamento e taxas, layout responsivo e PWA.

**Fora do MVP:** app nativo (Expo), lançamento manual completo no painel, perguntas em linguagem natural, importação de planilhas, perfil contador multi-cliente.

**Princípio:** o painel **nunca calcula dinheiro**. Ele apresenta o que a API devolveu. Somas, taxas e líquidos vêm do banco e do `core`. A formatação (`formatBRL`) acontece só na borda.

## 2. Tecnologias: o que a documentação atual diz

Versões instaladas hoje: Next.js 16.4.3, React 19.3.1, TypeScript 7.0.2, Zod 4.6.7, Vitest 5.0.5.

| Tecnologia | O que a doc diz | Consequência para nós |
|---|---|---|
| **Next.js 16 (App Router)** ✅ | **Cache Components** ligados com `cacheComponents: true` e `partialPrefetching: true` em `next.config.ts`. Apps novos já vêm com ambos. A doc manda definir `partialPrefetching` explicitamente (deixar sem definir gera aviso). **Partial Prerendering** é o comportamento padrão: casca estática + trechos dinâmicos em `<Suspense>`. Diretiva `"use cache"` com `cacheLife` e `cacheTag`. `cookies()`, `headers()`, `params` e `searchParams` são APIs de runtime e devem ficar sob `<Suspense>`. Segundo a doc, as duas opções serão padrão na próxima versão maior. | Nosso `next.config.ts` ainda não tem as duas flags: ligar na F0. Estruturar páginas com a casca estática e dados do tenant em `<Suspense>`. |
| **`proxy.ts` (antigo middleware)** ✅ | Desde o Next 16, middleware se chama **Proxy**. Arquivo `proxy.ts` na raiz. A doc diz que não serve para busca lenta de dados nem como solução completa de sessão ou autorização, só para "checagens otimistas" (redirecionar quem não tem cookie). | `proxy.ts` só redireciona quem não tem cookie de sessão. A **autorização real** acontece na API e em cada leitura de dados no servidor. |
| **`use cache` e dados de tenant** ✅ + 🧭 | O resultado de funções com `use cache` é guardado e **argumentos viram parte da chave**. Por padrão fica em memória por instância. `"use cache: private"` existe e guarda só no navegador. | 🧭 **Regra:** dado de tenant nunca entra em cache compartilhado do servidor. Sem `use cache` em consultas de tenant; se um dia for necessário, `tenantId` entra como argumento e a decisão é revisada. `use cache` fica para conteúdo público (página de login, páginas institucionais). |
| **Tailwind CSS 4.3** ✅ | Instalação com `tailwindcss`, `@tailwindcss/postcss` e `postcss`; `postcss.config.mjs` com o plugin; `@import "tailwindcss";` no CSS global; **sem `tailwind.config.js`** na instalação, configuração em CSS (variáveis de tema). | Tokens de design em `@theme` no CSS. Nada de arquivo de config JS. |
| **shadcn/ui** ✅ | CLI `shadcn@latest init -t next`. Para monorepo: flag `--monorepo`; ao adicionar componente, rodar de `apps/web` ou usar `-c apps/web`; imports em `@workspace/ui/components/...`. Há componentes de Chart, Data Table, Field/Input/Select e exemplos com React Hook Form, TanStack Form e Formisch. A página **não** diz se Tailwind v4 e React 19 são suportados. | ⚠️ Confirmar suporte a Tailwind 4 e React 19 ao rodar o `init`. Decisão D-F2 sobre `packages/ui`. |
| **Recharts** ⚠️ | A página consultada não informa a versão atual nem o suporte ao React 19. Informa que o `react-is` precisa ter a mesma versão do `react`. O Chart do shadcn é construído sobre o Recharts. | Confirmar versão e compatibilidade com React 19 na instalação. Instalar `react-is` alinhado ao React. |
| **TanStack Query v5** ✅ | Padrão para o App Router: `QueryClient` novo por requisição no servidor, prefetch em Server Component, `HydrationBoundary` com `dehydrate`. Desde a 5.40 dá para **não** usar `await` e transmitir queries pendentes (`useSuspenseQuery`). Não usar Server Actions para buscar dados em `queryFn`; Server Actions são para mutações. Não renderizar no servidor o resultado de `queryClient.query` e depois refazer no cliente (dessincroniza). | Leituras interativas (filtros, paginação, dashboard) com TanStack Query hidratado; mutações por Server Action ou chamada direta à API. |
| **Better Auth: Email OTP** ✅ | Plugin `emailOTP` com callback `sendVerificationOTP({ email, otp, type })`; `type` é `sign-in`, `email-verification` ou `forget-password`. Padrões: expira em **300 s**, **6 dígitos**, **3 tentativas** (depois `TOO_MANY_ATTEMPTS`), reenvio por padrão gera código novo (`rotate`). Cadastra automaticamente quem não existe, a menos que `disableSignUp: true`. A doc manda **não** usar `await` no envio, para evitar ataque de tempo. A página **não** descreve limite de envios. | `disableSignUp: true` (só entra quem foi convidado). Rate limit de **envio** é nosso, na API. |
| **Better Auth: Phone Number** ✅ | Callback `sendOTP({ phoneNumber, code }, ctx)`; verificação em `POST /phone-number/verify`; `signUpOnVerification` exige `getTempEmail`. Mesmos padrões de 300 s, 6 dígitos e 3 tentativas. A doc só descreve SMS e **não trata WhatsApp**. Também não mostra o schema gerado nem o adaptador Drizzle. | O callback é livre, então WhatsApp é possível em princípio. ⚠️ Enviar código fora da janela de 24 h exige template aprovado da Meta (a mensagem inicia a conversa e é cobrada). Não li a doc de templates de autenticação. |
| **Playwright** ✅ parcial | Suporta Node 22, 24 e 26. Configuração em `playwright.config.ts` (browsers, projetos, retries, reporters). As páginas de `webServer`, `projects`, `auth` (`storageState`) e CI existem, mas **não foram lidas**. | ⚠️ Ler essas quatro páginas na F0. |
| **Node, Biome, Turborepo** | Biome 2.6 e Turborepo 2.11 já instalados. | Biome formata CSS e JS; Markdown fica fora. |

## 3. Arquitetura

### 3.1 Como o painel se conecta ao restante

```
Navegador ──► apps/web (Next.js)  ── Server Components e Server Actions ──┐
    │             │ rewrites /api/*                                       │
    └─ fetch ─────┴──────────────► apps/api (Fastify) ◄───────────────────┘
                                      │  autoriza (sessão + permissão)
                                      ▼
                                   Postgres (RLS, withTenant)
```

- O painel **não acessa o banco**. Toda regra de permissão vive na API (decisão já registrada em `docs/arquitetura.md`).
- 🧭 `apps/web` repassa `/api/*` para `apps/api` com `rewrites`, para os cookies serem de primeira parte (mesma origem). ⚠️ Não verifiquei a configuração de `rewrites` nem a integração do Better Auth com o Fastify.
- Server Components chamam a API repassando o cookie da requisição. Client Components chamam a mesma API pelo navegador.

### 3.2 Contrato da API (tipos compartilhados)

🧭 Os schemas Zod do contrato (filtros, DTOs de lançamento, paginação) ficam em um único lugar importado pela API e pelo web. Como o `CLAUDE.md` fixa a estrutura de pacotes, a recomendação é um subcaminho `@app/core/contracts` (somente Zod e tipos, sem infra). Alternativa: gerar OpenAPI a partir dos mesmos schemas (`@fastify/swagger` com `jsonSchemaTransform`, ✅ suportado pelo `fastify-type-provider-zod` v7+) e um cliente tipado a partir dele. Fica como decisão D-F3.

**Dinheiro no contrato:** inteiro em centavos. O JSON não carrega `bigint`, então o contrato usa `number` inteiro seguro (até ~R$ 90 trilhões), validado por Zod, ou string decimal de inteiros. 🧭 Decisão D-F4.

**Datas de negócio** são `date` sem hora (`"2026-10-27"`) e **nunca** passam por `new Date("2026-10-27")`, que interpreta como UTC e pode mostrar o dia anterior no Brasil. Tratar como texto `YYYY-MM-DD` e formatar com `Intl.DateTimeFormat` em `America/Sao_Paulo`. Timestamps (`timestamptz`) são ISO 8601.

### 3.3 Estrutura de pastas proposta (`apps/web`)

```
apps/web/
  app/
    (public)/login/                 página de login (casca estática)
    (app)/layout.tsx                casca autenticada (sessão, seletor de conta/unidade)
    (app)/lancamentos/              lista, filtros, drawer de edição, lixeira
    (app)/dashboard/
    (app)/exportacoes/
    (app)/configuracoes/{usuarios,formas-de-pagamento}/
    manifest.ts                     ⚠️ convenção do Next para o manifest do PWA (confirmar)
  proxy.ts                          redireciona quem não tem cookie
  features/                         código por funcionalidade
    entries/ {components, queries, actions, schemas, mappers}
    dashboard/ …
    auth/ …
  components/ui/                    shadcn (ou @workspace/ui, ver D-F2)
  lib/
    api/                            cliente tipado da API (servidor e navegador)
    auth/ session.ts                leitura de sessão no servidor (única porta de entrada)
    format/                         formatBRL, datas, números (reexporta o core)
    query/                          get-query-client, chaves de query
```

Regras: `features/*` não importam umas das outras; o que for comum sobe para `lib/` ou `components/`. Server Components por padrão; `"use client"` só no que tem estado ou evento.

### 3.4 Dados, estado e formulários

| Assunto | Escolha | Observação |
|---|---|---|
| Leitura inicial | Server Component faz prefetch e hidrata o TanStack Query ✅ | Sem `await` onde streaming ajudar |
| Estado de filtros | **Na URL** (`searchParams`), não em estado local | Compartilhável, volta com o botão do navegador |
| Paginação | 🧭 Paginação por cursor (keyset) na API | Evita pular ou repetir linhas quando entram lançamentos novos |
| Mutações | Server Action ou chamada direta à API, invalidando as queries afetadas | Conflito de edição: a API devolve 409 com a versão atual; a UI mostra "alguém alterou, recarregar?" |
| Formulários | 🧭 React Hook Form + resolver do Zod ⚠️ (confirmar compatibilidade com Zod 4) | O mesmo schema do contrato valida no cliente e na API |
| Tabelas | 🧭 TanStack Table via componente Data Table do shadcn ⚠️ | Confirmar a base do componente ao adicioná-lo |
| Tema | Tokens em `@theme` (Tailwind 4) ✅; modo escuro opcional | Contraste mínimo AA |

### 3.5 Segurança do painel

- Cookie `httpOnly`, `secure`, `sameSite=lax` (regra já no `docs/arquitetura.md`).
- **Autorização na API sempre.** Esconder um botão na UI é conforto, não segurança. A UI usa `can()` do `core` para decidir o que mostrar, e a API repete a checagem.
- Categorias sensíveis (folha) filtradas **na API** por permissão.
- Texto de mensagem do usuário é entrada não confiável: renderizado como texto, nunca como HTML.
- URLs assinadas de curta duração para áudio, imagem e exportação (S3). Nunca expor o caminho do bucket.
- Cabeçalhos de segurança e CSP definidos no Next. ⚠️ Não li a doc de CSP do Next.
- Nada de segredo no cliente: só variáveis públicas explícitas.
- Rate limit de envio de código (OTP) por e-mail, telefone e IP, na API. A doc do Better Auth só limita as **tentativas** de verificação ✅.

### 3.6 Desempenho e acessibilidade

- 🧭 Metas usuais do Web Vitals em celular de gama média com 4G: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 ⚠️ (valores de convenção, não conferidos nesta pesquisa).
- Casca estática por Partial Prerendering e dados do tenant em streaming ✅.
- Orçamento de JavaScript por rota, medido na CI (F8).
- Acessibilidade: alvo WCAG 2.2 AA. Gráficos sempre com **alternativa em tabela**. Navegação por teclado. Toques com área mínima confortável.
- Textos, moeda e datas em pt-BR (`Intl`). Fuso `America/Sao_Paulo`.

## 4. Decisões que precisam do seu OK

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D-F1 ✅ **Decidido** | Onde roda o Better Auth: na API (Fastify) ou no Next? | **Na API**, com `rewrites` no web. | A API já é a autoridade de permissão e o painel não acessa o banco. Evita duas fontes de verdade para sessão. ⚠️ Confirmar integração com Fastify. |
| D-F2 | shadcn: `packages/ui` (flag `--monorepo`) ou direto em `apps/web`? | 🧭 Direto em `apps/web` no MVP. | Só há um app com UI. Extrair para pacote quando houver um segundo consumidor. O CLAUDE.md fixa os pacotes. |
| D-F3 | Contrato: schemas Zod em `core/contracts` ou OpenAPI gerado? | 🧭 Zod compartilhado + OpenAPI gerado como documentação. | Mais simples, sem etapa de geração de cliente. |
| D-F4 | Dinheiro no JSON: `number` inteiro ou string? | 🧭 `number` inteiro validado. | Ergonomia. Seguro até ~9×10¹⁵ centavos. |
| D-F5 ✅ **Decidido** | Login por WhatsApp já no MVP? | **E-mail primeiro.** WhatsApp depois, quando houver template de autenticação aprovado. | O código por WhatsApp inicia conversa e depende da Meta. |
| D-F6 | Lançamento manual no painel? | 🧭 Fora do MVP. Só edição e exclusão. | Alinhado ao `docs/mvp.md`. |
| D-F7 | Biblioteca de planilha Excel | Decidir na F5. ⚠️ | Não pesquisei opções, licenças e manutenção. |

## 5. Estratégia de testes

### 5.1 Pirâmide

| Nível | O que cobre | Ferramenta | Roda quando |
|---|---|---|---|
| Unitário | Mapeadores de dados para gráficos, formatação de moeda e data, filtros ↔ URL, `can()` | Vitest, sem mocks | Todo commit |
| Componente | Formulários, tabela, drawer, estados vazio, carregando e erro | Vitest + Testing Library em jsdom ⚠️ | Todo commit |
| Contrato | Respostas da API contra os schemas Zod do contrato | Vitest | Todo commit |
| Integração da API do painel | Endpoints reais com Postgres de teste, permissões e RLS | Vitest + Testcontainers | Todo PR |
| **Ponta a ponta** | Fluxos completos no navegador contra a pilha real (Postgres + API + web) | **Playwright** | Todo PR (suíte rápida) e antes de release (completa) |
| Acessibilidade | Páginas principais sem violações graves | Verificação automatizada dentro do Playwright ⚠️ (ferramenta a escolher) | Todo PR |
| Reconciliação de números | Cada total do dashboard bate com uma consulta SQL independente sobre os mesmos dados | Teste de integração | Todo PR |

**Server Components não têm bom teste unitário.** São cobertos por testes de contrato da API e pelo E2E.

### 5.2 Convenções

- **Dados de teste determinísticos:** seed fixo com datas históricas e valores conhecidos; os testes escolhem um período explícito, nunca "hoje".
- **Login nos testes E2E:** o código OTP é lido do banco por um auxiliar de teste (nunca por endpoint exposto em produção). O estado de autenticação é reaproveitado entre testes (`storageState`) ⚠️.
- **Projetos do Playwright:** desktop e **celular** (viewports móveis), porque o dono usa o celular ⚠️ (opções exatas na doc de `projects`).
- **Diagnóstico:** traces e capturas guardados como artefato da CI quando um teste falha.
- Seletores por papel e texto acessível, não por classe CSS.
- **Teste de permissão de ponta a ponta:** o mesmo fluxo roda com papéis diferentes (dono, gerente, lançador, contador) e valida o que cada um vê e consegue fazer.
- **Isolamento entre contas no E2E:** um usuário de duas contas não vê dados cruzados ao trocar de conta.

### 5.3 Jobs de CI propostos

1. `check`: lint, typecheck e testes unitários, de componente e de contrato (o job atual cresce).
2. `integration`: Postgres via Testcontainers.
3. `e2e`: sobe Postgres, API e web e roda o Playwright. Browsers instalados e em cache.
4. `budget`: orçamento de JavaScript e Lighthouse por rota crítica (F8).

## 6. API do painel (construída em `apps/api`, fatia por fatia)

Cada etapa do front traz o seu pedaço da API. Todos os endpoints validam entrada com Zod, exigem sessão, checam permissão e rodam em `withTenant`.

| Endpoint (proposta) | Usado em | Observações |
|---|---|---|
| `POST /api/auth/*` (Better Auth) | F1 | OTP por e-mail |
| `GET /api/me` | F1, F2 | Usuário, contas, unidades e papéis |
| `GET /api/entries` | F3 | Filtros: período, tipo, categoria, unidade, busca; cursor; exclui apagados |
| `GET /api/entries/:id` | F3 | Inclui origem e versões |
| `PATCH /api/entries/:id` | F3 | Exige a versão esperada (409 se mudou); gera `entry_versions` |
| `DELETE /api/entries/:id` e `POST /api/entries/:id/restore` | F3 | Soft delete e restauração |
| `GET /api/entries/:id/source` | F3 | URL assinada de áudio ou imagem |
| `GET /api/reports/summary`, `/by-category`, `/monthly` | F4 | Agregações calculadas no banco |
| `POST /api/exports` e `GET /api/exports/:id` | F5 | Cria job e informa estado e link assinado |
| `GET/POST/PATCH /api/members` | F6 | Convite por telefone, papéis |
| `GET/POST/PATCH /api/payment-methods` | F6 | Taxas em pontos-base |

## 7. Etapas

Cada etapa termina com algo testável. Os tamanhos são relativos (P, M, G).

### F0: Fundação do web — M

**Entregas**
- `next.config.ts` com `cacheComponents: true` e `partialPrefetching: true` explícitos ✅.
- Tailwind 4 (`@tailwindcss/postcss`, `@import "tailwindcss"`) e tokens de design em `@theme`.
- shadcn inicializado conforme D-F2 (⚠️ confirmar suporte a Tailwind 4 e React 19).
- Casca da aplicação: layout, navegação para celular e desktop, páginas de erro, carregando e não encontrado.
- Cliente tipado da API (`lib/api`) e utilitários de formato (`formatBRL`, datas) reexportados do `core`.
- `get-query-client` e provedor do TanStack Query ✅.
- Configuração de testes: Vitest + Testing Library, Playwright com projetos desktop e celular (ler as páginas de `webServer`, `projects`, `auth` e CI da doc do Playwright).
- Cabeçalhos de segurança básicos.
- Jobs `e2e` e `integration` no CI.

**Testes:** teste de fumaça E2E (a página abre, responde, sem erro no console); testes unitários de formatação (centavos para "R$ 1.234,56", datas sem deslocamento de fuso).

**Pronto quando:** `pnpm test` e o E2E de fumaça passam no CI e a casca abre bem em viewport de celular.

### F1: Autenticação e sessão — M/G (depende da E2 do plano do canal WhatsApp)

**Entregas**
- Better Auth configurado conforme D-F1, com `emailOTP` e `disableSignUp: true` ✅. Sessão em cookie `httpOnly`.
- Tabelas de auth integradas ao schema (⚠️ não vi o schema gerado nem o adaptador Drizzle; gerar e **incorporar ao nosso schema e às migrations do drizzle-kit**, para manter RLS e revisão de SQL).
- Página de login: pedir e-mail, enviar código, digitar código, estados de erro (código errado, expirado, excesso de tentativas) ✅.
- Envio do código sem `await`, como manda a doc ✅. Rate limit de envio na API.
- `proxy.ts`: redireciona quem não tem cookie. Leitura de sessão no servidor em um único lugar (`lib/auth/session.ts`), usada por toda página e ação.
- Logout e expiração de sessão.
- E-mail do código por um serviço de e-mail (a escolher; depende do domínio da empresa).

**Testes:** E2E do fluxo completo de login; código expirado; 3 tentativas erradas bloqueiam; usuário não cadastrado não entra; acesso a página protegida sem sessão redireciona; **a API recusa chamada sem sessão mesmo se o `proxy.ts` for contornado**.

**Pronto quando:** um usuário convidado entra por código e um não convidado é recusado.

### F2: Conta, unidade e permissões — M

**Entregas**
- Seletor de conta (tenant) e de unidade, com a escolha guardada e **revalidada no servidor** a cada requisição (vínculo existe e está ativo).
- `can()` do `core` aplicado à navegação e às ações. A API repete a checagem.
- Estados para usuário sem vínculo e para conta desativada.

**Testes:** matriz papel × ação no E2E; trocar de conta não mostra dado da anterior (inclusive com cache do TanStack Query: chave de query inclui tenant e unidade); manipular o cookie da conta ativa para outro tenant é recusado pela API.

**Pronto quando:** dois usuários em contas diferentes nunca veem dados um do outro.

### F3: Lançamentos — G

**Entregas**
- Lista com filtros (período, tipo, categoria, unidade, busca) **na URL**, ordenação, paginação por cursor, totais da página vindos da API, estados vazio, carregando e erro.
- Drawer de edição com formulário validado pelo schema do contrato; envia a versão esperada; trata 409 ("este lançamento foi alterado").
- Excluir para a lixeira e restaurar; visão da lixeira.
- **"Ver origem":** texto original, player de áudio com a transcrição ao lado, ou imagem da nota, por URL assinada de curta duração.
- **Histórico de versões:** quem, quando, canal (WhatsApp, painel, sistema) e o que mudou (antes/depois).
- Campos de dinheiro com máscara de entrada em reais, convertidos para centavos sem `float`.
- Categorias sensíveis ocultas conforme a permissão.

**Testes:** unitário da conversão de entrada em reais para centavos (vírgula, ponto, milhar); componentes do formulário; E2E de editar, excluir, restaurar e ver origem; conflito de edição entre duas abas; filtros sobrevivem a recarregar e ao botão voltar; permissão (lançador sem acesso a categoria sensível não vê o valor); a edição gera versão (verificada pela API).

**Pronto quando:** um lançamento criado pelo WhatsApp aparece, é editado no painel, e o histórico mostra as duas origens.

### F4: Dashboard — G

**Entregas**
- Indicadores: receita, despesa, resultado do mês, e os que o Matheus definir (CMV %, folha %, ticket médio, margem). Folha só para quem tem permissão.
- Gráficos: receita × despesa, despesas por categoria, evolução mensal, resultado (Recharts via componente Chart do shadcn, ⚠️ confirmar versão e React 19).
- Seletor de período e de unidade; comparação com o período anterior.
- **Todos os números vêm de endpoints de agregação**; o front não soma dinheiro.
- Alternativa em tabela para cada gráfico (acessibilidade) e estados vazios úteis ("ainda não há lançamentos neste período").
- Carregamento em streaming por cartão (`<Suspense>` por bloco) ✅, sem `use cache` compartilhado para dados do tenant.

**Testes:** unitário dos mapeadores de dados para o formato dos gráficos; **reconciliação:** cada total do dashboard bate com uma consulta SQL independente; E2E com seed fixo conferindo valores exatos na tela; verificação de acessibilidade; teste de que um papel sem permissão não recebe o indicador de folha na resposta da API (não só some da tela).

**Pronto quando:** os totais da tela são idênticos aos do banco para o seed de referência.

### F5: Exportação Excel/CSV — M

**Entregas**
- Exportação como **job** em fila (pg-boss), arquivo no S3 e **link assinado** com validade curta; a tela mostra estado (na fila, pronto, falhou). Respeita os mesmos filtros e permissões da lista.
- CSV com separador e codificação que o Excel em português abre sem estragar acentos (costuma exigir `;` e UTF-8 com BOM ⚠️, validar abrindo no Excel).
- Excel (`.xlsx`) com biblioteca escolhida em D-F7. Valores numéricos como número, datas como data, nunca texto.
- Pacote para o contador (modelo definido pelo Matheus).

**Testes:** o arquivo gerado tem as colunas, a soma e a contagem esperadas para o seed; a exportação respeita permissão (categoria sensível fora); link expira; arquivo de outro tenant não é acessível; E2E do download.

**Pronto quando:** o contador abre o arquivo no Excel e os totais batem com o painel.

### F6: Configurações — M

**Entregas**
- Usuários e papéis: o dono convida pelo telefone, define papel e unidades; ativa e desativa.
- Formas de pagamento e taxas (percentual em pontos-base e valor fixo em centavos), com pré-visualização do líquido calculado pelo `core`.
- Categorias: leitura no MVP; edição fica para depois do plano validado pelo Matheus.

**Testes:** só o papel certo acessa; telefone normalizado com e sem o 9º dígito (mesma regra do canal); desativar usuário impede o login e o uso do WhatsApp; taxa muda o líquido de novos lançamentos e **não** reescreve os antigos.

**Pronto quando:** o dono convida um funcionário, que lança pelo WhatsApp e aparece no painel.

### F7: PWA e responsividade — M

**Entregas**
- Manifest do PWA e ícones ⚠️ (usar a convenção de manifest do Next; confirmar na doc).
- Instalável no celular; tela inicial rápida; comportamento offline limitado a uma tela de aviso ⚠️ (service worker a definir; não li o guia de PWA do Next).
- Revisão mobile de todas as telas: tabelas viram cartões, filtros em folha lateral, alvos de toque confortáveis.

**Testes:** projetos de celular no Playwright em todos os fluxos principais; auditoria de instalabilidade; capturas em larguras de referência (verificação visual opcional).

**Pronto quando:** o dono instala o painel no celular e usa a lista e o dashboard sem rolagem horizontal.

### F8: Endurecimento e lançamento — M

**Entregas**
- Auditoria de acessibilidade (WCAG 2.2 AA) nas telas principais.
- Orçamento de desempenho por rota e verificação na CI; metas de Web Vitals (3.6).
- Sentry no Next, sem dados pessoais (regra do CLAUDE.md).
- Cabeçalhos de segurança e CSP revisados ⚠️.
- Revisão de cache: confirmar que nenhum dado de tenant passa por cache compartilhado.
- Deploy em staging e produção; suíte E2E completa em staging; verificação de que o número do WhatsApp, o domínio e os cookies funcionam no domínio real.

**Pronto quando:** a suíte completa passa em staging e o piloto pode usar o painel.

## 8. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Tailwind 4, React 19 ou Recharts incompatíveis com algum componente | Retrabalho na F0 e F4 | Confirmar na instalação; prova de conceito de um gráfico na F0 |
| Cache Components mal usado vazando dado entre contas | Incidente grave | Regra de nunca usar cache compartilhado em dado de tenant; teste E2E de troca de conta; revisão na F8 |
| Better Auth + Fastify + `rewrites` mais complexo do que parece | Atraso na F1 | Prova de conceito curta antes de fechar D-F1; plano B: Better Auth no Next lendo o mesmo banco |
| Código por WhatsApp depende da Meta | Login atrasado | E-mail primeiro (D-F5) |
| Números divergentes entre painel e banco | Perda de confiança do contador | Teste de reconciliação no CI |
| Edição concorrente (painel e WhatsApp ao mesmo tempo) | Perda de alteração | Versão esperada e 409 com mensagem clara |
| Celular fraco e rede ruim | Painel lento | Casca estática, streaming por cartão, orçamento de JS |

## 9. Ordem e marcos

```
(canal WhatsApp) E2 banco ─► F0 ─► F1 ─► F2 ─► F3 ─► F4 ─► F5
                                                  └──► F6 ─► F7 ─► F8
```

- A F0 pode começar já, em paralelo com o plano do canal WhatsApp, porque só depende do scaffold atual.
- A F1 precisa do banco da E2 do plano do canal WhatsApp (usuários e vínculos).
- A F3 só tem dados reais depois da E7 do plano do canal WhatsApp (mensagem virando lançamento). Até lá usa o seed.
- F5 e F6 podem andar em paralelo depois da F3.

| Marco | Resultado verificável |
|---|---|
| FM1 (fim da F0) | Casca no ar, CI com E2E de fumaça |
| FM2 (fim da F2) | Login por código, troca de conta, isolamento comprovado |
| FM3 (fim da F3) | Lançamento do WhatsApp visível e editável, com histórico |
| FM4 (fim da F4) | Dashboard com totais reconciliados com o banco |
| FM5 (fim da F6) | Exportação e configurações prontas |
| FM6 (fim da F8) | Painel pronto para o piloto, auditado e medido |

## 10. Fontes consultadas (27/10/2026)

- Next.js, primeiros passos: https://nextjs.org/docs/app/getting-started
- Next.js, cache com Cache Components: https://nextjs.org/docs/app/getting-started/caching
- Next.js, Proxy: https://nextjs.org/docs/app/getting-started/proxy
- Tailwind CSS com Next.js: https://tailwindcss.com/docs/installation/framework-guides/nextjs
- shadcn/ui com Next.js: https://ui.shadcn.com/docs/installation/next
- TanStack Query, SSR avançado: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr
- Better Auth, Email OTP: https://www.better-auth.com/docs/plugins/email-otp
- Better Auth, Phone Number: https://www.better-auth.com/docs/plugins/phone-number
- Playwright, introdução: https://playwright.dev/docs/intro
- fastify-type-provider-zod (OpenAPI): https://github.com/turkerdev/fastify-type-provider-zod
- Recharts: https://github.com/recharts/recharts (a página consultada não trouxe versão nem suporte ao React 19)
