# Plano de desenvolvimento: canal WhatsApp (mensagem → lançamento)

> **Papel deste documento:** **ordem de execução** do canal WhatsApp. Cada etapa lista os requisitos (RFs) que entrega e **não** copia regra de negócio: a regra está em [`requisitos.md`](../requisitos.md) (cite `RFnn.Rn`), o porquê das decisões em [`decisoes.md`](../decisoes.md) e a técnica em [`arquitetura.md`](../arquitetura.md). Em conflito, vale `requisitos.md`.

Atualizado em 04/11/2026 (E1 a E9 feitas e resumidas na seção 6.1; alinhado ao Documento de Requisitos v1.0). Cobre as fases 1, 2 e 3 do `docs/escopo-por-fase.md` e a parte de canal/operação da fase 5. O painel web tem plano próprio em `docs/planos/painel.md`.

**Pendências P01 a P11 (Matheus) não bloqueiam nenhuma etapa.** Onde um requisito traz `[PROVISÓRIO – Pxx]`, a implementação isola o valor em configuração ou constante única, para trocar depois sem retrabalho (ver DN-11 em `decisoes.md`). A única pendência que já bloqueava, e continua, é a da Meta (P15), só para o teste real e a E10.

Legenda de confiança, usada em todo o documento:

- ✅ conferido na documentação oficial em 27/10/2026
- ⚠️ vem de fonte secundária, do que já observamos na prática, ou não foi confirmado: **verificar antes de depender**
- 🧭 decisão nossa (recomendação), sujeita ao seu OK

## Como retomar este plano (leia primeiro)

**Nome do módulo:** "canal WhatsApp" é o caminho completo da mensagem até o lançamento gravado: recebimento (webhook), fila, identificação, **IA** (um passo do caminho), gravação e confirmação. Não é só "a API" (`apps/api` também serve o painel) nem só "a IA" (`packages/ai` é uma parte pequena do plano). Vive em `apps/api`, `packages/whatsapp`, `packages/ai`, `packages/core` e `packages/db`.

**Para continuar em uma sessão nova:** leia `CLAUDE.md`, depois este arquivo, e execute a **primeira etapa com status "A fazer"** na tabela abaixo. Planeje a etapa com o Superpowers (`brainstorming` ou `grilling`, depois `writing-plans`), conforme o DD-18. Ao terminar uma etapa, atualize a tabela e o campo "Atualizado em".

