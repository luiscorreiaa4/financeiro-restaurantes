# Plano de desenvolvimento: canal WhatsApp (mensagem → lançamento)

Atualizado em 28/10/2026. Cobre as fases 1, 2 e 3 do `docs/mvp.md` e a parte de canal/operação da fase 5. O painel web tem plano próprio em `docs/plano-dev-frontend.md`.

Legenda de confiança, usada em todo o documento:

- ✅ conferido na documentação oficial em 27/10/2026
- ⚠️ vem de fonte secundária, do que já observamos na prática, ou não foi confirmado: **verificar antes de depender**
- 🧭 decisão nossa (recomendação), sujeita ao seu OK

## Como retomar este plano (leia primeiro)

**Nome do módulo:** "canal WhatsApp" é o caminho completo da mensagem até o lançamento gravado: recebimento (webhook), fila, identificação, **IA** (um passo do caminho), gravação e confirmação. Não é só "a API" (`apps/api` também serve o painel) nem só "a IA" (`packages/ai` é uma parte pequena do plano). Vive em `apps/api`, `packages/whatsapp`, `packages/ai`, `packages/core` e `packages/db`.

**Para continuar em uma sessão nova:** leia `CLAUDE.md`, depois este arquivo, e execute a **primeira etapa com status "A fazer"** na tabela abaixo. Ao terminar uma etapa, atualize a tabela e o campo "Atualizado em".

| Etapa | Status | Observação |
|---|---|---|
| E1 Núcleo de domínio (`core`) | Feita (27/10/2026) | Arredondamento half-up, papéis owner/manager/staff, sensível = folha. Pendente: confirmar tolerância de 1 centavo e campos "essenciais" (D6); fast-check não adotado |
| E2 Banco e multi-tenancy (`db`) | Feita (27/10/2026) | Schema (14 tabelas), 2 migrations, `withTenant`, papel `app_ingest`, seed; 84 testes de integração (`pnpm test:int`) e 20 unitários passam. Rodar `init.sql` em bancos locais antigos para criar o `app_ingest`. Lista de categorias é provisória por decisão sua; ajustar depois com o Matheus |
| E3 Gateway do WhatsApp (webhook) | Feita (28/10/2026), falta só o teste real pelo túnel | GET/POST `/webhooks/whatsapp`, assinatura sobre bytes brutos, tabela `whatsapp_status_events` (migration 0002), fila `process-inbound` no pg-boss (política `exclusive`, só enfileira; worker é a E4). 95 testes de integração no db e 12 na api passam. Fixtures são sintéticas: trocar/acrescentar as reais anonimizadas. Pendente: mensagem do celular pelo túnel (precisa de `DATABASE_INGEST_URL` no `.env`) e conferir `redact`/logs do Pino |
| E4 Fila e workers | A fazer | Conferir opções do pg-boss em pgboss.io/api antes |
| E5 Identificação e roteamento | A fazer | |
| E6 Extração por IA (texto) | A fazer | Precisa do crédito da Anthropic para o teste ao vivo |
| E7 Fluxo de lançamento e confirmação | A fazer | |
| E8 Evals e qualidade da IA | A fazer | Começa junto com a E6 |
| E9 Áudio e foto | A fazer | |
| E10 Envio real e operação | A fazer | Bloqueada pela Meta (erro 130497) |

**Fechamento de etapa (sempre, antes de marcar "Feita"):**
1. Rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que a etapa cumpre o "Pronto quando".
2. Atualizar a tabela de progresso e o campo "Atualizado em".
3. **Revisar o contexto do Claude.** Responder: o que repetiu ou deu errado nesta etapa e vale virar regra (`.claude/rules`), skill, hook, `CLAUDE.md` do módulo ou subagente? Usar o critério: erro repetido duas vezes vira regra ou `CLAUDE.md`; procedimento colado pela terceira vez vira skill; o que precisa acontecer sempre vira hook. **Propor e esperar aprovação; não criar sozinho.** Ver os candidatos previstos por etapa em `docs/pesquisa-ecossistema-claude-code.md`, seção 12 (arquivo local, fora do git).
4. Sugerir a mensagem de commit em Conventional Commits. Não commitar sem pedido.

**Decisões já tomadas (27/10/2026):** D1 (structured outputs na extração), D2 (Drizzle 0.45.x estável, sem API relacional). As demais (D3 a D6) seguem como recomendação até você confirmar.

**Estado do repositório:** fase 0 pronta (monorepo, Biome, Vitest, validação de env, Postgres no Compose). Faltava só rodar o CI no GitHub.

## 1. Objetivo e escopo

Uma mensagem de WhatsApp (texto, depois áudio e foto) vira um ou mais lançamentos gravados, auditáveis e confirmados ao usuário, com custo de IA medido e sem nunca deixar a IA fazer conta.

**Dentro:** webhook, fila, identificação de usuário, extração por IA, gravação com versão e origem, confirmação, comandos (`desfazer`, `ajuda`), correção por reply, áudio, foto, evals, custo por tenant.

**Fora (pós-MVP):** perguntas em linguagem natural sobre os dados, resumo semanal e alertas, importação de planilhas, Open Finance.

