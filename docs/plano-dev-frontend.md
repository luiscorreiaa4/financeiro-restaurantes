# Plano de desenvolvimento: painel web (frontend)

> **Papel deste documento:** **ordem de execução** do painel web. Cada etapa lista os requisitos (RFs) que entrega e **não** copia regra de negócio: a regra está em [`requisitos.md`](requisitos.md) (cite `RFnn.Rn`), o porquê das decisões em [`decisoes.md`](decisoes.md) e a técnica em [`arquitetura.md`](arquitetura.md). Em conflito, vale `requisitos.md`.

Atualizado em 29/10/2026 (alinhado ao Documento de Requisitos v1.0). Cobre a fase 4 do `docs/mvp.md` e o que o painel exige da API. O canal de WhatsApp e a IA têm plano próprio em `docs/plano-dev-canal-whatsapp.md`.

**Pendências P01 a P11 (Matheus) não bloqueiam nenhuma etapa.** Onde o requisito traz `[PROVISÓRIO – Pxx]` (categorias, indicadores, impostos, planos e preços), a implementação isola o valor em configuração ou constante única (DN-11).

**Pendências da Meta (28/10/2026) não bloqueiam o painel.** O recebimento real no webhook (P1, app em modo desenvolvimento) e o envio pelo WhatsApp (P2, erro 130497) estão na seção "Pendências da Meta" do plano do canal. O painel usa login por e-mail (D-F5), então F0 a F8 seguem sem depender delas. Só o login por código via WhatsApp e o teste "um lançamento criado pelo WhatsApp aparece no painel" dependem de P1/P2; até lá, usar lançamentos do seed ou criados pelo **chat de desenvolvimento no terminal** (`pnpm dev:chat`, seção 3.6 do plano do canal; só para teste, e o WhatsApp real é ligado no fim, na E10 do canal).

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
| F9 Assinatura, plano e encerramento da conta (RF37) | A fazer (nova, 29/10/2026) | Depende da F1 (conta com plano e situação). Preços e limites: `[PROVISÓRIO – P03]` |
| F10 Painel interno de operação (RF38) | A fazer (nova, 29/10/2026) | Usa `ai_usage` do canal (E6 em diante) |
| F11 v1.1 do painel (RF26, RF28, RF30) | Só listada | Lançamento manual, DRE em PDF e perguntas em linguagem natural; depois do piloto |

### Requisitos por etapa

| Etapa | RFs e RNFs que entrega | Mudança pelos requisitos v1.0 |
|---|---|---|
| F0 | RNF05.R3 e RNF09 (base: casca, estados de tela), RNF10.R2 (PWA, manifest em F7), RNF14 (testes) | Nenhuma |
| F1 | RF01 (autocadastro), RF02 (senha ou código, sessões), RF03 (recuperação), RNF01 | **Sim**: troca "só convidados" por autocadastro e acesso por senha ou código (DN-02, DN-03) |
| F2 | RF02.R6 (seletor de empresa e unidade), RF06 (papéis e permissões), RF05 (leitura), RNF02.R6 | **Sim**: quatro papéis e permissões adicionais |
| F3 | RF22, RF23, RF24, RF25 | **Sim**: lixeira de 30 dias, sinais de revisão e filtros |
| F4 | RF27 (indicadores e gráficos) | **Sim**: indicadores do RF27 `[PROVISÓRIO – P05, P09]` |
| F5 | RF29 (XLSX e CSV, link de 1 hora, arquivo apagado em 7 dias) | **Sim**: regras do RF29 |
| F6 | RF04 (unidades com apelidos), RF05 (colaboradores, unidades em lista), RF07 (subcategorias), RF08, RF09, RF10 | **Sim**: escopo ampliado |
| F7 | RNF09, RNF10 | Nenhuma |
| F8 | RNF05.R3 e R4, RNF09.R3, RNF11 | Nenhuma |
| F9 | RF37 | Nova |
| F10 | RF38, RF21.R4 (alerta de custo), RF03.Obs2 (troca de e-mail do dono pelo suporte) | Nova |