| Etapa | Status | Observação |
|---|---|---|
| E1 Núcleo de domínio (`core`) | Feita (27/10/2026) | Arredondamento half-up, papéis owner/manager/staff, sensível = folha. Pendente: confirmar tolerância de 1 centavo e campos "essenciais" (D6); fast-check não adotado |
| E2 Banco e multi-tenancy (`db`) | Feita (27/10/2026) | Schema (14 tabelas), 2 migrations, `withTenant`, papel `app_ingest`, seed; 84 testes de integração (`pnpm test:int`) e 20 unitários passam. Rodar `init.sql` em bancos locais antigos para criar o `app_ingest`. Lista de categorias é provisória por decisão sua; ajustar depois com o Matheus |
| E3 Gateway do WhatsApp (webhook) | Feita (28/10/2026) **com ressalva**: falta só o teste com mensagem real do celular, bloqueado por pendência da Meta (P1, ver "Pendências da Meta") | GET/POST `/webhooks/whatsapp`, assinatura sobre bytes brutos, tabela `whatsapp_status_events` (migration 0002), fila `process-inbound` no pg-boss (política `exclusive`, só enfileira; worker é a E4). 95 testes de integração no db e 12 na api passam. Fixtures são sintéticas: trocar/acrescentar as reais anonimizadas. Verificado em 28/10 pelo túnel: handshake, POST assinado, reenvio sem duplicar, assinatura inválida (401) e o botão **Teste** do painel da Meta (status gravado). Pendente: mensagem real do celular (P1) e conferir `redact`/logs do Pino |
| E4 Fila e workers | Feita (28/10/2026) | `worker.ts` separado, fila `process-inbound` com 5 retentativas (backoff 10 s a 160 s) e DLQ `process-inbound-dlq`, caso de uso `ProcessInbound` com transições guardadas e porta de roteamento (no-op até a E5), shutdown limpo. 9 testes de integração do worker, 6 do repo no db e 9 unitários passam. Handler ainda não roteia nada (E5). Pendente: confirmar os números de retry com você e rodar o worker contra o Postgres do Compose |
| E5 Identificação e roteamento | Feita (28/10/2026) | `resolveSender` e `decideRoute` puros no `core`; roteador no worker (desconhecido, ajuda e desfazer provisório, tipo não suportado, reply, pergunta pendente, extração); migration 0003 (`outbound_messages`, `whatsapp_opt_ins`, `memberships.deactivated_at`); **`pnpm dev:chat`** e `pnpm db:seed:dev`. 159 unitários no core, 101 na api e 132+34 de integração passam; testado de verdade no terminal contra o Postgres do Compose. Os ramos de correção, pergunta pendente e extração só chamam handlers que não respondem nada (E6 e E7). Pendente: revisar os textos com o Matheus, `SUPPORT_CONTACT` real, revogação de opt-in (E10) |
| E6 Extração por IA (texto) | Feita (30/10/2026) | `ExtractionResult` com `missing_fields` por lançamento; `ClaudeEntryExtractor` (Haiku 5.5, saída estruturada, `effort` baixo, cache de prompt confirmado ao vivo, Sonnet 5.5 por sinais objetivos); `interpretExtraction` e `buildDrafts` puros no `core`; `ai_usage` por chamada com `pricing.ts` versionado; `pnpm --filter @app/ai extract`. Custo medido: cerca de US$ 0,0004 por mensagem. Pendente: lista de quantidade essencial (P04) e preço do cache do Haiku 5.5 a conferir |
| E7 Fluxo de lançamento e confirmação | Feita (30/10/2026) | Migration 0004 (`flags`, `status` da pergunta, cache em `ai_usage`, `restore`, envio único por origem); `EntryStore`; handlers de extração, resposta à pergunta, correção por reply, `desfazer` (24 h ou por reply), `cancelar`, `suporte`; aviso de falha definitiva; chat com `/reply` e `/custo`. 80 testes de integração da API cobrem o fluxo. `trocar unidade`, `trocar empresa` e empresa citada no texto vieram na E11 (DE-25); textos a revisar (P08) |
| E8 Evals e qualidade da IA | Feita (30/10/2026) | 39 casos inventados em JSONL, runner por campo e por lançamento, precisão e revocação da pergunta, custo e latência, baseline em `baseline.json` (100% nos casos atuais), `pnpm --filter @app/ai eval` com trava de orçamento. Rodada completa: cerca de US$ 0,015. Pendente: casos reais anonimizados do Matheus (o 100% é otimista: os casos são meus e o prompt foi ajustado olhando para eles) e rodar o eval no CI (precisa do segredo) |
| E9 Áudio e foto | Feita (30/10/2026) **com ressalva**: áudio e foto só foram testados com fakes; falta teste com áudio e foto reais | Download da Meta (2 passos, conferido na doc), conversão com ffmpeg, transcrição `gpt-transcribe` por `fetch`, limite de 180 s, QR da NFC-e, chave única por empresa (`fiscal_documents`, migration 0005), itens agrupados por categoria, limites de uso (RF21), lida/digitando, chat com `/audio` e `/foto`. Pendente: S3 e retenção de 90 dias (E10), consulta à SEFAZ, preço do `gpt-transcribe`, ffmpeg no servidor |
| E10 Envio real e operação | Bloqueada (Meta, P15) | **É aqui que o WhatsApp real é ligado, no fim do desenvolvimento.** Bloqueada pela Meta (P1 e P2) |
| E11 Modelo de dados dos requisitos (papéis, unidades de acesso, campos) | Quase feita (09/11/2026): dados, domínio, `trocar unidade`, `trocar empresa` e empresa citada no texto prontos (DE-25); faltam rodar os evals (7.3) e o ajuste do contador criado só por e-mail (celular opcional, DD-20, na F1a) | **Próxima etapa.** Fecha as divergências de `arquitetura.md` que o `core` e o `db` ainda têm, e destrava `trocar unidade`, `trocar empresa` e empresa citada no texto (DE-17). **Acrescenta (DD-02, DD-03, DD-04, DD-08, DD-13):** papel `accountant` já com folha; `paid_on` e `orders` em `entries`; canal padrão por unidade e sinal `CANAL_A_REVISAR`; tabela de regras de imposto por vigência. Ajustes de prompt (E6): canal padrão, pedidos, data de pagamento e pergunta acima de R$ 1.500 (DD-09) |
| E12 Resumos e relatórios pelo WhatsApp (RF20) | A fazer (**resumos fixos no MVP**, consultas livres na v1.1) | Resumos de hoje, semana e mês entram no MVP (DD-12, fecha P10) |
| E13 Automações da v1.1 (RF33, RF34) | A fazer (v1.1) | Recorrentes, resumo semanal e alertas; só depois do piloto. RF31 e RF35 saíram daqui para a E14 |
| E14 Importações e XML de NF-e (RF35, RF31 manual) | A fazer (**MVP**; nova, 05/11/2026) | Importação de planilha e OFX; XML pelo painel (F13) e pelo WhatsApp como documento; tolerância zero (DD-10, DD-14). P18 aberta |

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
| E12 | RF20 (resumos fixos no MVP) | n/a |
| E13 | RF33, RF34 (v1.1); RF32 (Fase 2) só listado | n/a |
| E14 | RF35, RF31 (envio manual de XML) | Nova (DD-10) |

