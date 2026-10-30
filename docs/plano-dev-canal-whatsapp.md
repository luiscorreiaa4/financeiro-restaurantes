# Plano de desenvolvimento: canal WhatsApp (mensagem → lançamento)

> **Papel deste documento:** **ordem de execução** do canal WhatsApp. Cada etapa lista os requisitos (RFs) que entrega e **não** copia regra de negócio: a regra está em [`requisitos.md`](requisitos.md) (cite `RFnn.Rn`), o porquê das decisões em [`decisoes.md`](decisoes.md) e a técnica em [`arquitetura.md`](arquitetura.md). Em conflito, vale `requisitos.md`.

Atualizado em 30/10/2026 (E6 a E9 feitas; alinhado ao Documento de Requisitos v1.0). Cobre as fases 1, 2 e 3 do `docs/mvp.md` e a parte de canal/operação da fase 5. O painel web tem plano próprio em `docs/plano-dev-frontend.md`.

**Pendências P01 a P11 (Matheus) não bloqueiam nenhuma etapa.** Onde um requisito traz `[PROVISÓRIO – Pxx]`, a implementação isola o valor em configuração ou constante única, para trocar depois sem retrabalho (ver DN-11 em `decisoes.md`). A única pendência que já bloqueava, e continua, é a da Meta (P15), só para o teste real e a E10.

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
| E3 Gateway do WhatsApp (webhook) | Feita (28/10/2026) **com ressalva**: falta só o teste com mensagem real do celular, bloqueado por pendência da Meta (P1, ver "Pendências da Meta") | GET/POST `/webhooks/whatsapp`, assinatura sobre bytes brutos, tabela `whatsapp_status_events` (migration 0002), fila `process-inbound` no pg-boss (política `exclusive`, só enfileira; worker é a E4). 95 testes de integração no db e 12 na api passam. Fixtures são sintéticas: trocar/acrescentar as reais anonimizadas. Verificado em 28/10 pelo túnel: handshake, POST assinado, reenvio sem duplicar, assinatura inválida (401) e o botão **Teste** do painel da Meta (status gravado). Pendente: mensagem real do celular (P1) e conferir `redact`/logs do Pino |
| E4 Fila e workers | Feita (28/10/2026) | `worker.ts` separado, fila `process-inbound` com 5 retentativas (backoff 10 s a 160 s) e DLQ `process-inbound-dlq`, caso de uso `ProcessInbound` com transições guardadas e porta de roteamento (no-op até a E5), shutdown limpo. 9 testes de integração do worker, 6 do repo no db e 9 unitários passam. Handler ainda não roteia nada (E5). Pendente: confirmar os números de retry com você e rodar o worker contra o Postgres do Compose |
| E5 Identificação e roteamento | Feita (28/10/2026) | `resolveSender` e `decideRoute` puros no `core`; roteador no worker (desconhecido, ajuda e desfazer provisório, tipo não suportado, reply, pergunta pendente, extração); migration 0003 (`outbound_messages`, `whatsapp_opt_ins`, `memberships.deactivated_at`); **`pnpm dev:chat`** e `pnpm db:seed:dev`. 159 unitários no core, 101 na api e 132+34 de integração passam; testado de verdade no terminal contra o Postgres do Compose. Os ramos de correção, pergunta pendente e extração só chamam handlers que não respondem nada (E6 e E7). Pendente: revisar os textos com o Matheus, `SUPPORT_CONTACT` real, revogação de opt-in (E10) |
| E6 Extração por IA (texto) | Feita (30/10/2026) | `ExtractionResult` com `missing_fields` por lançamento; `ClaudeEntryExtractor` (Haiku 5.5, saída estruturada, `effort` baixo, cache de prompt confirmado ao vivo, Sonnet 5.5 por sinais objetivos); `interpretExtraction` e `buildDrafts` puros no `core`; `ai_usage` por chamada com `pricing.ts` versionado; `pnpm --filter @app/ai extract`. Custo medido: cerca de US$ 0,0004 por mensagem. Pendente: lista de quantidade essencial (P04) e preço do cache do Haiku 5.5 a conferir |
| E7 Fluxo de lançamento e confirmação | Feita (30/10/2026) | Migration 0004 (`flags`, `status` da pergunta, cache em `ai_usage`, `restore`, envio único por origem); `EntryStore`; handlers de extração, resposta à pergunta, correção por reply, `desfazer` (24 h ou por reply), `cancelar`, `suporte`; aviso de falha definitiva; chat com `/reply` e `/custo`. 80 testes de integração da API cobrem o fluxo. Pendente: `trocar unidade`, `trocar empresa` e empresa citada no texto (E11); textos a revisar (P08) |
| E8 Evals e qualidade da IA | Feita (30/10/2026) | 39 casos inventados em JSONL, runner por campo e por lançamento, precisão e revocação da pergunta, custo e latência, baseline em `baseline.json` (100% nos casos atuais), `pnpm --filter @app/ai eval` com trava de orçamento. Rodada completa: cerca de US$ 0,015. Pendente: casos reais anonimizados do Matheus (o 100% é otimista: os casos são meus e o prompt foi ajustado olhando para eles) e rodar o eval no CI (precisa do segredo) |
| E9 Áudio e foto | Feita (30/10/2026) **com ressalva**: áudio e foto só foram testados com fakes; falta teste com áudio e foto reais | Download da Meta (2 passos, conferido na doc), conversão com ffmpeg, transcrição `gpt-transcribe` por `fetch`, limite de 180 s, QR da NFC-e, chave única por empresa (`fiscal_documents`, migration 0005), itens agrupados por categoria, limites de uso (RF21), lida/digitando, chat com `/audio` e `/foto`. Pendente: S3 e retenção de 90 dias (E10), consulta à SEFAZ, preço do `gpt-transcribe`, ffmpeg no servidor |
| E10 Envio real e operação | A fazer | **É aqui que o WhatsApp real é ligado, no fim do desenvolvimento.** Bloqueada pela Meta (P1 e P2) |
| E11 Modelo de dados dos requisitos (papéis, unidades de acesso, campos) | A fazer (nova, 29/10/2026) | Fecha as divergências de `arquitetura.md` que o `core` e o `db` ainda têm. Pode andar junto da E6 |
| E12 Relatórios pelo WhatsApp (RF20) | A fazer (v1.1; nova) | Resumos predefinidos podem vir antes (P10) |
| E13 Automações da v1.1 (RF31, RF33, RF34, RF35) | A fazer (v1.1; nova) | Só depois do piloto |

### Requisitos por etapa

Cada etapa lista os RFs que entrega; as regras ficam em `requisitos.md`. Etapas já feitas ganham a nota "Ajustes pelos requisitos v1.0" no corpo da etapa (o histórico não foi reescrito).