**Fechamento de etapa (sempre, antes de marcar "Feita"):**
1. Rodar `pnpm typecheck && pnpm lint && pnpm test` (e o E2E, quando a etapa tiver) e conferir que a etapa cumpre o "Pronto quando".
2. Atualizar a tabela de progresso e o campo "Atualizado em".
3. **Revisar o contexto do Claude.** Responder: o que repetiu ou deu errado nesta etapa e vale virar regra (`.claude/rules`), skill, hook, `CLAUDE.md` do módulo ou subagente? Usar o critério: erro repetido duas vezes vira regra ou `CLAUDE.md`; procedimento colado pela terceira vez vira skill; o que precisa acontecer sempre vira hook. **Propor e esperar aprovação; não criar sozinho.**
4. Sugerir a mensagem de commit em Conventional Commits. Não commitar sem pedido.

**Decisões:** D-F1 a D-F7 e as decisões novas de 29/10/2026 (DN-01 a DN-12) estão em [`decisoes.md`](decisoes.md). Este plano cita o ID em vez de repetir a explicação. D-F5 e D-F6 foram **ampliadas** em 29/10/2026 (senha ou código; lançamento manual é o RF26 da v1.1).

**Prazo (ajuste seu, 27/10/2026):** F0 a F2 juntas, de 2 a 3 semanas (8 a 15 dias úteis), não 3,5 a 5,5.

## 1. Objetivo e escopo

O painel é o lugar de **consulta, edição e exportação**. O lançamento do dia a dia é feito pelo WhatsApp. O dono do restaurante abre o painel principalmente no **celular**, e o contador no desktop.

**Dentro (MVP):** autocadastro do dono, acesso por senha ou código, seleção de conta e unidade, lista de lançamentos com filtros, edição e lixeira de 30 dias, "ver origem" (texto, áudio ou imagem), histórico de versões, dashboard, exportação XLSX/CSV, gestão de unidades, colaboradores e papéis, categorias, formas de pagamento, canais e taxas, assinatura e período de teste, painel interno, layout responsivo e PWA. Requisitos: RF01 a RF10 (parte de painel), RF22 a RF25, RF27, RF29, RF37 e RF38.

**Fora do MVP (v1.1 ou Fase 2):** app nativo (Expo), lançamento manual (RF26), DRE e PDF (RF28), perguntas em linguagem natural (RF30), importação de planilhas (RF35), perfil contador multicliente (RF36).

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
| **Better Auth: Email OTP** ✅ | Plugin `emailOTP` com callback `sendVerificationOTP({ email, otp, type })`; `type` é `sign-in`, `email-verification` ou `forget-password`. Padrões: expira em **300 s**, **6 dígitos**, **3 tentativas** (depois `TOO_MANY_ATTEMPTS`), reenvio por padrão gera código novo (`rotate`). Cadastra automaticamente quem não existe, a menos que `disableSignUp: true`. A doc manda **não** usar `await` no envio, para evitar ataque de tempo. A página **não** descreve limite de envios. | `disableSignUp: true` no plugin: **o login comum nunca cria usuário**. Quem cria conta é o **endpoint próprio de autocadastro** da API (RF01, DN-02), que grava empresa, unidade e dono numa transação depois de verificar o e-mail por código. Quem é convidado pelo dono entra pelo vínculo (RF05). Rate limit de **envio** é nosso, na API (números em RF02.R4). |
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
- Rate limit de envio de código (OTP) por e-mail e IP, na API (RF02.R4). A doc do Better Auth só limita as **tentativas** de verificação ✅. Bloqueio da senha após 5 erros: RF02.R7.

### 3.6 Desempenho e acessibilidade

- 🧭 Metas usuais do Web Vitals em celular de gama média com 4G: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 ⚠️ (valores de convenção, não conferidos nesta pesquisa).
- Casca estática por Partial Prerendering e dados do tenant em streaming ✅.
- Orçamento de JavaScript por rota, medido na CI (F8).
- Acessibilidade: alvo WCAG 2.2 AA. Gráficos sempre com **alternativa em tabela**. Navegação por teclado. Toques com área mínima confortável.
- Textos, moeda e datas em pt-BR (`Intl`). Fuso `America/Sao_Paulo`.

## 4. Decisões

A explicação de cada decisão (motivo, onde vale e situação) está em [`decisoes.md`](decisoes.md), seção 2. Aqui fica só o índice, para os trechos deste plano que citam o ID.