**Fechamento de etapa (sempre, antes de marcar "Feita"):**
1. Rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que a etapa cumpre o "Pronto quando".
2. Atualizar a tabela de progresso e o campo "Atualizado em".
3. **Revisar o contexto do Claude.** Responder: o que repetiu ou deu errado nesta etapa e vale virar regra (`.claude/rules`), skill, hook, `CLAUDE.md` do módulo ou subagente? Usar o critério: erro repetido duas vezes vira regra ou `CLAUDE.md`; procedimento colado pela terceira vez vira skill; o que precisa acontecer sempre vira hook. **Propor e esperar aprovação; não criar sozinho.** Ver os candidatos previstos por etapa em [`pesquisa-claude-code.md`](pesquisa-claude-code.md), seção 12 (arquivo local, fora do git).
4. Sugerir a mensagem de commit em Conventional Commits. Não commitar sem pedido.

**Decisões:** D1 a D7 e as decisões das etapas estão em [`decisoes.md`](../decisoes.md) (seções 1 e 3). Este plano cita o ID em vez de repetir a explicação.

**Estado do repositório:** fase 0 pronta (falta só rodar o CI no GitHub, que agora também tem os jobs `integration` e `e2e`) e E1 a E9 feitas. Pendências abertas das etapas feitas: [`andamento.md`](andamento.md), seção 5.

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

**Para repetir o teste real da E3 quando P1 for resolvido:** `guia-testes-manuais.md`, seção 10. Mandar "Teste" do celular; deve entrar 1 linha em `inbound_messages` com o seu `wa_id` e 1 job em `pgboss.job`.

**Se a Meta não liberar:** planos B, C e D e os gatilhos em [`contingencia-canal.md`](contingencia-canal.md).

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
1. P1: publicar o app da Meta e repetir o teste real da E3 (`guia-testes-manuais.md`, seção 10).
2. P2: resolver o erro 130497 (pagamento, perfil, verificação da empresa com CNPJ).
3. Número definitivo e nome de exibição.
4. `CHANNEL_MODE=whatsapp`: entram `CloudMessageSender` e `MetaMediaDownloader` no lugar dos `Dev*` (só a composição em `apps/api` muda; o `core` e a IA não sabem a diferença).
5. Rodar o mesmo roteiro do chat de dev, agora pelo celular, em staging.

## 4. Decisões

A explicação de cada decisão (motivo, onde vale e situação) está em [`decisoes.md`](../decisoes.md). Aqui fica só o índice, para os trechos deste plano que citam o ID.

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
2. `integration`: sobe Postgres via Testcontainers (o runner `ubuntu-latest` tem Docker) e roda `*.int.test.ts`. **Criado em 06/11/2026** (F0 do painel); ainda não rodou no GitHub. Os jobs `evals` e `migrations` abaixo continuam por fazer.
3. `evals`: só quando `packages/ai/**` muda; falha se a taxa de acerto cair abaixo do baseline menos a tolerância.
4. `migrations`: gera migration a partir do schema e falha se houver diferença não commitada.