| Etapa | RFs e RNFs que entrega | Ajuste pendente depois dos requisitos v1.0 |
|---|---|---|
| E1 | RF06 (papéis e `can()`), RF08.R3 e RNF13 (dinheiro e taxa), RF01.R11 (telefone) | Sim (nota na etapa) |
| E2 | RNF02 (isolamento), RNF04 (versões e trilha), base de RF12, RF24, RF25 | Sim (E11) |
| E3 | RF11.R1 e R2 (recebimento idempotente), RNF01.R5, RNF05.R1 | Só o teste real (P15) |
| E4 | RNF05.R5 e R6 (retry, DLQ, idempotência) | Não |
| E5 | RF11.R5, R7 a R9, RF05.R8 e R9, RF19 (`ajuda`, tipo não suportado), RF11.R8 | Sim (nota na etapa) |
| E6 | RF12 (R1 a R20, extração), RF15.R1 e R2 (rascunho), RF21.R2 (parte), RNF07, RNF08 | n/a |
| E7 | RF12 (gravação), RF10, RF15, RF16, RF17, RF18, RF19 (comandos), RF09.R4 e RF12.R13 | n/a |
| E8 | RNF07 | n/a |
| E9 | RF13, RF14, RF21 (limites de mídia e taxa por usuário), RF11.Obs3 | n/a |
| E10 | RF11.R10, RF19 (`parar` e `voltar`), RF21 (cotas), RNF05, RNF06, RNF11, RNF12 | n/a |
| E11 | RF04, RF05.R5 a R8, RF06 (permissões adicionais), RF07, RF08, RF09 (campos) | n/a |
| E12 | RF20 | n/a |
| E13 | RF31, RF33, RF34, RF35 (v1.1); RF32 e RF36 (Fase 2) só listados | n/a |

**Fechamento de etapa (sempre, antes de marcar "Feita"):**
1. Rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que a etapa cumpre o "Pronto quando".
2. Atualizar a tabela de progresso e o campo "Atualizado em".
3. **Revisar o contexto do Claude.** Responder: o que repetiu ou deu errado nesta etapa e vale virar regra (`.claude/rules`), skill, hook, `CLAUDE.md` do módulo ou subagente? Usar o critério: erro repetido duas vezes vira regra ou `CLAUDE.md`; procedimento colado pela terceira vez vira skill; o que precisa acontecer sempre vira hook. **Propor e esperar aprovação; não criar sozinho.** Ver os candidatos previstos por etapa em `docs/pesquisa-ecossistema-claude-code.md`, seção 12 (arquivo local, fora do git).
4. Sugerir a mensagem de commit em Conventional Commits. Não commitar sem pedido.

**Decisões:** D1 a D7 e as decisões das etapas estão em [`decisoes.md`](decisoes.md) (seções 1 e 3). Este plano cita o ID em vez de repetir a explicação.

**Estado do repositório:** fase 0 pronta (monorepo, Biome, Vitest, validação de env, Postgres no Compose). Faltava só rodar o CI no GitHub.

## 1. Objetivo e escopo

Uma mensagem de WhatsApp (texto, depois áudio e foto) vira um ou mais lançamentos gravados, auditáveis e confirmados ao usuário, com custo de IA medido e sem nunca deixar a IA fazer conta.

**Dentro (MVP):** webhook, fila, identificação de usuário, extração por IA, gravação com versão e origem, confirmação, comandos (RF19), correção por reply, áudio, foto, evals, custo por tenant, limites de uso (RF21). Requisitos: RF11 a RF19 e RF21, mais RNF05, RNF07, RNF08, RNF11 e RNF12.

**v1.1 (etapas E12 e E13):** relatórios pelo WhatsApp por hierarquia (RF20), captura de NF-e por e-mail (RF31), recorrentes (RF33), resumo semanal e alertas (RF34), importação (RF35). **Fase 2:** RF32 (certificado A1) e RF36 (contador). Open Finance fica fora.

**Premissa atual:** dois bloqueios na Meta, ambos fora do código (detalhe em "Pendências da Meta", logo abaixo): **P1** mensagens reais não chegam ao nosso webhook (app em modo desenvolvimento) e **P2** o envio real está bloqueado (erro 130497). Tudo é construído com o envio atrás de uma interface e com fixtures no lugar do recebimento real; liga quando a Meta liberar. As etapas E4 a E9 não dependem de P1 nem de P2: durante todo o desenvolvimento o canal é testado pelo **chat de desenvolvimento no terminal** (D7, seção 3.6), e o WhatsApp real só é configurado no fim (E10).

### Pendências da Meta (P1 e P2), atualizado em 28/10/2026

No documento de requisitos as duas aparecem juntas como a pendência **P15** (desbloqueios da Meta). Não são tarefas de código. São duas coisas diferentes e não devem ser confundidas. Antes de 28/10 achávamos que o recebimento "funcionava"; o que funcionava era o **console de teste da própria Meta**, que não passa pelo nosso webhook.

| | P1: recebimento real | P2: envio real |
|---|---|---|
| Sintoma | Mensagem do celular para o número de teste (+1 555 189-5223) aparece no console da Meta, mas **nenhum POST chega à nossa API**. Só o botão **Teste** do painel chega. | Ao enviar pelo console de teste para o celular, o status volta `failed` com erro `130497` ("Business account is restricted from messaging users in this country"). |
| Causa (o que sabemos) | ✅ Aviso do painel da Meta (Etapa 2, "Configurar webhooks"): enquanto o app não for publicado, só chegam webhooks de **teste enviados pelo painel**; dados de produção, inclusive de administradores, desenvolvedores e testadores, só depois de publicar. | ⚠️ Não confirmada. O código é de integridade e indica restrição **por país de destino da conta** (fontes de terceiros). Hipóteses: forma de pagamento, perfil do negócio incompleto, verificação da empresa, categoria do negócio. Não é "bot internacional". |
| O que já descartamos | Nosso código (botão Teste: POST assinado, 200 em 17 ms, status gravado), túnel, verify token (handshake 200), campo `messages` assinado. | Lista de países da exceção para provedores de IA: o Brasil está incluído, não é a causa provável. |
| Como resolver | Publicar o app (modo Live). ⚠️ Não conferimos o que a Meta exige para publicar (costuma pedir política de privacidade e categoria). Alternativa: número de produção. | Forma de pagamento, completar perfil, repetir o envio; depois verificação da empresa (CNPJ); se persistir, ticket no suporte com o `fbtrace_id`. |
| O que bloqueia | Só o teste real da E3 (o "Pronto quando"). | Só a E10 e qualquer resposta real no WhatsApp (regra 7, "confirmar sempre"). |
| Dono | Luís | Luís (pagamento e perfil); Matheus (CNPJ para a verificação) |

**Para repetir o teste real da E3 quando P1 for resolvido:** `docs/e3-o-que-falta-para-fechar.md`, passo 4. Mandar "Teste" do celular; deve entrar 1 linha em `inbound_messages` com o seu `wa_id` e 1 job em `pgboss.job`.

**Enquanto isso:** desenvolver E4 a E9 testando pelo **chat de desenvolvimento no terminal** (D7, seção 3.6), mais as fixtures e o POST assinado local. O WhatsApp real só é configurado no fim, na E10.

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
| `MessageSender` (enviar texto, marcar como lido, indicador de digitação) | `CloudMessageSender` | `DevMessageSender` (chat de desenvolvimento, grava e mostra no terminal), `LogMessageSender` (só registra), `FakeMessageSender` (testes) |
| `MediaDownloader` (baixar a mídia recebida) | `MetaMediaDownloader` | `DevFileMediaDownloader` (lê arquivo local, usado pelo chat de dev), `FakeMediaDownloader` (testes) |
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

### 3.6 Chat de desenvolvimento (D7): conversar com o sistema sem o WhatsApp