| ID | Tema | Situação |
|---|---|---|
| D-F1 | Better Auth na API, com `rewrites` no web | Decidida |
| D-F2 | shadcn direto em `apps/web` no MVP | Recomendação |
| D-F3 | Contrato em Zod compartilhado + OpenAPI como documentação | Recomendação |
| D-F4 | Dinheiro no JSON como `number` inteiro | Recomendação |
| D-F5 | Acesso por senha ou código no e-mail; WhatsApp e 2º fator na v1.1 | Decidida, **ampliada em 29/10/2026** (DN-03) |
| D-F6 | Lançamento manual é o RF26 (v1.1); no MVP só edição, lixeira e restauração | Decidida, **ampliada em 29/10/2026** |
| D-F7 | Biblioteca de planilha Excel, decidir na F5 | Aberta |

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
| `POST /api/signup` (autocadastro, endpoint próprio) | F1 | RF01: empresa, unidade e dono em uma transação, depois do e-mail verificado |
| `POST /api/auth/*` (Better Auth) | F1 | Código por e-mail e senha (RF02); recuperação de acesso (RF03); o login comum não cria usuário |
| `GET/DELETE /api/sessions` | F1 | Sessões ativas e encerramento das outras (RF02.R8) |
| `GET /api/me` | F1, F2 | Usuário, contas, unidades, papéis e permissões adicionais |
| `GET /api/entries` | F3 | Filtros: período, tipo, categoria, unidade, busca; cursor; exclui apagados |
| `GET /api/entries/:id` | F3 | Inclui origem e versões |
| `PATCH /api/entries/:id` | F3 | Exige a versão esperada (409 se mudou); gera `entry_versions` |
| `DELETE /api/entries/:id` e `POST /api/entries/:id/restore` | F3 | Soft delete e restauração |
| `GET /api/entries/:id/source` | F3 | URL assinada de áudio ou imagem |
| `GET /api/reports/summary`, `/by-category`, `/monthly` | F4 | Agregações calculadas no banco |
| `POST /api/exports` e `GET /api/exports/:id` | F5 | Cria job e informa estado e link assinado |
| `GET /api/trash` e restauração em lote | F3 | Lixeira de 30 dias (RF24) |
| `GET/POST/PATCH /api/members` | F6 | Convite por telefone, papéis, unidades de acesso e permissões adicionais (RF05) |
| `GET/POST/PATCH /api/units` | F6 | Unidades, apelidos e status (RF04) |
| `GET/POST/PATCH /api/categories` | F6 | Árvore e subcategorias da empresa (RF07) |
| `GET/POST/PATCH /api/payment-methods` | F6 | Taxas em pontos-base (RF08) |
| `GET/POST/PATCH /api/sales-channels` e `/api/suppliers` | F6 | Canais, comissões e fornecedores com mesclagem (RF09, RF10) |
| `GET/PATCH /api/subscription` | F9 | Plano, situação e encerramento; só o Dono (RF37) |
| `/api/internal/*` | F10 | Painel interno; acesso só da equipe, com segundo fator (RF38) |

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

**Entrega os requisitos:** RF01 (autocadastro do dono), RF02 (acesso por senha ou código, sessões, perfil), RF03 (recuperação de acesso), RNF01 (credenciais e sessão). Regras de código, senha, bloqueio e sessão: RF02.R1 a R8 e RF01.R10 a R13. Critérios: RF01.CA01 a CA10, RF02.CA01 a CA09, RF03.CA01 a CA03.

**Mudança pelos requisitos v1.0 (DN-02, DN-03):** o plano antigo previa só usuários convidados e login só por código. Agora o dono **cria a própria conta** e o usuário escolhe **senha ou código**.