**Premissa atual:** o envio real de mensagens está bloqueado (erro 130497 no número de teste, ver `docs/subplano-sem-cnpj.md`). Tudo é construído com o envio atrás de uma interface e liga quando a Meta liberar.

## 2. Tecnologias: o que a documentação atual diz

Versões instaladas hoje no repositório: Node 24, TypeScript 7.0.2, Fastify 5.12.7, Zod 4.6.7, Vitest 5.0.5, Drizzle ORM 0.45.x, drizzle-kit 0.31.x, pg 8.23.

| Tecnologia | O que a doc diz | Consequência para nós |
|---|---|---|
| **WhatsApp Cloud API: webhook** ✅ | GET de verificação com `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`; responder `200` com o challenge, senão o endpoint fica sem verificação. POST traz `X-Hub-Signature-256: sha256=<hash>`, HMAC-SHA256 com o App Secret. Payload de até **3 MB**. Falha gera retry imediato e depois por até **7 dias**, com frequência decrescente. Duplicatas acontecem e a deduplicação é nossa. Um POST pode ter **vários eventos** (até 1000) e lote não é garantido. Não há API de histórico de webhooks. | Idempotência por `wa_message_id`. Iterar sobre arrays de `messages` e `statuses`. Gravar o payload bruto sempre. Aumentar o `bodyLimit` da rota (padrão do Fastify é 1 MiB). |
| Assinatura: bytes brutos ⚠️ | A doc diz "JSON payload" e não especifica bytes brutos ou JSON reparseado. | 🧭 Validar sobre os **bytes recebidos** (mais seguro). Exige guardar o corpo bruto antes do parse. |
| Tempo de resposta do webhook ⚠️ | A doc não informa timeout. | A regra de 1 s do CLAUDE.md é nossa. Medir e manter. |
| Identificadores do usuário ⚠️ | Observado nos nossos payloads reais: `wa_id` sem o 9º dígito (`551187654321`), `user_id` no formato `BR.<número>` e `country_code`. O envio aceitou o número com 9 (`5511987654321`) e recusou o sem 9. Não li a doc sobre `user_id`. | Guardar `phone_e164` canônico, `wa_id` e, se vier, `wa_user_id`. Normalização do 9º dígito com testes. |
| **Fastify 5** ✅ | Versão atual 5.12.x. `bodyLimit` padrão 1 MiB. `addContentTypeParser` para parsers customizados. `fastify.close()` com `preClose`/`onClose`. Opção `logger` aceita opções do Pino. Type providers em página à parte. | Corpo bruto via parser customizado na rota do webhook. Graceful shutdown com `close()`. `redact` do Pino não consta nessa página ⚠️: conferir na doc do Pino. |
| **fastify-type-provider-zod** ✅ | Zod 4.2+ corresponde à v7 ou superior. `setValidatorCompiler`, `setSerializerCompiler`, `ZodTypeProvider`. Integra com `@fastify/swagger` (`jsonSchemaTransform`). A página não confirma Fastify 5. | Usar v7+. ⚠️ Confirmar compatibilidade com Fastify 5 ao instalar. |
| **Zod 4** ✅ | Instalado 4.6.7. | `import { z } from "zod"`. Um schema define o lançamento para o LLM, a API e o painel. |
| **pg-boss 12** ✅ | Última 12.38.0. Node ≥ 22.12 e PostgreSQL ≥ 13. API: `start()`, `createQueue()`, `send()`, `work()` (o handler recebe um **array** de jobs). Retries com backoff exponencial, DLQ, cron/RRULE, políticas de fila. | Handler sempre trata lote. ⚠️ As opções exatas (`singletonKey`, `retryLimit`, `deadLetter`) estão em `/api/*` do pgboss.io e **não foram lidas**: conferir antes de codar a E4. |
| **Drizzle ORM** ✅ | Estável: 0.45.4. Existe `v1.0.0-rc.5` (pré-lançamento). RLS: `pgTable.withRLS`, `pgPolicy`, `pgRole(...).existing()`. O exemplo oficial usa `set_config(..., TRUE)` dentro de transação (padrão Supabase). `v1.0.0-rc.1` removeu o RQB v1 (`db._query`) no Postgres. | 🧭 Ficar na **0.45.x estável** e não adotar RC. Evitar a API relacional (`db._query`): usar o query builder (`select/insert`), que não muda no v1. Nosso `withTenant` segue o padrão do exemplo, parametrizado. |
| **Claude API** ✅ (skill `claude-api`, cache de 06/10/2026) | `claude-haiku-5-5`: US$ 0,10 / 0,50 por MTok (prompts até 100K), thinking adaptativo **ligado por padrão**, effort padrão `medium`, parâmetros de amostragem diferentes do padrão retornam 400, sem prefill. `claude-sonnet-5-5`: US$ 2 / 10 por MTok. `tool_choice` forçado (`any`/`tool`) retorna 400 em Fable 5.1, Opus 5.5 e Sonnet 5.5. Structured outputs via `output_config.format`. `strict: true` em tools. Prompt caching é prefixo exato. Haiku 5.5 **não tem** fallback de recusa no servidor. | Ver D1 abaixo. Não enviar `temperature`. Definir `effort` explicitamente. Tratar `stop_reason: "refusal"`. Cache: parte estável primeiro. |
| **Transcrição OpenAI** ⚠️ | Fontes secundárias: `gpt-4o-transcribe` e `gpt-4o-mini-transcribe`; limite de **25 MB** por requisição; formatos flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm; resposta só `json` nesses modelos. Nenhuma página oficial foi confirmada. | Áudio do WhatsApp é OGG/Opus: **testar com áudios reais**. Plano B: converter com ffmpeg para mp3/m4a. Conferir a doc oficial antes da E9. |
| **Testcontainers (Node)** ✅ | `@testcontainers/postgresql`, `new PostgreSqlContainer(image).start()`, `getConnectionUri()`, `snapshot()` e `restoreSnapshot()` (não usar o banco chamado `postgres` com snapshots). | Um container por suíte, snapshot por teste para isolamento rápido. Reuso e setup global do Vitest não constam na página ⚠️. |
| **Vitest 5** | Instalado 5.0.5. | Projetos por pacote. Testes de integração em arquivos `*.int.test.ts` separados. |