> **Só para desenvolvimento e teste.** Não é produto, não vai para o cliente e **não precisa de interface bonita**: é um programa de terminal. O WhatsApp real é ligado **no fim do desenvolvimento** (E10), quando a Meta estiver liberada (P1 e P2).

**O que é:** um simulador de WhatsApp no terminal (`pnpm dev:chat`). Você digita como se fosse o dono do restaurante, o sistema processa de verdade (fila, worker, IA, banco) e a resposta aparece na própria tela.

**Como funciona (alta fidelidade, quase nenhum código especial):**
1. O chat monta um payload **no formato real da Cloud API** (o mesmo construtor das fixtures), assina com `WHATSAPP_APP_SECRET` e faz POST em `http://localhost:4000/webhooks/whatsapp`. Assim exercita a rota, a assinatura, o parser, a idempotência, a fila, o worker e a IA exatamente como na produção. Nada de atalho no caminho de entrada.
2. A resposta sai pela porta `MessageSender`. O adaptador de desenvolvimento, `DevMessageSender`, grava a resposta na tabela de mensagens enviadas (que a E7 já precisa para a correção por reply, com id `dev.out.<uuid>`) e o chat a mostra, consultando a tabela a cada ~1 s.
3. Áudio e foto: `/audio arquivo.ogg` e `/foto nota.jpg` geram um payload com mídia apontando para um arquivo local; o `DevFileMediaDownloader` (porta `MediaDownloader`) lê do disco em vez de baixar da Meta. O resto do fluxo (transcrição, QR, extração) é o real.

**Comandos do chat (primeira lista, enxuta):** texto livre (vira mensagem); `/como <telefone>` troca de usuário (testa papéis, dois tenants, 9º dígito, número desconhecido); `/audio <arquivo>`; `/foto <arquivo>`; `/reply` responde à última confirmação (preenche `context.message_id`); `/custo` mostra o `ai_usage` da conversa; `/sair`.

**Salvaguardas:** `CHANNEL_MODE=dev|whatsapp` no `.env` (validado com Zod). O chat e os adaptadores `Dev*` recusam subir com `NODE_ENV=production`. Mensagens do chat usam `wa_message_id` com prefixo `dev.` e ficam marcadas, para nunca se misturarem com dados reais.

**Por que terminal e não outra coisa (o que estudamos):**

| Opção | Veredito |
|---|---|
| Terminal (REPL em Node, `readline`) | ✅ Escolhida. Zero interface, mesmo repositório, scriptável (serve para testes ponta a ponta e para gravar uma demo para o Matheus), sem conta nem custo. |
| Interface web em React | Descartada: custo de construção sem ganho para testar. O painel real é a F0 a F8; não duplicar. |
| Console de teste da Meta | Não serve: só entrega testes do painel enquanto o app não estiver publicado (P1) e o envio dá 130497 (P2). |
| Telegram ou outro app de mensagem | Descartada: exige conta e adaptador extras e não é o formato do WhatsApp. |
| Só testes automatizados | Continuam (seção 5), mas não deixam "conversar" e explorar frases novas. O chat é o complemento. |

**O que o chat NÃO testa (fica para a E10, com a Meta real):** janela de 24 h, templates aprovados, status de entrega, limites de mídia, erros como 130497 e 131030, latência da Meta.

**Quando é construído:** versão 1 na **E5** (digitar texto e ver a resposta, trocar de usuário); cresce na **E7** (`/reply`, `/custo`) e na **E9** (`/audio`, `/foto`). O script da E6 (10 a 15 frases direto na IA, com custo por mensagem) continua existindo: testa só a extração, sem banco.

**Ligar o WhatsApp real (checklist do fim do desenvolvimento, E10):**
1. P1: publicar o app da Meta e repetir o teste real da E3 (`docs/e3-o-que-falta-para-fechar.md`, passo 4).
2. P2: resolver o erro 130497 (pagamento, perfil, verificação da empresa com CNPJ).
3. Número definitivo e nome de exibição.
4. `CHANNEL_MODE=whatsapp`: entram `CloudMessageSender` e `MetaMediaDownloader` no lugar dos `Dev*` (só a composição em `apps/api` muda; o `core` e a IA não sabem a diferença).
5. Rodar o mesmo roteiro do chat de dev, agora pelo celular, em staging.

## 4. Decisões

A explicação de cada decisão (motivo, onde vale e situação) está em [`decisoes.md`](decisoes.md). Aqui fica só o índice, para os trechos deste plano que citam o ID.

| ID | Tema | Situação |
|---|---|---|
| D1 | Extração com saída estruturada; tool use só para consultas (v1.1) | Decidida |
| D2 | Drizzle 0.45.x estável, sem API relacional | Decidida |
| D3 | Corpo bruto do webhook guardado por mensagem; assinatura sobre os bytes | Decidida (E3) |
| D4 | Build de produção da API e dos workers | Aberta, decidir na E10 |
| D5 | Haiku primeiro, medir nos evals | Recomendação |
| D6 | O que é "informação essencial" para perguntar de volta | Provisória: RF12.R17 `[PROVISÓRIO – P04]` |
| D7 | Chat de desenvolvimento no terminal (seção 3.6) | Decidida |

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
- **Onde ficam os testes:** testes unitários (`*.test.ts`) ficam **ao lado do arquivo que testam**, na mesma pasta de `src/`, sem subpasta `test` ou `__tests__` (é o que `core`, `db`, `config`, `whatsapp` e `api` já fazem). Testes de integração (`*.int.test.ts`, Postgres real) e fixtures ficam em `test/` na raiz do pacote. O Vitest não impõe local: o padrão é `**/*.{test,spec}.?(c|m)[jt]s?(x)` e o guia oficial coloca `sum.test.js` ao lado de `sum.js` (vitest.dev/config/include e vitest.dev/guide, conferido em 28/10/2026).
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

**Ajustes pelos requisitos v1.0** (29/10/2026; o histórico acima não foi alterado):
- Papéis: `owner`, `manager` e `staff` equivalem a DONO, GERENTE e LANCADOR (DN-04). Faltam o papel `accountant` (Fase 2, RF36) e as permissões adicionais VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL e CONSULTAR_RELATORIOS_WHATSAPP (RF05.R7, RF06). A regra de categoria sensível deixa de ser "só o `owner`" (RF06.R3). A matriz da seção 2.3 vira teste (RF06.CA06). Fica na **E11**.
- Taxa e líquido: confirmados o arredondamento meio-para-cima (RF08.CA02) e a tolerância de R$ 0,01 (RF12.R5). Falta aplicar taxa **só em receitas** (RF08.R3, RF12.R11) e a regra do canal APLICATIVO que substitui a taxa da forma de pagamento (RF09.R4, `[PROVISÓRIO – P06]`): E7.
- Comandos: o parser cobre `desfazer` e `ajuda`; faltam `cancelar`, `trocar unidade`, `trocar empresa`, `suporte` (E7) e `parar` e `voltar` (E10), todos do RF19.
- Telefone: a normalização do 9º dígito já cumpre RF01.R11 e RF01.CA09.
- D6 (o que é "essencial") passa a ser RF12.R17, `[PROVISÓRIO – P04]`.

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