**Entregas**
- Better Auth configurado conforme D-F1, com `emailOTP` e `disableSignUp: true` no plugin ✅: o login comum nunca cria usuário. Sessão em cookie `httpOnly` (12 h de inatividade ou 30 dias com "manter conectado", RF02.R5).
- **Endpoint próprio de autocadastro** (`POST /api/signup`): empresa, primeira unidade, usuário dono, vínculo com todas as unidades, formas de pagamento e canais padrão, tudo em uma transação (RF01.Obs2); e-mail verificado por código antes; CNPJ único; celular normalizado; aceite dos termos com data e versões. Conta nasce em teste e ATIVA.
- Login por senha (8 a 64 caracteres, hash forte, bloqueio da senha por 15 minutos após 5 erros) e por código (6 dígitos, 5 minutos, 3 tentativas, reenvio após 60 s, limites por e-mail e IP). Resposta idêntica para e-mail desconhecido (RF02.R1).
- Recuperação de acesso e definição da primeira senha (RF03); aviso por e-mail da troca; encerramento de todas as sessões.
- "Meu perfil": nome, senha, e-mail com verificação, lista de sessões ativas e encerramento das outras (RF02.Obs3, R8).
- Tabelas de auth integradas ao schema (⚠️ não vi o schema gerado nem o adaptador Drizzle; gerar e **incorporar ao nosso schema e às migrations do drizzle-kit**, para manter RLS e revisão de SQL). Campos novos de `tenants` e `users`: `arquitetura.md`, seção de divergências.
- Página de login e de cadastro: pedir e-mail, enviar código, digitar código, estados de erro (código errado, expirado, excesso de tentativas) ✅. Envio do código sem `await`, como manda a doc ✅.
- `proxy.ts`: redireciona quem não tem cookie. Leitura de sessão no servidor em um único lugar (`lib/auth/session.ts`), usada por toda página e ação.
- Logout e expiração de sessão. Trilha de auditoria de login, bloqueio e troca de senha ou e-mail (RNF04.R4).
- E-mail do código por um serviço de e-mail (a escolher; depende do domínio da empresa; SPF, DKIM e DMARC, RNF10.R4).
- Fora desta etapa (v1.1): código por WhatsApp e segundo fator do dono.

**Testes:** E2E do fluxo completo de cadastro e de login; os critérios de aceite acima; **a API recusa chamada sem sessão mesmo se o `proxy.ts` for contornado** (RF02.CA08); gravação do cadastro é atômica e o CNPJ é único em cadastros simultâneos (RF01.CA04 e CA08).

**Pronto quando:** um dono se cadastra sozinho, entra por código e por senha, recupera o acesso, e um e-mail sem vínculo ativo recebe a mesma resposta de um conhecido.

### F2: Conta, unidade e permissões — M

**Entrega os requisitos:** RF02.R6 (seletor de empresa e unidade, revalidação a cada requisição), RF06 (papéis, hierarquia e permissões; a matriz da seção 2.3 como referência), RF05 (leitura de papéis e permissões do usuário logado), RNF02.R6 (nada de cache compartilhado). Critérios: RF02.CA05 a CA07, RF06.CA02, CA04 e CA06.

**Mudança pelos requisitos v1.0 (DN-04):** **quatro papéis** (DONO, GERENTE, LANCADOR; CONTADOR é da Fase 2) e **quatro permissões adicionais** (VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL, CONSULTAR_RELATORIOS_WHATSAPP). O `core` ganha isso na etapa E11 do plano do canal.

**Entregas**
- Seletor de conta (tenant) e de unidade, sempre visível no topo, com a escolha guardada e **revalidada no servidor** a cada requisição (vínculo existe e está ativo). "Todas as unidades" só aparece para quem tem acesso a todas.
- `can()` do `core` aplicado à navegação e às ações, com papel e permissões adicionais. A API repete a checagem; categorias sensíveis filtradas na resposta (RF06.R3).
- Estados para usuário sem vínculo e para conta desativada ou em somente leitura (RF37).

**Testes:** matriz papel × ação no E2E e na API (RF06.CA06); trocar de conta não mostra dado da anterior (inclusive com cache do TanStack Query: chave de query inclui tenant e unidade); manipular o cookie da conta ativa para outro tenant é recusado pela API; mudar o papel vale na próxima requisição (RF05.CA09).

**Pronto quando:** dois usuários em contas diferentes nunca veem dados um do outro.

### F3: Lançamentos — G

**Entrega os requisitos:** RF22 (lista e pesquisa), RF23 (edição), RF24 (lixeira), RF25 (origem e histórico). Critérios: RF22.CA01 a CA05, RF23.CA01 a CA04, RF24.CA01 a CA03, RF25.CA01 a CA04.

**Mudanças pelos requisitos v1.0:** **lixeira visível por 30 dias** com restauração, exclusão em lote e motivo (RF24); **sinais de revisão** (CATEGORIA_A_REVISAR, POSSIVEL_DUPLICIDADE, DATA_ANTIGA) e o filtro "a revisar", com "marcar como revisado" gerando versão (RF22.R4, RF23); filtros completos (período com atalhos, tipo, unidades, categorias, fornecedor, forma de pagamento, canal, lançado por, canal de origem, busca por valor e chave de acesso, RF22).