## 3. Arquitetura

### 3.1 Visão em camadas (hexagonal)

```
                    ┌──────────────────────── apps/api ────────────────────────┐
  Meta (webhook) ──►│ http/            rotas finas: valida, grava, enfileira    │
                    │ jobs/            workers pg-boss: chamam casos de uso     │
                    │ modules/         casos de uso (camada de aplicação)       │
                    │ composition.ts   monta portas + adaptadores               │
                    └───────┬───────────────────────────────┬──────────────────┘
                            │ usa portas                    │ usa
              ┌─────────────▼────────────┐      ┌───────────▼───────────┐
              │ packages/core (puro)     │      │ adaptadores (infra)   │
              │ Money, Entry, regras,    │      │ db (Drizzle/pg)       │
              │ permissões, comandos,    │      │ whatsapp (Cloud API)  │
              │ telefone, Result/erros   │      │ ai (Claude, OpenAI)   │
              └──────────────────────────┘      │ storage (S3)          │
                                                └───────────────────────┘
```

**Regras de dependência (verificadas em CI com o próprio Biome/tsc, ver 5.4):**

1. `packages/core` não importa nada de infra, nem Zod de transporte HTTP. Só TypeScript puro e Zod para schemas de domínio.
2. Casos de uso dependem de **portas** (interfaces) definidas em `core`, nunca de adaptadores concretos.
3. Adaptadores dependem de `core`. Nunca o contrário, e nunca um adaptador de outro.
4. `apps/api` é a única raiz de composição: é onde porta e adaptador se encontram.
5. Rotas HTTP e jobs não têm regra de negócio: só traduzem entrada em chamada de caso de uso.

### 3.2 Portas (interfaces em `core`)

| Porta | Adaptador real | Adaptador de desenvolvimento/teste |
|---|---|---|
| `MessageSender` (enviar texto, marcar como lido, indicador de digitação) | `CloudMessageSender` | `LogMessageSender` (só registra), `FakeMessageSender` (testes) |
| `EntryExtractor` (texto/imagem → `ExtractionResult`) | `ClaudeEntryExtractor` | `FakeEntryExtractor` (respostas roteirizadas) |
| `Transcriber` (áudio → texto) | `OpenAITranscriber` | `FakeTranscriber` |
| `MediaStore` (guardar/ler mídia, URL assinada) | `S3MediaStore` | `InMemoryMediaStore` |
| `Clock` | `SystemClock` | `FixedClock` (data de hoje determinística) |
| `JobQueue` (enfileirar) | `PgBossQueue` | `InMemoryQueue` |
| Repositórios (`InboundMessageRepo`, `EntryRepo`, …) | Drizzle, sempre dentro de `withTenant` | Mesmo adaptador contra Postgres de teste (sem mock de banco) |

### 3.3 Estrutura de pastas proposta

```
packages/core/src/
  money/            Money (centavos), formatBRL, taxa e líquido, parse seguro
  entry/            Entry, EntryDraft, versão, regras de validação
  permissions/      papéis, can(), categorias sensíveis
  conversation/     comandos (desfazer, ajuda), detecção de reply, estados
  phone/            normalização E.164 e variante com/sem 9º dígito
  errors/           Result e erros nomeados do domínio
  ports/            interfaces das portas
packages/whatsapp/src/
  schemas/          Zod do payload (messages, statuses), tipos de mensagem
  signature.ts      validação de X-Hub-Signature-256
  verify.ts         handshake do GET
  cloud-sender.ts   envio, leitura, digitação, download de mídia
packages/ai/src/
  extraction/       schema ExtractionResult, prompt, builder de contexto
  claude/           ClaudeEntryExtractor, roteamento Haiku→Sonnet, custo
  transcription/    OpenAITranscriber
  pricing.ts        tabela de preços versionada
  evals/            dataset (JSONL), runner, métricas, baseline
packages/db/
  schema/           tabelas Drizzle + políticas RLS
  migrations/       SQL revisado
  src/with-tenant.ts
apps/api/src/
  http/webhooks/    rota do WhatsApp
  jobs/             process-inbound, e outros
  modules/inbound/  casos de uso: IngestWebhook, ProcessInbound
  modules/entries/  RegisterEntries, UndoEntry, CorrectEntry
  composition.ts
  server.ts / worker.ts   dois entrypoints, mesma imagem
```