**Ajustes pelos requisitos v1.0** (29/10/2026): o isolamento cumpre RNF02. Os requisitos pedem campos e tabelas que o schema não tem (empresa com plano e situação, unidade com apelidos e status, lista de unidades por colaborador, categoria com Exige Quantidade e palavras de apoio, lançamento com sinais de revisão, motivo da exclusão e documento fiscal, `pending_questions` com situação, `ai_usage` com cache, `audit_log` sem empresa). A lista completa, com RF e etapa, está em `arquitetura.md`, seção "Divergências entre o modelo de dados atual e os requisitos". A lista de categorias do seed segue provisória (DE-02, P01, P02, P05). Nenhuma migration nova nesta rodada; entram na **E11** e nas etapas de cada RF, sempre pela regra `.claude/rules/tabela-nova.md`.

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

#### Resultado da E3 (28/10/2026)

> **Passo a passo do que falta para fechar a E3 (túnel, Meta, conferências): `docs/e3-o-que-falta-para-fechar.md`.**

**Entregue:** `GET/POST /webhooks/whatsapp` (`apps/api/src/http/webhooks/whatsapp.ts`), caso de uso `IngestWebhook`, `PgBossQueue` mínimo (fila `process-inbound`, política `exclusive`, só enfileira), tabela `whatsapp_status_events` (migration 0002), `createInboundIngestRepo` (`packages/db`), parser, assinatura e handshake (`packages/whatsapp`), 11 fixtures sintéticas e `DATABASE_INGEST_URL`. Testes: 95 de integração no db e 12 na api passam (`pnpm test:int`).

**Decisões desta etapa:** status em tabela própria; pg-boss instalado já na E3 com adaptador mínimo; D3 resolvida como fatia por mensagem (`raw` guarda metadata, contato e a mensagem, não o POST inteiro); fixtures sintéticas por ora.

**Confirmado na doc do pg-boss (28/10/2026):** `singletonKey` só deduplica em filas `short`, `stately` ou `exclusive` (ou com `singletonSeconds`); `send()` pode devolver `null`; `createQueue` aceita `policy`, `deadLetter`, `retryLimit`, `retryBackoff`, `expireInSeconds`. A idempotência real é o `INSERT ... ON CONFLICT DO NOTHING ... RETURNING`. Falta confirmar para a E4: opções de `stop()` e de `work()`.

**Padrões adotados (conferir):**
- Sem `WHATSAPP_APP_SECRET` ou `WHATSAPP_VERIFY_TOKEN`, a rota responde 503 e nunca aceita sem checar.
- Assinatura inválida: 401. JSON inválido: 400. Campo que não é `messages`: 200 sem gravar.
- Tipos não tratados (reação, figurinha) viram `unsupported` e também são enfileirados; a E5 decide o que fazer.
- Falha ao enfileirar depois de gravar: 500. Na reentrega, mensagem ainda em `received` volta para a fila.
- Logs sem query string (o handshake leva `hub.verify_token`) e sem conteúdo de mensagem, nem em erro do banco (o Drizzle põe os parâmetros do SQL na mensagem de erro).
- Convenção de testes: unitários ao lado do código em `src/`; integração e fixtures em `test/`.

**Como testar à mão**
1. `docker compose up -d`. Em banco antigo, crie o papel: `docker compose exec -T postgres psql -U postgres -d app < docker/postgres/init.sql`.
2. `pnpm db:migrate`.
3. No `.env`: `DATABASE_INGEST_URL=postgres://app_ingest:app_ingest@localhost:5434/app` (porta **5434**: a 5432 pode estar ocupada por um Postgres nativo do Windows), e `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` com qualquer valor local.
4. `pnpm dev`.
5. Handshake no navegador: `http://localhost:4000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123` deve mostrar `123`. Token errado: 403.
6. POST assinado, na raiz do repositório (deve imprimir `200 {"ok":true}`; rodar duas vezes não duplica):
   ```
   node --env-file=.env -e "const c=require('crypto'),fs=require('fs');const b=fs.readFileSync('packages/whatsapp/test/fixtures/text-message.json');const s='sha256='+c.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(b).digest('hex');fetch('http://localhost:4000/webhooks/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':s},body:b}).then(async r=>console.log(r.status,await r.text()))"
   ```
7. Banco: `docker compose exec postgres psql -U postgres -d app -c "select wa_message_id, type, text, status from inbound_messages"` mostra 1 linha `Teste` com status `received`; `-c "select count(*) from pgboss.job"` mostra 1 job.
8. Troque um caractere do comando do passo 6: deve voltar 401 e nada é gravado.

**Pendências da E3**
- [ ] Teste real pelo túnel: túnel, URL, verify token e botão Teste da Meta **já feitos em 28/10** (POST assinado chegou, status gravado). Falta a mensagem "Teste" real do celular virar linha em `inbound_messages` e o reenvio não duplicar. ⏳ Bloqueado por **P1** (app da Meta não publicado). É o "Pronto quando" da etapa.
- [ ] Trocar/acrescentar as fixtures sintéticas pelos dois payloads reais anonimizados (texto recebido e `status: failed` 130497).
- [ ] Conferir `redact` do Pino na doc (⚠️ item da seção 2); hoje o `req` é serializado só com método, caminho e id.
- [ ] Script de carga do webhook (o teste de latência cobre uma requisição com folga; a carga em rajada fica para antes do piloto).
- [x] Formato do `user_id` (`BR.<número>`): no payload real do console de teste (28/10) vem nos **dois** lugares, `contacts[].user_id` e `messages[].from_user_id`. O parser já aceita os dois; falta só virar fixture real anonimizada.

**Candidatos de contexto do Claude propostos (aguardam aprovação, nada foi criado):**
1. Regra `.claude/rules/webhook.md` (`apps/api/src/http/**`, `packages/whatsapp/**`): assinatura sobre bytes brutos, `bodyLimit` ≥ 3 MB, idempotência, 200 em < 1 s, iterar todos os eventos, nunca logar query string nem conteúdo.
2. Skill `novo-fixture-whatsapp`: capturar payload real, anonimizar, criar fixture e teste de contrato.
3. Subagente `revisor-seguranca` (Read, Grep, Glob, Bash somente leitura): isolamento de tenant, PII em log, assinatura, segredos.
4. Hook `PreToolUse` que bloqueia editar migration já commitada (a 0002 já está).
5. Regra `.claude/rules/testes.md`: unitário em `src/`, integração em `test/`, fixtures em `test/fixtures/`.
6. Erro que repetiu: heredoc grande no Bash do Windows falha; usar Write/Edit. Vale uma linha no `CLAUDE.md`.

**Próxima etapa:** E4 (fila e workers). Antes, aprovar ou ajustar os candidatos acima e fazer o teste real pelo túnel.

**Ajustes pelos requisitos v1.0** (29/10/2026): o webhook cumpre RF11.R1 e R2 (idempotência pelo identificador da mensagem), RF11.CA01 e CA06 (duplicata e assinatura inválida), RNF01.R5 e RNF05.R1. Nada a mudar no código. O teste real com mensagem do celular segue bloqueado pela Meta, hoje a pendência **P15** (antes P1 e P2 do plano). Documento em PDF de nota fiscal recebe a resposta de tipo não suportado até o RF31 (RF11.R3).

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

#### Resultado da E4 (28/10/2026)