### 5.4 Regras de arquitetura verificadas automaticamente

Teste simples que lê os `package.json` e falha se `@app/core` listar dependência de infra (`pg`, `fastify`, `drizzle-orm`, SDKs). Biome pode restringir imports por pasta. ⚠️ Conferir a regra exata do Biome 2 ao implementar.

## 6. Etapas

Cada etapa termina com algo testável. Os tamanhos são relativos (P, M, G), não prazos.

### 6.1 Etapas feitas (E1 a E9)

O planejamento detalhado dessas etapas (entregas previstas, testes, "pronto quando") foi cumprido e saiu deste arquivo em 04/11/2026; está no histórico do git. Fica aqui o que foi entregue. As decisões tomadas estão em [`decisoes.md`](../decisoes.md) (DE-01 a DE-21), as **pendências abertas** em [`andamento.md`](andamento.md), seção 5, e o roteiro de teste à mão em [`guia-testes-manuais.md`](guia-testes-manuais.md).

| Etapa | O que entregou | Decisões |
|---|---|---|
| **E1** Núcleo (`core`) | `Money` em centavos, `formatBRL`, taxa e líquido com arredondamento meio-para-cima, `Entry` com versão e soft delete, papéis `owner`/`manager`/`staff` e `can()`, categoria sensível (folha), telefone com e sem o 9º dígito, `Result` e erros nomeados | DE-01 |
| **E2** Banco (`db`) | 14 tabelas, RLS com `FORCE`, `withTenant`, papéis `app` (sem BYPASSRLS), `app_ingest` e admin, meta-teste de RLS por tabela, seed de categorias provisórias | D2, DE-02 |
| **E3** Webhook | `GET/POST /webhooks/whatsapp`, assinatura sobre os bytes brutos, `bodyLimit` acima de 3 MB, gravação idempotente por `wa_message_id`, `whatsapp_status_events` (0002), fila `process-inbound`. **Ressalva:** sem mensagem real do celular (P15) | D3, DE-03 a DE-05 |
| **E4** Fila | `worker.ts` separado, 5 retentativas com backoff, DLQ de 14 dias, lote de 5, transições de estado guardadas, desligamento limpo, `pino` com `redact` | DE-06 |
| **E5** Identificação | `resolveSender` e `decideRoute` puros no `core`, roteador no worker, `outbound_messages`, `whatsapp_opt_ins` e `memberships.deactivated_at` (0003), `messages.ts` com os textos, `pnpm dev:chat` e `pnpm db:seed:dev` | D7, DE-07 a DE-13 |
| **E6** Extração por IA | `ClaudeEntryExtractor` (Haiku 5.5, saída estruturada, `effort` baixo, cache de prompt, Sonnet 5.5 por sinais objetivos), `interpretExtraction` e `buildDrafts` no `core`, `ai_usage` com `pricing.ts`, `pnpm --filter @app/ai extract` | D1, D5, D6, DE-14, DE-15 |
| **E7** Lançamento | `EntryStore`, confirmação enviada uma vez por origem, pergunta de volta (uma aberta por colaborador, 24 h), correção por reply (`CorrectionExtractor`), `desfazer`, `cancelar`, `suporte`, aviso de falha definitiva, taxa só em receita (0004) | DE-16 a DE-19 |
| **E8** Evals | 39 casos em JSONL, métricas por campo e por lançamento, precisão e revocação da pergunta, custo e latência, `baseline.json`, trava de orçamento | — |
| **E9** Áudio e foto | Download da Meta em 2 passos, ffmpeg para MP3, `gpt-transcribe`, limite de 180 s, QR da NFC-e com chave única por empresa (`fiscal_documents`, 0005), itens agrupados por categoria, limites de uso (RF21), lida e digitando. **Ressalva:** só testado com simulação | DE-20, DE-21 |