### 3.4 Estados da mensagem recebida

```
received ──► processing ──► processed
   │             │ └──────► needs_answer ──(resposta do usuário)──► processing
   │             └────────► failed (após N tentativas → DLQ)
   └─ duplicata: ignorada (ON CONFLICT DO NOTHING em wa_message_id)
```

Reprocessar uma mensagem nunca duplica lançamentos: `entries` tem unicidade por `(inbound_message_id, posição)` e a transição de estado é feita com guarda no próprio `UPDATE`.

### 3.5 Contratos de erro

`Result<T, E>` no domínio, com erros nomeados (`AmountMissing`, `UnknownUnit`, `PermissionDenied`, `DuplicateMessage`, `ExtractionInvalid`, `LlmRefused`, …). Exceções só para falhas de infraestrutura. Cada erro de domínio mapeia para uma mensagem em pt-BR escrita pelo Matheus.

## 4. Decisões que precisam do seu OK

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 ✅ **Decidido** | O CLAUDE.md falava em "tool use com saída estruturada". Usar tool use forçado ou structured outputs (`output_config.format`)? | **Structured outputs** para a extração. Tool use fica para a v1.1 (perguntas sobre os dados). | `tool_choice` forçado retorna 400 nos modelos mais novos, e prefill não existe mais. Structured outputs entrega o mesmo resultado (JSON validado pelo schema) sem depender disso. Confirmar na doc se o Haiku 5.5 aceita forçar tool ⚠️, mas o desenho não deveria depender disso. |
| D2 ✅ **Decidido** | Drizzle estável (0.45) ou RC do v1? | 0.45.x, sem API relacional. Reavaliar quando o 1.0 sair estável. | RC ainda muda (rc.5 em 21/10). |
| D3 | Onde mora o corpo bruto do webhook? | 🧭 Gravar o payload bruto inteiro em `inbound_messages` (coluna `raw jsonb`) e validar a assinatura sobre os bytes. | Não há API de histórico na Meta e a doc manda tratar duplicatas. |
| D4 | Build de produção da API e dos workers | 🧭 Decidir na E10: bundle (tsup/esbuild) ou rodar TypeScript direto no Node 24. | Hoje usamos `tsx` só em desenvolvimento. ⚠️ Não verifiquei o suporte do Node a TS em pacotes do workspace. |
| D5 | Modelo para o primeiro passe: Haiku 5.5 ou Sonnet 5.5? | 🧭 Começar com Haiku 5.5 e **medir nos evals** antes de decidir. | CLAUDE.md já define Haiku para extração. Custo é ~20x menor, mas só o eval diz se a precisão chega a 90%. |
| D6 | Pergunta de volta vs. salvar com presunção | Regra do CLAUDE.md (salvar direto, perguntar só se faltar informação essencial). Definir com o Matheus **o que é essencial**. | É uma regra de negócio, não técnica. |

## 5. Estratégia de testes

### 5.1 Pirâmide

| Nível | O que cobre | Ferramenta | Roda quando |
|---|---|---|---|
| Unitário | `core` inteiro (dinheiro, regras, comandos, telefone, permissões), assinatura, schemas | Vitest, **sem mocks** | Todo commit |
| Contrato | Payloads reais da Meta (fixtures) contra os schemas Zod; saída do LLM contra `ExtractionResult` | Vitest | Todo commit |
| Integração | Postgres real (Testcontainers): RLS, repositórios, pg-boss, idempotência, transações | Vitest + `@testcontainers/postgresql` | Todo PR |
| Ponta a ponta do canal | Fixture de webhook → rota → fila → worker → banco → `FakeMessageSender` | Vitest + Fastify `inject` + Postgres de teste | Todo PR |
| Evals do LLM | Dataset versionado contra o modelo real | Runner próprio, Batch API ⚠️ | Quando `packages/ai` muda e antes de release |
| Carga e latência | Webhook responde < 1 s sob rajada; fila drena | Script de carga | Antes do piloto |

### 5.2 Convenções

- **Fixtures reais:** os dois payloads que já capturamos (texto recebido e `status: failed` com erro 130497) viram fixtures anonimizadas em `packages/whatsapp/test/fixtures/`. Cada novo formato (áudio, imagem, reply, botão, status `delivered`) entra como fixture antes do código.
- **Sem mock de banco.** O banco de teste é um Postgres de verdade com o papel `app` (sem `BYPASSRLS`), como em produção.
- **Relógio e IA injetados.** Nenhum teste depende de `Date.now()` nem de rede.
- **Teste de isolamento por tabela é meta-teste:** um teste percorre `information_schema` e falha se existir tabela com `tenant_id` sem RLS ligado e sem política. Assim, tabela nova sem política quebra o CI.
- **Nomes de teste em português**, descrevendo o comportamento de negócio.
- **Cobertura:** `core` sem metas numéricas frouxas: toda regra tem teste (regra do CLAUDE.md). Os demais, cobertura medida como alerta, não como meta.