**Entregue:** `apps/api/src/worker.ts` (entrypoint separado do `server.ts`, mesma imagem), `infra/pg-boss-worker.ts` (consome `process-inbound` em lote, resposta por job com `perJobResults`), `infra/process-inbound-queue.ts` (`ensureProcessInboundQueues`: cria a DLQ e a fila, e converge com `updateQueue` a fila que a E3 criou só com `exclusive`), `modules/inbound/process-inbound.ts` (caso de uso, valida o job com Zod, porta `RouteInbound` com `routeNothing` como padrão), `infra/logger.ts` (pino com `redact`), `InboundProcessingRepo` em `core` e `createInboundProcessingRepo` em `db`. Scripts: `pnpm dev:worker` (raiz) e `start:worker` (api).

**Decisões desta etapa (suas):** handler como esqueleto com porta de roteamento; worker com o papel `app_ingest` até a E5; 5 tentativas com backoff e DLQ de 14 dias; `pino` adicionado. **Adicionei por padrão:** `zod` em `apps/api` (a stack já o define; mesma versão do workspace).

**Política da fila (constante em `process-inbound-queue.ts`):** `retryLimit 5` (6 execuções no total), `retryDelay 10` com backoff e teto de 300 s, `expireInSeconds 300`, DLQ com retenção de 14 dias. Mensagem fica `failed` com código curto (`Error`, `Error:40001`), nunca o texto nem a mensagem de erro (o Drizzle põe os parâmetros do SQL nela).

**Confirmado na doc/tipos do pg-boss 12.38 (28/10/2026):** opções de `createQueue` (`retryDelayMax` só vale com `retryBackoff: true`, o pg-boss recusa sem isso: descoberto pelos testes); `work()` com `batchSize`, `pollingIntervalSeconds`, `localConcurrency` e `perJobResults` (resultado `completed`/`failed`/`deadletter` por job); `Job.retryCount`; `stop({ graceful, close, timeout })` com padrão `graceful: true`, `timeout: 30000`; DLQ precisa existir antes.

**Padrões adotados (conferir):**
- Retomada: `claim` aceita `received` e `processing`, porque o retry e o job expirado de um worker caído voltam com a mensagem em `processing`.
- Mensagem já `processed`, `failed` ou `needs_answer` + job duplicado ou atrasado: ignorado (`skipped`), job completa.
- Payload de job fora do contrato: vai direto para a DLQ (`deadletter`), sem retentar.
- Lote de até 5 mensagens, processadas em sequência; um erro não derruba as outras.
- Servidor e worker chamam `ensureProcessInboundQueues` ao subir (idempotente).
- `pnpm dev` continua subindo só api e web: o worker é `pnpm dev:worker` em outro terminal.

**Como testar à mão**
1. `docker compose up -d` e `pnpm db:migrate`; `.env` com `DATABASE_INGEST_URL` e `DATABASE_ADMIN_URL` (porta 5434).
2. Terminal 1: `pnpm dev`. Terminal 2: `pnpm dev:worker` (deve logar "worker iniciado").
3. Mande o POST assinado do passo 6 da E3. No terminal do worker aparece "mensagem processada" (sem o texto).
4. `docker compose exec postgres psql -U postgres -d app -c "select wa_message_id, status, error from inbound_messages"` mostra `processed`; `-c "select name, state from pgboss.job"` mostra o job `completed`.
5. Parada limpa: Ctrl+C no worker loga "encerrando worker" e sai sem erro. Para ver a falha: derrube o worker, mande a mensagem, e confira que o job fica `created` e é consumido quando o worker volta.

**Pendências da E4**
- [ ] Confirmar a política de retry (números acima) e o lote de 5.
- [ ] Rodar o worker uma vez contra o Postgres do Compose (os testes usam Testcontainers).
- [ ] Alerta/monitoramento da DLQ (E10).
- [ ] Teste real de queda do processo (`kill`) fica para o staging; o teste automatizado simula com `stop({ graceful: false })` + expiração.

**Contexto do Claude criado após aprovação (28/10/2026):** `.claude/rules/pg-boss.md`, `.claude/rules/testes.md`, skill `.claude/skills/novo-worker-pgboss/` e a linha `pnpm dev:worker` no `CLAUDE.md`.

**Próxima etapa:** E5 (identificação e roteamento). Ela troca `routeNothing`, passa a atribuir o tenant à mensagem e cria o `pnpm dev:chat`.

**Ajustes pelos requisitos v1.0** (29/10/2026): a política de 5 retentativas com backoff, a DLQ e a idempotência cumprem RNF05.R5 e R6 e RNF05.CA02 (DE-06). A falha definitiva ainda precisa avisar o colaborador com o contato do suporte (RF19.R4, RF19.CA05): entra na E7/E10. O alerta da DLQ vira o painel interno (RF38, F10).

### E5: Identificação e roteamento da conversa — M

**Objetivo:** saber quem escreveu e o que a mensagem é, antes de gastar IA.

**Entregas**
- Resolução telefone → usuário → tenant, papéis e unidade padrão, com a normalização da E1.
- Número desconhecido: resposta educada e padronizada, dentro da janela de 24 h, sem expor dados.
- Registro do **opt-in** do usuário (exigência da política da Meta).
- Roteamento em ordem: comando (`desfazer`, `ajuda`) → resposta a uma confirmação (correção por reply, via `context.message_id`) → resposta a pergunta pendente → extração.
- Saída para humano nas mensagens de ajuda e erro (canal de suporte).
- Recusa curta e padronizada para assunto fora do escopo (a política da Meta trata IA de propósito geral como proibida).
- **Chat de desenvolvimento v1** (D7, seção 3.6): `pnpm dev:chat` no terminal, que assina e envia payloads ao webhook local, mostra as respostas pelo `DevMessageSender` e troca de usuário com `/como`. Só desenvolvimento; sem interface visual. `CHANNEL_MODE=dev` no `.env`.

**Testes:** tabela de telefones com e sem 9º dígito; usuário de dois tenants; usuário desativado; comandos com variações; reply para a confirmação certa e para uma antiga; mensagem fora de escopo.

**Pronto quando:** cada tipo de mensagem cai no ramo certo sem chamar a IA nos casos de comando e número desconhecido, e dá para ver isso conversando pelo `pnpm dev:chat`.

#### Resultado da E5 (28/10/2026)

**Entregue**
- `core`: `resolveSender` (vínculo ativo mais antigo; desativado = desconhecido; unidade padrão) e `decideRoute` (ordem: remetente → tipo → comando → reply a confirmação → pergunta pendente → extração), ambos puros. Portas `SenderDirectory`, `InboundSenderRepo`, `TenantConversationRepo`; `MessageSender.sendText` ganhou `trace` opcional (tenant, mensagem de origem, finalidade).
- `db`: migration `0003_conversation_routing` com `outbound_messages` (tenant opcional, só acrescenta), `whatsapp_opt_ins` (por tenant, só acrescenta, única por usuário) e `memberships.deactivated_at`; repositórios dos três adaptadores e do registro de saída; `claim` passa a devolver `replyToWaMessageId` (lido de `raw.message.context.id`); `seedDevData` (`pnpm db:seed:dev`).
- `apps/api`: `route-inbound.ts` (troca o `routeNothing`), `messages.ts` (todos os textos pt-BR), `DevMessageSender` (recusa `NODE_ENV=production`), composição do worker com os papéis `app_ingest` e `app`, `CHANNEL_MODE` e `SUPPORT_CONTACT` no env.
- `whatsapp`: `buildTextWebhookPayload`, no mesmo formato das fixtures (inclui `context` de reply e `from_user_id`).
- Chat de desenvolvimento v1 (`apps/api/src/dev`): `/como`, `/sair`, texto livre; `/reply` e `/custo` (E7), `/audio` e `/foto` (E9) respondem que ainda não existem.