**Ajustes que os requisitos v1.0 (29/10/2026) pediram nas etapas feitas** e que ainda não foram feitos estão todos na E11 (papéis, permissões adicionais, unidades de acesso, campos) e na E10 (`parar`, `voltar`, cotas, janela de 24 h).

**Contexto do Claude criado nas etapas:** `.claude/rules/pg-boss.md`, `testes.md`, `tabela-nova.md`, skill `novo-worker-pgboss`, subagentes `explorador`, `buscador-requisitos` e `verificador`, `CLAUDE.md` do chat de desenvolvimento. Propostas da E3 ainda não aprovadas: regra `webhook.md`, skill `novo-fixture-whatsapp`, subagente `revisor-seguranca`, hook que bloqueia editar migration já commitada.

### 6.2 Etapas a fazer

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

**Etapa nova (29/10/2026).** Fecha, no `core` e no `db`, as divergências listadas em `arquitetura.md` ("Divergências entre o modelo de dados atual e os requisitos") que o canal precisa para cumprir as regras. É a próxima etapa do canal (a E10 está bloqueada pela Meta); as partes de tela ficam em F2 e F6 do plano do painel.

**Entrega os requisitos:**
- RF06 e RF05.R7: quarto papel `accountant` reservado, permissões adicionais (VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL, CONSULTAR_RELATORIOS_WHATSAPP) em `memberships.permissions`, categoria sensível visível para quem tem VER_FOLHA, e a **matriz da seção 2.3 como teste** (RF06.CA06).
- RF05.R5, R6 e R8 (pendência P13): lista de unidades de acesso por colaborador (tabela de vínculo, mantendo "TODAS"), unidade padrão dentro da lista, situação CONVIDADO, ATIVO ou DESATIVADO.
- RF04: apelidos, CNPJ, município, UF e status da unidade.
- RF07, RF08, RF09: campos de apoio da IA (Exige Quantidade, palavras de apoio, apelidos), status, tipo da forma de pagamento e do canal, forma de cartão padrão da empresa.
- RF12.R12 e R13, RF24: sinais de revisão, motivo da exclusão, canal de origem EMAIL e ação de restauração em `entry_versions`.

**Acrescentado em 05/11/2026 (DD-02, DD-03, DD-04, DD-08, DD-13, DD-14):**
- `accountant` deixa de ser reservado: entra no `core` e no `db`, vê folha e nunca cria, edita nem exclui; registro do aviso e aceite do dono na auditoria (RF36.CA03 e CA04).
- `entries.paid_on` (padrão = `occurred_on`) e `entries.orders` (opcional); receita com canal obrigatório; `units.default_sales_channel_id`; sinal `CANAL_A_REVISAR` (RF12.R21 a R23, CA11 a CA14; RF04.R6).
- `tax_settings` (por empresa, com RLS) e `tax_rules` (global, versionada por vigência, só leitura para o app) com os testes de `packages/core` por regime (RF39). Valores e fórmulas só depois de P16 e P17; até lá, a estrutura e regras de exemplo apenas em teste.
- Ajuste de prompt e schema de extração (E6): data de pagamento, pedidos, canal padrão e pergunta acima de R$ 1.500; rodar `pnpm --filter @app/ai eval` e incluir os casos CA11 a CA14.

**Testes:** matriz de permissões (papel × ação); isolamento da tabela de vínculo (regra `tabela-nova.md`); migração dos vínculos existentes (`unit_id` único ou nulo) para a nova lista sem perder acesso.

**Situação em 09/11/2026:** feito tudo, inclusive `trocar unidade`, `trocar empresa` e a empresa citada no texto (DE-25; desenho em `docs/superpowers/specs/2026-11-09-e11-trocar-unidade-empresa-design.md`). Falta rodar os evals (7.3): a chave Anthropic já foi corrigida, mas a rodada com os casos novos de `unit_hint` (n01 a n04) ainda não aconteceu e o baseline não foi atualizado. Detalhes em `andamento.md` (seção 5).

**Pronto quando:** a matriz da seção 2.3 passa como teste no `core` e a migration roda em banco com dados do seed de desenvolvimento. Valores `[PROVISÓRIO – Pxx]` (P01, P02, P05, P06, P07) ficam em seed e constantes únicas.