### 5.3 Jobs de CI propostos

1. `check`: lint, typecheck, testes unitários e de contrato (já existe, rápido).
2. `integration`: sobe Postgres via Testcontainers (o runner `ubuntu-latest` tem Docker) e roda `*.int.test.ts`.
3. `evals`: só quando `packages/ai/**` muda; falha se a taxa de acerto cair abaixo do baseline menos a tolerância.
4. `migrations`: gera migration a partir do schema e falha se houver diferença não commitada.

### 5.4 Regras de arquitetura verificadas automaticamente

Teste simples que lê os `package.json` e falha se `@app/core` listar dependência de infra (`pg`, `fastify`, `drizzle-orm`, SDKs). Biome pode restringir imports por pasta. ⚠️ Conferir a regra exata do Biome 2 ao implementar.

## 6. Etapas

Cada etapa termina com algo testável. Os tamanhos são relativos (P, M, G), não prazos.

### E1: Núcleo de domínio (`packages/core`) — P/M

**Objetivo:** todas as regras que não dependem de rede nem de banco, testadas sem mocks.

**Entregas**
- `Money` em centavos (bigint ou number seguro), com `formatBRL`, soma, subtração e multiplicação por pontos-base. Nunca `float`.
- Cálculo de taxa e líquido (`fee_percent_bp`, `fee_fixed_cents`, `net_cents`), com arredondamento definido e documentado.
- `Entry` e `EntryDraft`: criação, edição com versão (`entry_versions`: quem, quando, antes/depois, canal) e soft delete.
- Permissões por papel e categorias sensíveis (folha).
- Normalização de telefone brasileiro: gera forma canônica e as variantes com e sem o 9º dígito.
- Parser dos comandos `desfazer` e `ajuda`, tolerante a caixa, acento e espaço.
- `Result` e erros nomeados.
- Schemas Zod do domínio: `ExtractedEntry`, `ExtractionResult`.

**Testes:** unitários exaustivos, incluindo casos de borda de dinheiro (arredondamento de taxa, valores enormes, zero, negativos rejeitados) e tabela de entradas para o telefone. 🧭 Teste baseado em propriedades (por exemplo `fast-check`) para `Money` ⚠️ (não verifiquei a biblioteca).

**Pronto quando:** `pnpm test` cobre cada regra e `core` não tem dependência de infra.

### E2: Banco e multi-tenancy (`packages/db`) — M/G

**Objetivo:** modelo de dados do `docs/arquitetura.md` com isolamento garantido no banco.

**Entregas**
- Schema Drizzle de todas as tabelas (tenants, units, users, memberships, categories, suppliers, payment_methods, sales_channels, inbound_messages, entries, entry_versions, pending_questions, ai_usage, audit_log). IDs UUID v7. `bigint` para centavos.
- `inbound_messages`: `wa_message_id` único, `raw jsonb`, `status`, `wa_user_id`.
- Migrations SQL revisadas, com políticas RLS (`pgPolicy`) e `ENABLE`/`FORCE ROW LEVEL SECURITY` quando aplicável.
- `withTenant(tenantId, fn)`: transação com `set_config('app.tenant_id', $1, true)` (parametrizado, nunca interpolado).
- Papéis separados: `app` (sem BYPASSRLS) para a aplicação, `postgres` (admin) para migrations e jobs administrativos.
- Seed com categorias provisórias. ✅ **Decidido (27/10/2026):** a lista em `packages/db/src/system-categories.ts` é **provisória** e precisará ser ajustada depois, com validação do Matheus (nomes, subcategorias, natureza fixa/variável e grupo do DRE). Como o seed é idempotente e só cria o que falta, mudanças em categorias já gravadas exigem migration ou script de ajuste, não basta editar a lista.
- Tabelas do pg-boss em esquema próprio, acessadas só pelo papel administrativo.

**Testes (Testcontainers)**
- Isolamento: tenant A não lê, não altera e não insere para tenant B, em **cada** tabela.
- Meta-teste: toda tabela com `tenant_id` tem RLS ligado e política.
- Query sem `withTenant` retorna zero linhas ou falha, nunca dados de outro tenant.
- Papel `app` não tem `BYPASSRLS`.
- Unicidade de `wa_message_id` e de `(inbound_message_id, posição)`.
- Migration aplicada em banco vazio e reaplicada sem erro.

**Pronto quando:** o meta-teste passa e nenhuma query do app roda fora de `withTenant`.

### E3: Gateway do WhatsApp (webhook) — M

**Objetivo:** receber, validar, gravar e responder 200 em menos de 1 s.