**Decisões desta etapa (suas):** em 2 restaurantes vale o vínculo mais antigo (a confirmação da E7 deve citar o nome do restaurante); opt-in na primeira mensagem de número cadastrado, em tabela por tenant; `desfazer` provisório ("Ainda não há nada para desfazer.") e `ajuda` real; fora do escopo por conteúdo fica para a E6 (intent `out_of_scope`), a E5 só recusa tipo não suportado; desativação em `memberships.deactivated_at`; suporte como placeholder genérico até haver contato; textos do rascunho aprovados; seed de dev separado.

**Padrões adotados (conferir):**
- Desativado e desconhecido recebem exatamente a mesma resposta (não revela que o cadastro existe).
- Texto vazio conta como tipo não suportado. Áudio e foto vão para o ramo de extração.
- Comando vence reply: "desfazer" respondendo a uma confirmação continua sendo comando (a E7 decide se desfaz aquele lançamento).
- Reply a mensagem nossa que não é confirmação (ajuda, aviso) não vira correção.
- Reply a uma confirmação antiga aciona a correção **daquela** confirmação, não da última.
- Resposta sempre para o número com o 9º dígito; o `wa_id` recebido pode vir sem.
- Número de outro país: recebe a resposta de desconhecido.
- Erro de envio sobe e o job é retentado. Como o envio acontece antes do `markProcessed`, um retry depois de enviar pode repetir a resposta; a E7 deve tornar o envio idempotente por (mensagem de origem, finalidade).
- Opt-in: sem revogação por enquanto. `unique (tenant, user)` impede duplicar; opt-out e novo opt-in entram na E10.

**Conferido na documentação da Meta (28/10/2026):** a política exige opt-in e deixa o método e a prova por conta da empresa; a automação exige saída para humano. A página **não** traz a regra de "IA de propósito geral proibida" que o plano cita (deve estar nos termos de soluções de negócio): tratamos a recusa fora do escopo como decisão nossa, não verificada.

**Como testar à mão**
1. `docker compose up -d`, `pnpm db:migrate` e `pnpm db:seed:dev` (com `DATABASE_ADMIN_URL` definida; o `db:migrate` não lê o `.env`).
2. `.env` com `WHATSAPP_APP_SECRET` e `DATABASE_INGEST_URL`. Terminal 1: `pnpm dev`. Terminal 2: `pnpm dev:worker`. Terminal 3: `pnpm dev:chat`.
3. No chat: `ajuda` (texto de ajuda), `desfazer` (provisório), `paguei 350 de carne` (nota "sem resposta, IA na E6"), `/como 11900000000` + `oi` (número desconhecido), `/como 551187650001` + `ajuda` (sem o 9º dígito), `/como 11987650005` + `ajuda` (desativado: mesma resposta do desconhecido), `/como 11987650004` (em 2 restaurantes).
4. Conferir: `select status, tenant_id from inbound_messages order by received_at desc` e `select count(*) from whatsapp_opt_ins`.

**Pendências da E5**
- [ ] Revisar os textos de `messages.ts` com o Matheus e definir o `SUPPORT_CONTACT` real.
- [ ] Confirmar a regra do "tenant mais antigo" quando o piloto tiver usuário em dois restaurantes.
- [ ] Opt-out/revogação do opt-in e prova de consentimento no cadastro de usuários (E10 e F-etapa de usuários).
- [ ] Idempotência do envio de resposta (E7).
- [ ] Confirmar a regra de "IA de propósito geral" da Meta antes da E10.

**Ajustes pelos requisitos v1.0** (29/10/2026):
- Entregou parte de RF11 (R5 a R9), RF19 (`ajuda`, tipo não suportado) e RF05.R8 e R9. Os textos do `messages.ts` são os rascunhos de RF11.R8 e RF19; a revisão é do Matheus (`[PROVISÓRIO – P08]`).
- `desfazer` provisório ("Ainda não há nada para desfazer.") **não** é o RF18; o comportamento real (últimas 24 h, reply, ordem inversa) entra na E7 (DE-09).
- O reply a confirmação antiga já aciona a confirmação certa (RF17.R1); a correção em si é E7.
- Faltam: atribuição à empresa citada no texto (RF11.R5), comandos `cancelar`, `trocar unidade`, `trocar empresa`, `suporte` (E7), `parar` e `voltar` com revogação do opt-in (E10, P14).
- O ramo de pergunta pendente só roteia (o handler responde nada até a E7). Cancelar a pergunta quando chega um lançamento novo, com aviso, é RF15.R6: E7.

### E6: Extração por IA (texto) — G

**Objetivo:** texto livre → `ExtractionResult` validado, barato e medido.

**Entrega os requisitos:** RF12 (R1 a R20: interpretação, campos, datas, valores, vários lançamentos, essenciais `[PROVISÓRIO – P04]`), RF15.R1 e R2 (rascunho e pergunta única), RF21.R2 (parte), RNF07 e RNF08. Regras acrescentadas pelos requisitos v1.0 que esta etapa precisa cumprir: datas futuras recusadas pelo WhatsApp (RF12.R2), "cartão" sem especificar usa a forma de cartão padrão (RF12.R8), conferência de quantidade × preço × total com diferença acima de R$ 0,01 gerando pergunta (RF12.R5), sinais de revisão CATEGORIA_A_REVISAR e DATA_ANTIGA (RF12.R6 e R13), descrição sem CPF nem número de cartão (RF12.R3), contexto só da empresa da mensagem (RF12.R18). Critérios: RF12.CA01 a CA10.

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

**Entrega os requisitos:** RF12 (gravação: R11 a R15, canal de origem e sinais), RF10 (fornecedores criados a partir dos lançamentos), RF15 (pergunta única, validade de 24 h, mensagem nova cancela a pergunta com aviso, uma aberta por colaborador), RF16 (confirmação, **envio idempotente**, ver RF16.Obs1 e P14), RF17 (correção por reply), RF18 (**desfazer**: última mensagem nas últimas 24 h, como reply desfaz aquela confirmação, de novo desfaz o anterior; ver RF18.R1 a R6), RF19 (`cancelar`, `trocar unidade`, `trocar empresa`, `suporte`; aviso de falha definitiva, RF19.R4), RF09.R4 (canal APLICATIVO substitui a taxa da forma, `[PROVISÓRIO – P06]`), RF11.R5 (empresa citada no texto). Taxa só em receitas (RF08.R3). `entry_versions` ganha a ação de restauração (RF25.R4). Textos de confirmação são provisórios até a revisão do Matheus (`[PROVISÓRIO – P08]`). Critérios: RF15.CA01 a CA04, RF16.CA01 a CA04, RF17.CA01 a CA05, RF18.CA01 a CA05, RF19.CA01 a CA05.