**Entregas**
- Lista com os filtros do RF22 **na URL**, ordenação, paginação por cursor, totais calculados pelo servidor, estados vazio, carregando e erro; no celular, cartões e filtros em folha lateral.
- Drawer de edição com formulário validado pelo schema do contrato; envia a versão esperada; trata 409 com a mensagem do RF23.Obs2.
- Excluir para a lixeira e restaurar; tela "Lixeira" (30 dias) com filtros; exclusão em lote com confirmação (quantidade e soma).
- **"Ver origem":** texto original (sempre como texto), player de áudio com a transcrição ao lado enquanto existir (90 dias), ou imagem da nota com os itens e a chave de acesso, por URL assinada de até 10 minutos; aviso de "informação restrita" quando a origem gerou lançamento sensível (RF25.Obs1).
- **Histórico de versões:** quem, quando, canal (WhatsApp, painel, importação, e-mail, sistema), ação (criação, alteração, exclusão, restauração) e o que mudou (antes/depois).
- Campos de dinheiro com máscara de entrada em reais, convertidos para centavos sem `float` (RF23.R1); data futura no painel até 60 dias.
- Categorias sensíveis ocultas conforme a permissão (RF06.R3), inclusive em totais, com o aviso "inclui valores restritos".

**Testes:** unitário da conversão de entrada em reais para centavos (vírgula, ponto, milhar); componentes do formulário; E2E de editar, excluir, restaurar e ver origem; conflito de edição entre duas abas; filtros sobrevivem a recarregar e ao botão voltar; permissão (lançador sem acesso a categoria sensível não vê o valor); a edição gera versão (verificada pela API).

**Pronto quando:** um lançamento criado pelo WhatsApp aparece, é editado no painel, e o histórico mostra as duas origens. (Durante o desenvolvimento, o lançamento "pelo WhatsApp" é criado no `pnpm dev:chat`; com o WhatsApp real, só depois da E10 do canal.)

### F4: Dashboard — G

**Entrega os requisitos:** RF27 (dashboard). Critérios: RF27.CA01 a CA05.

**Mudança pelos requisitos v1.0:** os indicadores ficam fixados no RF27: receita bruta, deduções, receita líquida, despesas operacionais, resultado, margem, CMV sobre a receita, folha sobre a receita (só para quem vê folha; a API nem envia o indicador aos demais) e investimentos (fora do resultado). Ticket médio e ponto de equilíbrio dependem de dados ainda não coletados (P09). O tratamento de impostos sobre faturamento é `[PROVISÓRIO – P05]`: isolar em constante.

**Entregas**
- Indicadores do RF27, com variação em relação a "Comparar com" (período anterior ou mesmo período do ano anterior).
- Gráficos: receita × despesa por mês (6 meses), despesas por categoria (grupo do DRE), evolução do resultado e receita por canal e por forma de pagamento (Recharts via componente Chart do shadcn, ⚠️ confirmar versão e React 19).
- Seletor de período (padrão: mês corrente até hoje) e de unidade; percentuais sem receita aparecem como "—".
- **Todos os números vêm de endpoints de agregação**; o front não soma dinheiro.
- Alternativa em tabela para cada gráfico (acessibilidade) e estados vazios úteis ("ainda não há lançamentos neste período").
- Carregamento em streaming por cartão (`<Suspense>` por bloco) ✅, sem `use cache` compartilhado para dados do tenant.

**Testes:** unitário dos mapeadores de dados para o formato dos gráficos; **reconciliação:** cada total do dashboard bate com uma consulta SQL independente; E2E com seed fixo conferindo valores exatos na tela; verificação de acessibilidade; teste de que um papel sem permissão não recebe o indicador de folha na resposta da API (não só some da tela).

**Pronto quando:** os totais da tela são idênticos aos do banco para o seed de referência.

### F5: Exportação Excel/CSV — M

**Entrega os requisitos:** RF29 (exportação em XLSX e CSV). Critérios: RF29.CA01 a CA05.

**Regras do RF29 que a etapa cumpre:** CSV com `;` e UTF-8 com BOM (R1); filtros e permissões da lista (R2); conteúdo LANCAMENTOS ou COMPLETO, este só para o Dono (R3); geração em segundo plano com situação NA_FILA, GERANDO, PRONTO e FALHOU (R4); **link válido por 1 hora, arquivo apagado em 7 dias, só o usuário que pediu baixa** (R5); permissão: Dono sempre, Gerente com EXPORTAR_DADOS (Obs1); toda exportação na trilha de auditoria. O pacote mensal para o contador é v1.1 (RF29.Obs2).