**Entregas**
- Rota `GET /webhooks/whatsapp`: handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`) com comparação em tempo constante do token.
- Rota `POST /webhooks/whatsapp`: parser que preserva o corpo bruto; `bodyLimit` acima de 3 MB; validação de `X-Hub-Signature-256` sobre os bytes, comparação em tempo constante; resposta 401 sem processar se inválida.
- Schemas Zod de `messages` e `statuses`; **itera sobre todos os eventos** do payload.
- Gravação idempotente (`ON CONFLICT DO NOTHING` em `wa_message_id`), payload bruto guardado.
- Enfileiramento de `process-inbound` (uma tarefa por mensagem nova) e resposta 200.
- Eventos de `status` gravados (entregue, lido, falhou), com o código de erro. É assim que veremos erros como o 130497.
- Túnel público (cloudflared ou ngrok) para o desenvolvimento, configurando URL e `WHATSAPP_VERIFY_TOKEN` no app da Meta.

**Testes**
- Unitário: assinatura válida, inválida, ausente, corpo adulterado em 1 byte.
- Contrato: fixtures reais passam nos schemas; campos desconhecidos novos não derrubam o parse (usar `passthrough` ou tolerância controlada).
- Integração: duplicata (mesmo POST duas vezes) gera uma linha e um job; payload com vários eventos; lote misto de mensagens e status.
- Latência: 200 em < 1 s com a fila e o banco reais (teste de tempo com folga e script de carga à parte).
- Real: mensagem do celular chega pelo túnel e vira linha em `inbound_messages`.

**Pronto quando:** a mensagem "Teste" enviada do seu celular aparece no banco, e o mesmo POST reenviado não duplica.

### E4: Fila e workers (pg-boss) — M

**Objetivo:** processamento assíncrono, idempotente e resiliente.

**Entregas**
- Entrypoint `worker.ts` separado do `server.ts`, mesma imagem.
- Filas criadas na inicialização com política explícita: tentativas, backoff exponencial, expiração e **fila de mensagens mortas (DLQ)**. ⚠️ Opções exatas a confirmar em `pgboss.io/api/queues`.
- Handler `process-inbound` que recebe lote, é idempotente e usa o estado da E3 (3.4).
- Chave de unicidade do job por `wa_message_id` para impedir enfileiramento duplo. ⚠️ Confirmar o nome da opção na doc.
- Encerramento limpo com sinais: terminar jobs em andamento antes de sair.
- Log estruturado por job (sem conteúdo de mensagem).

**Testes (integração):** retry após erro transitório; esgotar tentativas leva à DLQ; reprocessar não duplica lançamento; dois workers não pegam a mesma mensagem; shutdown no meio de um job.

**Pronto quando:** derrubar o worker no meio do processamento e subir de novo termina a mensagem sem duplicar nem perder.

### E5: Identificação e roteamento da conversa — M

**Objetivo:** saber quem escreveu e o que a mensagem é, antes de gastar IA.

**Entregas**
- Resolução telefone → usuário → tenant, papéis e unidade padrão, com a normalização da E1.
- Número desconhecido: resposta educada e padronizada, dentro da janela de 24 h, sem expor dados.
- Registro do **opt-in** do usuário (exigência da política da Meta).
- Roteamento em ordem: comando (`desfazer`, `ajuda`) → resposta a uma confirmação (correção por reply, via `context.message_id`) → resposta a pergunta pendente → extração.
- Saída para humano nas mensagens de ajuda e erro (canal de suporte).
- Recusa curta e padronizada para assunto fora do escopo (a política da Meta trata IA de propósito geral como proibida).
- `MessageSender` com `LogMessageSender` ligado em desenvolvimento.

**Testes:** tabela de telefones com e sem 9º dígito; usuário de dois tenants; usuário desativado; comandos com variações; reply para a confirmação certa e para uma antiga; mensagem fora de escopo.

**Pronto quando:** cada tipo de mensagem cai no ramo certo sem chamar a IA nos casos de comando e número desconhecido.

### E6: Extração por IA (texto) — G

**Objetivo:** texto livre → `ExtractionResult` validado, barato e medido.

**Entregas**
- **Schema `ExtractionResult`** (em `core`): intenção (`register` | `out_of_scope` | `unclear`), lista de lançamentos, e, quando faltar algo essencial, a pergunta e os campos faltantes. A IA **extrai**, não calcula: o schema aceita `quantity`, `unit_price_cents` e `total_cents`, e o sistema valida a consistência e recalcula.
- **Prompt de função específica** (extração de lançamento financeiro, nunca assistente geral). Sem instrução do tipo "responda qualquer pergunta".
- **Montagem do contexto por tenant:** categorias, fornecedores frequentes, unidades, formas de pagamento. Esse bloco é estável por tenant.
- **Cache de prompt:** regras do sistema e contexto do tenant **antes** do ponto de cache; a mensagem e a data de hoje **depois** (a data muda todo dia e invalidaria o prefixo). Verificar por `usage.cache_read_input_tokens`. O tamanho mínimo cacheável depende do modelo ⚠️.
- `ClaudeEntryExtractor`: structured outputs (D1), `effort` explícito e baixo para extração, `max_tokens` folgado, **sem `temperature`**, tratamento de `stop_reason` (`refusal`, `max_tokens`) e de JSON inválido (uma nova tentativa com o erro; se persistir, pergunta ao usuário).
- **Roteamento Haiku → Sonnet** por sinais determinísticos (saída inválida, intenção `unclear`, mensagem longa, foto difícil), não pela "confiança" que o próprio modelo declara.
- **Presunções** aplicadas pelo sistema, não pela IA: data de hoje, unidade padrão, categoria e forma de pagamento sugeridas pelo histórico.
- `pending_questions` com expiração.
- **`ai_usage`** por chamada: tokens de entrada, saída, leitura e escrita de cache, modelo, custo estimado calculado com `pricing.ts` versionado (preços em arquivo, não no código espalhado).

**Testes**
- Unitário/contrato: `ExtractionResult` aceita e rejeita os casos certos; cálculo de custo com valores conhecidos.
- Com `FakeEntryExtractor`: o orquestrador trata saída inválida, recusa, `max_tokens` e fallback para o Sonnet.
- Ao vivo (gated, ver E8): dataset real contra o modelo.
- Teste do builder de prompt: o prefixo cacheável é idêntico entre duas mensagens do mesmo tenant (nada volátil antes do ponto de cache).

**Pronto quando:** o script de linha de comando recebe 10 a 15 frases e imprime os lançamentos extraídos, com custo por mensagem.

### E7: Fluxo de lançamento e confirmação — M

**Objetivo:** do `ExtractionResult` ao lançamento gravado e confirmado.

**Entregas**
- Caso de uso `RegisterEntries`: valida, calcula taxa e líquido no `core`, grava `entries`, `entry_versions` e `ai_usage` **na mesma transação**, guarda `inbound_message_id` como origem.
- Mensagem de confirmação no formato padrão (textos do Matheus), com o que foi registrado e como corrigir. Guarda o `wa_message_id` da resposta para permitir correção por reply.
- Pergunta de volta (`pending_questions`) e retomada quando o usuário responde.
- `UndoEntry` (`desfazer`) e `CorrectEntry` (reply), ambos gerando versão.
- Vários lançamentos por mensagem, com confirmação agrupada.

**Testes:** ponta a ponta do canal (fixture de webhook → banco → saída do `FakeMessageSender`); desfazer duas vezes; corrigir um lançamento antigo; erro no meio da transação não deixa lançamento pela metade; permissão negada.

**Pronto quando:** a mensagem do seu celular vira lançamento com versão e origem, e a confirmação aparece no log.

### E8: Evals e qualidade da IA — M (contínuo)

**Objetivo:** saber, com número, se a IA está melhorando ou piorando.

**Entregas**
- Dataset em JSONL versionado: mensagem de entrada, contexto do tenant, resultado esperado, categoria do caso (fácil, ambíguo, fora de escopo, erro de digitação, vários lançamentos).
- Começa com 30+ casos próprios inventados e troca pelos reais coletados pelo Matheus. Mensagens reais são anonimizadas antes de entrar no repositório.
- Runner que mede **por campo** (tipo, valor, data, categoria, pagamento, fornecedor), **por lançamento** (acerto exato), precisão e revocação da pergunta de volta (perguntou quando devia, não perguntou quando não devia), taxa de recusa correta de fora de escopo, custo por mensagem e latência p50/p95.
- Baseline salvo; o CI falha se o acerto cair além da tolerância definida.
- Execução em lote para barateá-la ⚠️ (a Batch API roda de forma assíncrona com custo menor; confirmar disponibilidade e preço atuais).
- Processo para mudar prompt: rodar eval antes e depois, registrar no PR.

**Antes de construir o runner:** definir com você o método de correção e o custo aceitável por rodada, e pedir sua aprovação (cada rodada contra o modelo real custa dinheiro).

**Pronto quando:** existe uma taxa de acerto de referência e o CI a protege. Meta do piloto (TODOLIST): acima de 90%.

### E9: Áudio e foto (fase 3) — G

**Entregas**
- Download de mídia da Meta (obter a URL e baixar com o token; a URL é temporária) e envio ao S3 com chave por tenant. Páginas: `.../business-phone-numbers/media.md`.
- `Transcriber` com `OpenAITranscriber`; limite de ~3 min; teste com **áudios reais de cozinha** (ruído, gíria). Conversão com ffmpeg se o OGG/Opus não for aceito ⚠️.
- Reaproveitamento do fluxo de texto: a transcrição entra como texto em `inbound_messages` e segue a E6.
- Foto: leitura do QR da NFC-e e consulta à SEFAZ (estados dos pilotos primeiro); fallback para extração multimodal.
- Limite de taxa por usuário e por IP.
- Indicador de digitação e confirmação de leitura enquanto processa (páginas "Typing indicators" e "Read receipts" da doc da Meta).
- Retenção de áudio de 90 dias (regra de ciclo de vida no bucket).

**Testes:** áudios de exemplo com transcrição esperada (tolerância a erro de palavra); QR com fixtures gravadas da SEFAZ (contrato, sem bater no site em CI); imagem sem QR no dataset de evals; rate limit excedido responde de forma padronizada.

**Pronto quando:** um áudio de 20 s e uma foto de NFC-e viram lançamentos confirmados.

### E10: Envio real, operação e produção do canal — M

Depende do desbloqueio da Meta (forma de pagamento, verificação da empresa, número definitivo).

**Entregas**
- `CloudMessageSender`: texto dentro da janela de 24 h; templates aprovados para o que inicia conversa (resumo, alertas, OTP por WhatsApp).
- Rastreio da janela de 24 h por usuário, para saber quando só template é permitido.
- Tratamento de `statuses` (falha, entregue, lido) e de códigos de erro conhecidos (130497, 131030, janela expirada).
- Observabilidade: Pino com `redact` (nunca texto de mensagem, CPF, salário), Sentry, métricas de latência do webhook, profundidade da fila, latência e custo do LLM.
- Painel interno de custo por tenant (`ai_usage`).
- Decisão D4 (build de produção), backup com teste de restauração, staging e produção com números separados.
- Ferramenta interna do "mágico de Oz" (ver mensagens e responder à mão), se for adiantar o piloto.

**Testes:** contrato do `CloudMessageSender` contra respostas gravadas da Graph API; teste de falha de envio (a mensagem fica registrada, o job não perde o lançamento); teste de que nenhum log contém conteúdo de mensagem.

**Pronto quando:** do seu celular ao lançamento confirmado de volta no WhatsApp, em staging, com o número da empresa.

## 7. Qualidade transversal

- **Segurança:** assinatura sempre validada; comparação de segredos em tempo constante; rate limit por telefone e por IP; segredos só em variáveis de ambiente validadas; `pnpm audit` e atualização automática de dependências.
- **LGPD:** retenção definida (áudio 90 dias, 90 dias de acesso após cancelamento); folha de pagamento marcada como sensível e filtrada por permissão; DPA com o restaurante como controlador. O texto jurídico vem do advogado.
- **Política da Meta:** bot de função específica; sem treino de modelo com dados da plataforma; saída para humano; opt-in registrado; templates para iniciar conversa. Ver `docs/politica-meta-whatsapp.md`.
- **Custo:** `ai_usage` desde a E6; planilha de custo atualizada com o custo real medido; alerta quando o custo por mensagem passar de um limite.
- **Observabilidade mínima desde a E3:** log estruturado com `wa_message_id`, tenant e duração, nunca o conteúdo.

## 8. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Envio bloqueado pela Meta (130497) | Sem confirmação real no WhatsApp | Interface de envio e modo log; resolver pagamento e verificação; ticket no suporte |
| IA não chega a 90% de acerto | Piloto frustra | Evals desde cedo; roteamento para Sonnet; perguntas de volta; ajuste de prompt medido |
| Áudio OGG/Opus não aceito ou transcrição ruim | Fluxo de áudio travado | Teste com áudios reais na E9; conversão com ffmpeg; modelo alternativo |
| Mudança nos formatos da Meta (`user_id`, nomes de usuário) | Identificação quebra | Guardar `wa_id` e `wa_user_id`; fixtures novas a cada formato; tolerância a campos novos |
| Dado de um tenant vazar | Incidente grave | RLS, papel sem BYPASSRLS, meta-teste, teste de isolamento por tabela |
| Custo de IA acima do previsto | Margem do plano | Cache de prompt, Haiku por padrão, `ai_usage` com alerta |
| Drizzle v1 muda a API | Retrabalho | Ficar na 0.45, sem API relacional |

## 9. Ordem e marcos

```
E1 ─► E2 ─► E3 ─► E4 ─► E5 ─► E6 ─► E7 ─► E8 (contínuo)
                                  └──────────► E9 ─► E10