**Entregas**
- Caso de uso `RegisterEntries`: valida, calcula taxa e líquido no `core`, grava `entries`, `entry_versions` e `ai_usage` **na mesma transação**, guarda `inbound_message_id` como origem.
- Mensagem de confirmação no formato padrão (textos do Matheus), com o que foi registrado e como corrigir. Guarda o `wa_message_id` da resposta para permitir correção por reply.
- Pergunta de volta (`pending_questions`) e retomada quando o usuário responde.
- `UndoEntry` (`desfazer`) e `CorrectEntry` (reply), ambos gerando versão.
- Vários lançamentos por mensagem, com confirmação agrupada.

**Testes:** ponta a ponta do canal (fixture de webhook → banco → saída do `FakeMessageSender`); desfazer duas vezes; corrigir um lançamento antigo; erro no meio da transação não deixa lançamento pela metade; permissão negada.

**Pronto quando:** a mensagem digitada no `pnpm dev:chat` vira lançamento com versão e origem, e a confirmação aparece no próprio chat. (Pelo celular, só na E10.)

### E8: Evals e qualidade da IA — M (contínuo)

**Objetivo:** saber, com número, se a IA está melhorando ou piorando.

**Entrega os requisitos:** RNF07 (conjunto de avaliação, métricas por campo e por lançamento, meta do piloto de 90% sem correção e 98% de valor e tipo corretos, bloqueio de mudança que piora; ver RNF07.R1 a R5 e CA01), mais RF13.CA05 (áudios de cozinha) quando a E9 existir.

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

**Entrega os requisitos:** RF13 (áudio: limite de 180 s, transcrição, trecho entendido na confirmação, retenção de 90 dias; RF13.R1 a R4), RF14 (foto: QR Code da NFC-e primeiro, leitura por IA como reserva, chave de acesso sem duplicar, itens agrupados por categoria, imagem até 5 MB; RF14.R1 a R6), RF21 (limites de mídia e de mensagens por usuário por hora, RF21.R1 e R2), RF11.Obs3 (marcar como lida e indicador de digitação). Critérios: RF13.CA01 a CA05, RF14.CA01 a CA06.

**Entregas**
- Download de mídia da Meta (obter a URL e baixar com o token; a URL é temporária) e envio ao S3 com chave por tenant. Páginas: `.../business-phone-numbers/media.md`.
- `Transcriber` com `OpenAITranscriber` (RF13.R2 e R3); teste com **áudios reais de cozinha** (ruído, gíria). Conversão com ffmpeg se o OGG/Opus não for aceito ⚠️.
- Reaproveitamento do fluxo de texto: a transcrição entra como texto em `inbound_messages` e segue a E6.
- Foto: leitura do QR da NFC-e e consulta à SEFAZ (estados dos pilotos primeiro, RF14.R5); fallback para extração multimodal.
- Limites de uso (RF21): mensagens por usuário por hora e por empresa por dia, configuráveis por plano.
- Indicador de digitação e confirmação de leitura enquanto processa (páginas "Typing indicators" e "Read receipts" da doc da Meta).
- Retenção de áudio de 90 dias (RF13.R4, RNF03.R4), por regra de ciclo de vida no bucket.

**Testes:** áudios de exemplo com transcrição esperada (tolerância a erro de palavra); QR com fixtures gravadas da SEFAZ (contrato, sem bater no site em CI); imagem sem QR no dataset de evals; rate limit excedido responde de forma padronizada.

**Pronto quando:** um áudio de 20 s e uma foto de NFC-e, enviados pelo `/audio` e `/foto` do chat de dev, viram lançamentos confirmados.

#### Resultado das E6 a E9 (30/10/2026)

**Entregue.** Veja as decisões DE-14 a DE-21 em [`decisoes.md`](decisoes.md) e o guia de testes manuais em [`guia-testes-e6-e9.md`](guia-testes-e6-e9.md).
- `core`: `interpretExtraction`, `buildDrafts`, `planCorrection`, `groupReceiptEntries`, chave de acesso da NFC-e, limites de uso, comandos `cancelar` e `suporte`, portas de mídia e de lançamento. 236 testes.
- `ai`: extrator e corretor Claude, prompts, `pricing.ts`, transcritor OpenAI, fakes, evals. 43 testes.
- `db`: migrations 0004 (fluxo de lançamento) e 0005 (`fiscal_documents`), `EntryStore`, `UsageGuardStore`, `InboundMediaRepo`. 149 testes de integração.
- `whatsapp`: payload simulado de mídia e `MetaMediaDownloader`.
- `apps/api`: handlers de lançamento, correção, desfazer, áudio e foto; limites de uso; aviso de falha definitiva; chat com `/reply`, `/custo`, `/audio`, `/foto`. 124 testes unitários e 80 de integração.

**Pendências (E10 em diante).** S3 e ciclo de vida de 90 dias do áudio; consulta real à SEFAZ (estado do piloto); `trocar unidade`, `trocar empresa` e empresa citada no texto (E11); eval no CI; casos reais para o eval; preço do `gpt-transcribe`; textos a revisar com o Matheus (P08); lista de quantidade essencial (P04); revogação do opt-in (E10).

### E10: Envio real, operação e produção do canal — M

Depende do desbloqueio da Meta (forma de pagamento, verificação da empresa, número definitivo; pendência P15). **É a etapa que liga o WhatsApp real, no fim do desenvolvimento**; até aqui tudo foi testado pelo chat de desenvolvimento (seção 3.6). Siga o checklist "Ligar o WhatsApp real" da seção 3.6.

**Entrega os requisitos:** RF11.R10 (resposta dentro da janela de 24 h, modelos aprovados fora dela), RF19 (`parar` e `voltar`, revogação do opt-in; RF05.R9, P14), RF21 (cota mensal de consultas por plano, aviso a 80% do Dono, limite de custo de IA por empresa com alerta à equipe; RF21.R3 e R4), RNF05 (latência medida e carga), RNF06 (disponibilidade, backup, teste de restauração, ambientes separados), RNF11 (logs sem conteúdo, Sentry, métricas), RNF12 (conformidade com a política da Meta). O painel interno de custo e de saúde da fila é o RF38, na etapa F10 do plano do painel.

**Entregas**
- `CloudMessageSender`: texto dentro da janela de 24 h; templates aprovados para o que inicia conversa (resumo, alertas; código de acesso por WhatsApp é v1.1, RF02.R4).
- Rastreio da janela de 24 h por usuário, para saber quando só template é permitido.
- Tratamento de `statuses` (falha, entregue, lido) e de códigos de erro conhecidos (130497, 131030, janela expirada).
- Observabilidade: Pino com `redact` (nunca texto de mensagem, CPF, salário), Sentry, métricas de latência do webhook, profundidade da fila, latência e custo do LLM.
- Custo por tenant (`ai_usage`) exposto para o painel interno (RF38, F10).
- Decisão D4 (build de produção), backup com teste de restauração, staging e produção com números separados (RNF06).
- Ferramenta interna do "mágico de Oz" (ver mensagens e responder à mão), se for adiantar o piloto.

**Testes:** contrato do `CloudMessageSender` contra respostas gravadas da Graph API; teste de falha de envio (a mensagem fica registrada, o job não perde o lançamento); teste de que nenhum log contém conteúdo de mensagem.