**Entregas**
- Exportação como **job** em fila (pg-boss, ver a skill `novo-worker-pgboss`), arquivo no S3 e link assinado; a tela mostra estado e a lista das exportações dos últimos 7 dias do próprio usuário.
- CSV que o Excel em português abre sem estragar acentos (validar abrindo no Excel ⚠️).
- Excel (`.xlsx`) com biblioteca escolhida em D-F7. Valores numéricos como número, datas como data, nunca texto.

**Testes:** o arquivo gerado tem as colunas, a soma e a contagem esperadas para o seed; a exportação respeita permissão (categoria sensível fora); link expira; arquivo de outro tenant não é acessível; E2E do download.

**Pronto quando:** o contador abre o arquivo no Excel e os totais batem com o painel.

### F6: Configurações — M

**Entrega os requisitos:** RF04 (unidades com apelidos), RF05 (colaboradores e números de WhatsApp), RF07 (categorias e subcategorias), RF08 (formas de pagamento e taxas), RF09 (canais de venda e comissões), RF10 (fornecedores: lista, busca e mesclagem). Critérios: RF04.CA01 a CA05, RF05.CA01 a CA09, RF07.CA01 a CA05, RF08.CA01 a CA05, RF09.CA01 a CA03, RF10.CA01 a CA03.

**Mudanças pelos requisitos v1.0:** o escopo cresce (antes eram só usuários e formas de pagamento): unidades com apelidos, status e CNPJ; **colaboradores com lista de unidades de acesso** (P13), unidade padrão, papéis e permissões adicionais; **subcategorias da empresa** (a estrutura padrão é só leitura, RF07.CA01); canais de venda com comissão; fornecedores. Listas padrão e taxas típicas são `[PROVISÓRIO – P01, P06, P07]`: ficam em seed e constantes únicas.

**Entregas**
- Unidades: criar, editar, inativar (nunca a última ativa), apelidos e fuso (RF04).
- Colaboradores: o dono cadastra o número de WhatsApp, papel, unidades de acesso, unidade padrão, acesso ao painel e permissões; texto pronto e link `wa.me` para o colaborador mandar o "Oi"; desativa e reativa; celular mascarado na lista (RF05). O Gerente só consulta.
- Categorias: árvore com busca, subcategorias da empresa com herança de tipo, grupo, sensível e Exige Quantidade; palavras de apoio (RF07).
- Formas de pagamento e taxas (percentual em pontos-base e valor fixo em centavos), com pré-visualização do líquido calculado pelo `core`; forma de cartão padrão (RF08).
- Canais de venda e comissões; regra do canal APLICATIVO (RF09.R4, P06).
- Fornecedores: lista com total gasto, apelidos, CPF mascarado e mesclagem (RF10).
- Assistente inicial depois do cadastro: colaboradores e taxas (RF01.Obs3).

**Testes:** só o papel certo acessa; telefone normalizado com e sem o 9º dígito (mesma regra do canal); desativar usuário impede o login e o uso do WhatsApp; taxa muda o líquido de novos lançamentos e **não** reescreve os antigos; o Gerente não altera nada (RF04.CA05, RF05.CA08).

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

### F9: Assinatura, plano e encerramento da conta — M (nova)

**Etapa nova (29/10/2026).** **Entrega o requisito:** RF37 (critérios RF37.CA01 a CA04), mais as regras de conta do RF01.R15 e R16.

**Entregas**
- Situação da conta ATIVA, SOMENTE_LEITURA, CANCELADA e ENCERRADA, com as transições do RF37. Em somente leitura, o painel continua consultável e o WhatsApp recebe o aviso de fim do teste (RF37.Obs2); mensagens ficam guardadas, sem virar lançamento (Obs3).
- Plano, ciclo, unidades contratadas e limites por plano, **isolados em configuração única** (`[PROVISÓRIO – P03]`: preços, limites e duração do teste ainda são decisão dos sócios; escolha do provedor de pagamento também).
- Mudança de plano (para cima na hora; para baixo no próximo ciclo, bloqueando se os limites forem excedidos, RF37.CA04), cancelamento com motivo e reversão antes do fim.
- Dados disponíveis por 90 dias depois do cancelamento, exportação COMPLETA a qualquer momento (RF29) e rotina de eliminação com registro (RF37.CA02 e CA03).
- Só o Dono vê a assinatura. Dados de cartão ficam no provedor de pagamentos (RF37.R4).