```

- E1 e E2 não dependem de nada externo.
- E3 e E4 dependem só do túnel e do app da Meta, que já existem.
- E6 precisa do crédito da Anthropic. A parte de contrato e do orquestrador com `FakeEntryExtractor` pode ser feita antes.
- E8 começa junto com a E6 (o dataset inicial é pré-requisito para medir qualquer prompt).
- E10 só fecha com a Meta liberada.

| Marco | Resultado verificável |
|---|---|
| M1 (fim da E2) | Isolamento entre tenants provado em teste, em todas as tabelas |
| M2 (fim da E4) | Mensagem do celular chega, é gravada uma única vez e processada por worker |
| M3 (fim da E7) | Mensagem de texto vira lançamento com versão e origem, confirmação no log |
| M4 (fim da E8) | Taxa de acerto de referência medida e protegida no CI |
| M5 (fim da E9) | Áudio e foto viram lançamentos |
| M6 (fim da E10) | Fluxo completo com confirmação no WhatsApp, em staging |

## 10. Fontes consultadas (27/10/2026)

- Meta, criar endpoint de webhook: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint.md
- Meta, guia de webhooks da Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
- Meta, índice da documentação: https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt
- Fastify, referência do servidor: https://fastify.dev/docs/latest/Reference/Server/
- fastify-type-provider-zod: https://github.com/turkerdev/fastify-type-provider-zod
- pg-boss: https://pgboss.io/ e https://github.com/timgit/pg-boss
- Drizzle, RLS: https://orm.drizzle.team/docs/rls e releases: https://github.com/drizzle-team/drizzle-orm/releases
- Testcontainers para Node, PostgreSQL: https://node.testcontainers.org/modules/postgresql/
- Referência da Claude API (skill `claude-api`, preços e modelos em cache de 06/10/2026)
- Transcrição OpenAI: apenas fontes secundárias, **sem confirmação oficial** (ver seção 2)