### E12: Resumos e relatórios pelo WhatsApp por hierarquia (RF20) — M (resumos no MVP; consultas livres na v1.1)

**Etapa nova.** Os resumos fixos ("resumo de hoje", "da semana", "do mês") entram no **MVP** (DD-12, P10 fechada), sem a interpretação livre. As demais consultas ficam na v1.1.

**Entrega os requisitos:** RF20 (consultas RESUMO, POR_CATEGORIA, POR_FORNECEDOR, POR_FORMA_PAGAMENTO, POR_CANAL, EVOLUCAO, PRECO_INSUMO e MEUS_LANCAMENTOS; permissões por papel, RF20.R4 a R7; período e unidades padrão; resposta de até 12 linhas), RF21.R3 (cota mensal de consultas), RF06.CA01, CA03 e CA05. A IA só escolhe a consulta e os parâmetros; o banco calcula (RNF13.R3). É também a base do RF30 (perguntas no painel).

**Testes:** RF20.CA01 a CA05, com comparação dos números da resposta com uma consulta independente ao banco; Gerente sem VER_FOLHA nunca vê folha; Lançador só vê os próprios lançamentos.

**Pronto quando:** cada papel recebe só o que a matriz permite, pelo `pnpm dev:chat`.

### E13: Automações da v1.1 (RF33, RF34) — G (v1.1)

**Etapa nova, só listada.** Depois do piloto. RF31 (agora envio manual de XML) e RF35 saíram para a **E14**, no MVP. Cada requisito vira uma sub-etapa quando for priorizado:
- RF33 lançamentos recorrentes (valor fixo lança sozinho; variável só aparece como "sem lançamento").
- RF34 resumo semanal e alertas por exceção (modelos aprovados pela Meta, consentimento e `parar`).

Fora desta etapa, na **Fase 2**: RF32 (SEFAZ com certificado A1, só após validar P11). O acesso do contador (RF36) foi antecipado para o MVP (E11 e F13).

### E14: Importações e XML de NF-e (RF35, RF31 manual) — M/G (MVP; nova em 05/11/2026)

**Entrega os requisitos:**
- RF35: importação de planilha, extrato OFX e relatório de vendas (PDV, iFood), com pré-visualização, desfazer em 30 dias, deduplicação e **tolerância zero** na conciliação de centavos (DD-14). Relatórios de vendas alimentam `entries.orders` (ticket médio, DD-13).
- RF31 reformulado (DD-10): XML da NF-e enviado manualmente pelo WhatsApp (tipo de mídia "documento" no webhook e na fila) e pelo painel (F13). Leitura determinística, sem IA para os valores; chave de acesso única por empresa (`fiscal_documents`); sem e-mail por empresa nem quarentena. Regras finais: P18.

**Testes:** arquivos de exemplo reais anonimizados (planilha, OFX, XML); reimportar o mesmo arquivo não duplica; diferença de 1 centavo marca revisão; isolamento das tabelas novas (`tabela-nova.md`); o desfazer restaura o estado anterior.

**Pronto quando:** um OFX, uma planilha e um XML entram no `pnpm dev:chat` ou na API e viram lançamentos revisáveis, sem duplicar.

## 7. Qualidade transversal

Os requisitos transversais estão em `requisitos.md`; aqui só a relação com as etapas.

- **Segurança:** RNF01 (assinatura sempre validada sobre os bytes, segredos em tempo constante e só em variáveis de ambiente, auditoria de dependências).
- **LGPD:** RNF03 (retenção, minimização, portabilidade) e RF37 (encerramento). O texto jurídico vem do advogado.
- **Política da Meta:** RNF12. Ver [`politica-meta-whatsapp.md`](../politica-meta-whatsapp.md).
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
                            └─► E11 (próxima; a E7 foi feita antes, ver DE-17)
                                         E10 ─► (piloto) ─► E12, E13 (v1.1)
```

- A E7 foi feita antes da E11: o que dependia das unidades de acesso (`trocar unidade`, `trocar empresa`, empresa citada no texto) ficou para a E11 (DE-17). Ao fazer a E11, revisar o fluxo de lançamento para usar a lista de unidades, os sinais de revisão e as permissões novas.
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