**Pronto quando:** do seu celular ao lançamento confirmado de volta no WhatsApp, em staging, com o número da empresa.

### E11: Modelo de dados dos requisitos (papéis, unidades de acesso e campos) — M/G

**Etapa nova (29/10/2026).** Fecha, no `core` e no `db`, as divergências listadas em `arquitetura.md` ("Divergências entre o modelo de dados atual e os requisitos") que o canal precisa para cumprir as regras. Pode andar junto da E6; as partes de tela ficam em F2 e F6 do plano do painel.

**Entrega os requisitos:**
- RF06 e RF05.R7: quarto papel `accountant` reservado, permissões adicionais (VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL, CONSULTAR_RELATORIOS_WHATSAPP) em `memberships.permissions`, categoria sensível visível para quem tem VER_FOLHA, e a **matriz da seção 2.3 como teste** (RF06.CA06).
- RF05.R5, R6 e R8 (pendência P13): lista de unidades de acesso por colaborador (tabela de vínculo, mantendo "TODAS"), unidade padrão dentro da lista, situação CONVIDADO, ATIVO ou DESATIVADO.
- RF04: apelidos, CNPJ, município, UF e status da unidade.
- RF07, RF08, RF09: campos de apoio da IA (Exige Quantidade, palavras de apoio, apelidos), status, tipo da forma de pagamento e do canal, forma de cartão padrão da empresa.
- RF12.R12 e R13, RF24: sinais de revisão, motivo da exclusão, canal de origem EMAIL e ação de restauração em `entry_versions`.

**Testes:** matriz de permissões (papel × ação); isolamento da tabela de vínculo (regra `tabela-nova.md`); migração dos vínculos existentes (`unit_id` único ou nulo) para a nova lista sem perder acesso.

**Pronto quando:** a matriz da seção 2.3 passa como teste no `core` e a migration roda em banco com dados do seed de desenvolvimento. Valores `[PROVISÓRIO – Pxx]` (P01, P02, P05, P06, P07) ficam em seed e constantes únicas.

### E12: Relatórios pelo WhatsApp por hierarquia (RF20) — M (v1.1)

**Etapa nova.** Resumos predefinidos ("resumo de hoje", "da semana", "do mês") podem ser antecipados para o MVP por decisão dos sócios (P10), sem a interpretação livre.

**Entrega os requisitos:** RF20 (consultas RESUMO, POR_CATEGORIA, POR_FORNECEDOR, POR_FORMA_PAGAMENTO, POR_CANAL, EVOLUCAO, PRECO_INSUMO e MEUS_LANCAMENTOS; permissões por papel, RF20.R4 a R7; período e unidades padrão; resposta de até 12 linhas), RF21.R3 (cota mensal de consultas), RF06.CA01, CA03 e CA05. A IA só escolhe a consulta e os parâmetros; o banco calcula (RNF13.R3). É também a base do RF30 (perguntas no painel).

**Testes:** RF20.CA01 a CA05, com comparação dos números da resposta com uma consulta independente ao banco; Gerente sem VER_FOLHA nunca vê folha; Lançador só vê os próprios lançamentos.

**Pronto quando:** cada papel recebe só o que a matriz permite, pelo `pnpm dev:chat`.

### E13: Automações da v1.1 (RF31, RF33, RF34, RF35) — G (v1.1)

**Etapa nova, só listada.** Depois do piloto. Cada requisito vira uma sub-etapa quando for priorizado:
- RF31 captura de NF-e por e-mail (endereço exclusivo, XML, chave de acesso, quarentena); depende do RF14 (itens por categoria) e de CNPJ cadastrado.
- RF33 lançamentos recorrentes (valor fixo lança sozinho; variável só aparece como "sem lançamento").
- RF34 resumo semanal e alertas por exceção (modelos aprovados pela Meta, consentimento e `parar`).
- RF35 importação de planilhas, extratos e relatórios de vendas, com desfazer em 30 dias.

Fora desta etapa, na **Fase 2**: RF32 (SEFAZ com certificado A1, só após validar P11) e RF36 (acesso do contador).

## 7. Qualidade transversal

Os requisitos transversais estão em `requisitos.md`; aqui só a relação com as etapas.

- **Segurança:** RNF01 (assinatura sempre validada sobre os bytes, segredos em tempo constante e só em variáveis de ambiente, auditoria de dependências).
- **LGPD:** RNF03 (retenção, minimização, portabilidade) e RF37 (encerramento). O texto jurídico vem do advogado.
- **Política da Meta:** RNF12. Ver `docs/politica-meta-whatsapp.md`.
- **Custo:** RNF08 (`ai_usage` desde a E6, custo por mensagem acompanhado, alerta acima do valor de referência).
- **Observabilidade mínima desde a E3:** RNF11 (log estruturado com `wa_message_id`, tenant e duração, nunca o conteúdo).

## 8. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Envio bloqueado pela Meta (130497, P2) | Sem confirmação real no WhatsApp | Interface de envio e modo log; resolver pagamento e verificação; ticket no suporte |
| App da Meta em modo desenvolvimento (P1) | Mensagens reais do celular não chegam ao webhook; só o botão Teste | Publicar o app; até lá, testar com POST assinado e fixtures |
| IA não chega a 90% de acerto | Piloto frustra | Evals desde cedo; roteamento para Sonnet; perguntas de volta; ajuste de prompt medido |
| Áudio OGG/Opus não aceito ou transcrição ruim | Fluxo de áudio travado | Teste com áudios reais na E9; conversão com ffmpeg; modelo alternativo |
| Mudança nos formatos da Meta (`user_id`, nomes de usuário) | Identificação quebra | Guardar `wa_id` e `wa_user_id`; fixtures novas a cada formato; tolerância a campos novos |
| Dado de um tenant vazar | Incidente grave | RLS, papel sem BYPASSRLS, meta-teste, teste de isolamento por tabela |
| Custo de IA acima do previsto | Margem do plano | Cache de prompt, Haiku por padrão, `ai_usage` com alerta |
| Drizzle v1 muda a API | Retrabalho | Ficar na 0.45, sem API relacional |

## 9. Ordem e marcos

```
E1 ─► E2 ─► E3 ─► E4 ─► E5 ─► E6 ─► E7 ─► E8 (contínuo)
                            │     └──────────► E9 ─► E10
                            └─► E11 (junto da E6, antes da E7)
                                         E10 ─► (piloto) ─► E12, E13 (v1.1)
```

- E11 precisa estar pronta antes de a E7 gravar lançamentos com unidade de acesso, sinais de revisão e permissões novas.
- E12 e E13 são da v1.1; os resumos predefinidos da E12 podem ser antecipados (P10).
- Pendências P01 a P11 não bloqueiam nenhuma etapa (DN-11).
- E1 e E2 não dependem de nada externo.
- E3 e E4 dependem só do túnel e do app da Meta, que já existem. O teste com mensagem real da E3 depende de P1 (app publicado) e não bloqueia a E4.
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
| M7 (fim da E11) | Matriz de permissões da seção 2.3 passa como teste e o vínculo aceita lista de unidades |
| M8 (fim da E12) | Cada papel recebe pelo WhatsApp só os relatórios que a hierarquia permite |

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