**Testes:** RF37.CA01 a CA04; quem não é Dono não acessa; a eliminação deixa registro do que foi apagado e quando.

**Pronto quando:** uma conta com teste vencido vira somente leitura e volta a lançar assim que um plano é contratado.

### F10: Painel interno de operação — M (nova)

**Etapa nova (29/10/2026).** **Entrega o requisito:** RF38 (critérios RF38.CA01 a CA03), com RF21.R4 (alerta de custo), RF03.Obs2 (troca do e-mail do dono pelo suporte) e RNF08.R2.

**Entregas**
- Área restrita à equipe do produto, com senha forte e segundo fator obrigatório e lista de e-mails autorizados (RF38.Obs1); toda ação registrada (Obs2).
- Contas (plano, situação, unidades, usuários, último lançamento), sem acesso aos lançamentos. Custo e uso de IA por empresa e por mês, mensagens processadas, custo médio por mensagem e consumo das cotas, com alerta (RF38, RF21.R4).
- Saúde do processamento: fila, falhas definitivas (DLQ) com o código do erro, falhas de envio. A equipe só vê metadados das mensagens, nunca o conteúdo (RF38.R2).
- Ações administrativas registradas: estender teste, ajustar limites, trocar o e-mail do dono após confirmação de identidade, reprocessar mensagens com falha.
- Acesso ao conteúdo financeiro de um cliente só com autorização registrada do Dono, por 24 horas, com cada visualização na trilha (RF38.R3).

**Testes:** RF38.CA01 a CA03; administrador sem autorização não vê lançamentos; o custo total de IA de uma empresa é a soma dos registros individuais (RNF08.CA01).

**Pronto quando:** o Luís vê o custo de IA por restaurante no mês e o motivo de cada mensagem que falhou, sem ler o conteúdo.

### F11: v1.1 do painel — só listada

Depois do piloto, nesta ordem de prioridade a definir: RF26 (lançamento manual, "salvar e lançar outro"), RF28 (DRE gerencial e fechamento mensal em PDF) e RF30 (perguntas em linguagem natural sobre os dados, reaproveitando as consultas do RF20 da E12 do plano do canal). Também v1.1: código de acesso por WhatsApp e segundo fator do dono (RF02), pacote mensal para o contador (RF29.Obs2). Telas de RF31 (notas recebidas), RF33 (recorrentes), RF34 (preferências de resumo e alertas) e RF35 (importações) acompanham as etapas E13 do plano do canal. RF36 (contador multicliente) é Fase 2.

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
                                  │              └──► F6 ─► F7 ─► F8
                                  └─► F9 ─► F10 (depois da F1; podem andar com F3 a F8)
```

- A F0 pode começar já, em paralelo com o plano do canal WhatsApp, porque só depende do scaffold atual.
- A F1 precisa do banco da E2 do plano do canal WhatsApp (usuários e vínculos).
- A F3 só tem dados reais depois da E7 do plano do canal WhatsApp (mensagem virando lançamento). Até lá usa o seed.
- F5 e F6 podem andar em paralelo depois da F3.
- A F2 usa os papéis e permissões da E11 do plano do canal; a F6 usa a lista de unidades de acesso (P13), também da E11.
- A F9 depende da F1 (conta com plano e situação); a F10 depende de `ai_usage` (E6 em diante) e da F1.
- As pendências P01 a P11 não bloqueiam nenhuma etapa (DN-11).

| Marco | Resultado verificável |
|---|---|
| FM1 (fim da F0) | Casca no ar, CI com E2E de fumaça |
| FM2 (fim da F2) | Cadastro do dono, login por senha e por código, troca de conta, isolamento comprovado |
| FM3 (fim da F3) | Lançamento do WhatsApp visível e editável, com histórico |
| FM4 (fim da F4) | Dashboard com totais reconciliados com o banco |
| FM5 (fim da F6) | Exportação e configurações prontas |
| FM6 (fim da F8) | Painel pronto para o piloto, auditado e medido |
| FM7 (fim da F10) | Conta com teste e plano, e painel interno com custo de IA por restaurante |

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
