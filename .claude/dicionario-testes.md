# Dicionário de testes

Lido pelo agente `verificador` antes de rodar qualquer coisa. Mapeia **assunto → pacote → comando**, para ele escolher o menor conjunto que cobre a mudança. Manter atualizado: a regra `.claude/rules/dicionario-testes.md` manda atualizar quando um assunto de teste novo aparece.

Comandos sempre a partir da raiz do repo. Nunca `npx`, `vitest` ou `tsc` avulsos.

## Comandos gerais

| O que | Comando | Observação |
|---|---|---|
| Lint + formatação (Biome) | `pnpm lint` | Repo inteiro, é rápido. Correção automática é `pnpm format` (só quando pedido). |
| Tipos de tudo | `pnpm typecheck` | Turbo, com cache. |
| Tipos de um pacote | `pnpm --filter @app/<pacote> typecheck` | |
| Unitários de tudo | `pnpm test` | Não inclui `*.int.test.ts`. |
| Unitários de um pacote | `pnpm --filter @app/<pacote> test` | |
| Um arquivo unitário | `pnpm --filter @app/<pacote> test <trecho-do-caminho>` | Ex.: `pnpm --filter @app/core test money`. |
| Integração de tudo | `pnpm test:int` | Precisa de Docker rodando (Testcontainers). Lento. |
| Integração de um pacote | `pnpm --filter @app/<pacote> test:int` | Só `@app/api` e `@app/db` têm. |
| Um arquivo de integração | `pnpm --filter @app/<pacote> test:int <trecho>` | Ex.: `pnpm --filter @app/db test:int isolation`. |
| Evals de IA | `pnpm --filter @app/ai eval` | **Ainda não existe** (nasce na E6). Se o script faltar, diga que não existe. |

## Assunto → onde está → o que rodar

### Domínio puro (`@app/core`, sem banco)

| Assunto | Arquivos | Comando |
|---|---|---|
| Dinheiro em centavos, `formatBRL` | `packages/core/src/money/money.test.ts` | `pnpm --filter @app/core test money` |
| Taxa/fee | `packages/core/src/money/fee.test.ts` | `pnpm --filter @app/core test fee` |
| Lançamento (`entry`) | `packages/core/src/entry/entry.test.ts` | `pnpm --filter @app/core test entry` |
| Schema de extração (Zod) | `packages/core/src/entry/extraction.test.ts` | `pnpm --filter @app/core test extraction` |
| Permissões e papéis | `packages/core/src/permissions/permissions.test.ts` | `pnpm --filter @app/core test permissions` |
| Telefone | `packages/core/src/phone/phone.test.ts` | `pnpm --filter @app/core test phone` |
| Conversa: comandos, roteamento, remetente | `packages/core/src/conversation/*.test.ts` | `pnpm --filter @app/core test conversation` |
| Erros de domínio tipados | `packages/core/src/errors/errors.test.ts` | `pnpm --filter @app/core test errors` |
| Core não importa infra | `packages/core/src/architecture.test.ts` | `pnpm --filter @app/core test architecture` |

### Banco (`@app/db`)

| Assunto | Arquivos | Comando |
|---|---|---|
| Schema, cliente, UUID v7, categorias de sistema (unitário) | `packages/db/src/*.test.ts` | `pnpm --filter @app/db test` |
| **Isolamento RLS por tenant** (obrigatório em tabela nova) | `packages/db/test/isolation.int.test.ts` | `pnpm --filter @app/db test:int isolation` |
| Integridade (constraints, FKs) | `packages/db/test/integrity.int.test.ts` | `pnpm --filter @app/db test:int integrity` |
| Ingestão de mensagem bruta | `packages/db/test/inbound-ingest.int.test.ts` | `pnpm --filter @app/db test:int inbound-ingest` |
| Processamento de mensagem (idempotência) | `packages/db/test/inbound-processing.int.test.ts` | `pnpm --filter @app/db test:int inbound-processing` |
| Conversa (estado/roteamento no banco) | `packages/db/test/conversation.int.test.ts` | `pnpm --filter @app/db test:int conversation` |
| Seed de desenvolvimento | `packages/db/test/dev-seed.int.test.ts` | `pnpm --filter @app/db test:int dev-seed` |

### API, webhook e workers (`@app/api`)

| Assunto | Arquivos | Comando |
|---|---|---|
| App Fastify | `apps/api/src/app.test.ts` | `pnpm --filter @app/api test app` |
| Webhook do WhatsApp (unitário) | `apps/api/src/http/webhooks/whatsapp.test.ts` | `pnpm --filter @app/api test webhooks` |
| `process-inbound` e `route-inbound` (unitário) | `apps/api/src/modules/inbound/*.test.ts` | `pnpm --filter @app/api test inbound` |
| Chat de desenvolvimento e sender fake | `apps/api/src/dev/chat-session.test.ts`, `apps/api/src/infra/dev-message-sender.test.ts` | `pnpm --filter @app/api test dev` |
| Webhook ponta a ponta (assinatura, 200 rápido, fila) | `apps/api/test/whatsapp-webhook.int.test.ts` | `pnpm --filter @app/api test:int whatsapp-webhook` |
| Worker pg-boss (retry, DLQ) | `apps/api/test/process-inbound-worker.int.test.ts` | `pnpm --filter @app/api test:int process-inbound-worker` |
| Roteamento de mensagem com banco | `apps/api/test/route-inbound.int.test.ts` | `pnpm --filter @app/api test:int route-inbound` |

### WhatsApp, config, IA, web

| Assunto | Arquivos | Comando |
|---|---|---|
| Parsing de webhook, assinatura, verificação, simulador | `packages/whatsapp/src/*.test.ts` | `pnpm --filter @app/whatsapp test` |
| Variáveis de ambiente (Zod) | `packages/config/src/env.test.ts` | `pnpm --filter @app/config test` |
| IA (prompts, extração) | `packages/ai` (sem testes ainda) | `pnpm --filter @app/ai test`; evals só a partir da E6 |
| Painel | `apps/web` (sem testes ainda; `--passWithNoTests`) | `pnpm --filter @app/web test` e `typecheck` |

## Qual conjunto rodar, por tipo de mudança

| Mudou | Rode |
|---|---|
| `packages/core/**` | `@app/core test` + `pnpm typecheck` + `pnpm lint` |
| `packages/db/src/schema/**` ou migration | `@app/db test` + `@app/db test:int` (isolation e integrity no mínimo) + `pnpm typecheck` |
| `packages/whatsapp/**` | `@app/whatsapp test` + `@app/api test:int whatsapp-webhook` |
| `apps/api/src/**` | `@app/api test` + `typecheck`; `test:int` do arquivo afetado se tocar fila, webhook ou banco |
| `packages/ai/**` (prompt ou schema de extração) | `@app/ai test` + `@app/ai eval` (quando existir) + `@app/core test extraction` |
| `apps/web/**` | `@app/web typecheck` + `@app/web test` (+ `pnpm --filter @app/web build` se mudou rota/config) |
| Só docs/regras do Claude | nada |
| Mudança ampla ou fechamento de etapa | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int` |

## Armadilhas conhecidas

- Integração precisa do Docker ligado. Se falhar com erro de conexão ao Docker/Testcontainers, reporte como **ambiente**, não como falha de código.
- Insert direto por SQL em teste precisa de `id` gerado com `uuidv7()` de `@app/db`; sem isso: `null value in column "id"`.
- `pnpm test` não roda `*.int.test.ts`; passar no unitário não prova isolamento nem fila.
