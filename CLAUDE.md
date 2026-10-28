# CLAUDE.md

Guia para o Claude Code trabalhar neste repositório. Leia antes de qualquer tarefa.
Contexto completo do produto em `docs/planejamento.md`, arquitetura em `docs/arquitetura.md`, escopo da v1 em `docs/mvp.md`.
Planos de desenvolvimento por módulo: `docs/plano-dev-canal-whatsapp.md` (etapas E1 a E10) e `docs/plano-dev-frontend.md` (etapas F0 a F8). Cada plano tem uma tabela de progresso no topo: "próxima etapa" é a primeira com status "A fazer". Atualize a tabela ao concluir uma etapa e siga o "Fechamento de etapa" do plano, que inclui propor (sem criar) regras, skills, hooks e `CLAUDE.md` de módulo para o que repetiu na etapa.

## O produto em uma frase

Controle financeiro **gerencial** para restaurantes pequenos e médios, alimentado por **WhatsApp** (texto, áudio e foto de nota). A IA interpreta a mensagem, registra receitas e despesas e devolve uma confirmação clara. Um painel web mostra gráficos, permite editar lançamentos e exportar para Excel.

Não é sistema fiscal: não emite nota, não apura imposto. Somos aliados do contador.

## Stack

| Camada | Escolha |
|---|---|
| Linguagem | TypeScript em tudo (strict) |
| Monorepo | pnpm workspaces + Turborepo |
| API / webhook / workers | Node 24 LTS + Fastify + Zod |
| Fila de jobs | pg-boss (usa o próprio Postgres, sem Redis) |
| Banco | PostgreSQL 16+, com Row Level Security por tenant |
| ORM | Drizzle ORM + drizzle-kit (migrations em SQL versionadas) |
| Web | Next.js (App Router), Tailwind, shadcn/ui, Recharts; responsivo/PWA |
| Auth | Better Auth, login por código (OTP) via WhatsApp ou e-mail |
| Arquivos | Armazenamento compatível com S3 (áudios, fotos, exportações) |
| IA | Claude (Haiku para extração, Sonnet para casos difíceis e relatórios) via saída estruturada (`output_config.format`) na extração, tool use só para consultas e relatórios; transcrição com gpt-4o-transcribe |
| Testes | Vitest (unitário/integração), Testcontainers para Postgres, Playwright (e2e web, depois) |
| Lint/format | Biome |
| Observabilidade | pino (logs estruturados) + Sentry |

App nativo (Expo/React Native) **não** está no MVP: o lançamento diário é pelo WhatsApp e o painel é PWA.

## Estrutura

```
apps/
  api/        Fastify: webhook do WhatsApp, API do painel, workers (pg-boss)
  web/        Next.js: painel (lançamentos, gráficos, configurações)
packages/
  db/         schema Drizzle, migrations, seeds, helpers de RLS
  core/       domínio puro: dinheiro, categorias, regras de lançamento, permissões
  ai/         prompts, schemas de extração, clientes de LLM e transcrição, evals
  whatsapp/   cliente da Cloud API da Meta, parsing de webhooks, templates
  config/     tsconfig, biome e env compartilhados
docs/
```

`packages/core` não importa nada de infra (sem banco, sem HTTP). Regras de negócio moram lá e são testadas sem mocks.

## Regras inegociáveis

1. **Dinheiro é inteiro em centavos** (`bigint` no banco, `number` seguro ou `bigint` no TS). Nunca `float`. Formatação só na borda (`formatBRL`).
2. **Toda tabela de dados de cliente tem `tenant_id`** e política de RLS. Toda query do app roda com `SET LOCAL app.tenant_id` dentro de transação. Teste de isolamento obrigatório para tabelas novas.
3. **A IA nunca faz contas nem inventa números.** Ela extrai dados para um schema Zod; o sistema valida, calcula e grava. Relatórios em linguagem natural: a IA escolhe consultas/ferramentas pré-definidas e parametrizadas; o banco calcula.
4. **Nada é apagado de verdade.** Lançamentos usam soft delete (`deleted_at`) e toda alteração gera registro em `entry_versions` (quem, quando, antes/depois, canal).
5. **Todo lançamento guarda a origem**: `inbound_message_id` com o texto, a transcrição ou a mídia original.
6. **Webhook responde 200 em menos de 1 s.** Valida assinatura, grava a mensagem bruta, enfileira job, responde. Processamento é sempre assíncrono e idempotente (chave: `wa_message_id`).
7. **Salvar direto, confirmar sempre.** Cada lançamento gera resposta curta no WhatsApp com o que foi registrado e como corrigir. Na dúvida sobre informação essencial, a IA pergunta antes.
8. **Custos de IA são medidos** por tenant em `ai_usage` (tokens, minutos de áudio, custo estimado).
9. **Segredos só em variáveis de ambiente**, validadas com Zod na inicialização (`packages/config/env`). Nunca logar conteúdo de mensagens, CPFs ou valores de salário em logs.

## Convenções

- Código, nomes de tabelas e identificadores em **inglês**; textos para o usuário em **português do Brasil**.
- Glossário: lançamento = `entry`; despesa = `expense`; receita = `revenue`; unidade/restaurante = `unit`; conta/empresa cliente = `tenant`; fornecedor = `supplier`; forma de pagamento = `payment_method`; canal de venda = `sales_channel`; categoria = `category`.
- Datas de negócio em `date` (sem hora), fuso padrão `America/Sao_Paulo`. Timestamps em `timestamptz`.
- IDs: UUID v7.
- Validação de entrada com Zod em toda fronteira (HTTP, webhook, saída do LLM, jobs).
- Erros de domínio tipados (`Result`/erros nomeados), não strings soltas.
- Commits no padrão Conventional Commits.

## Como trabalhar aqui

- Antes de mudar schema: editar `packages/db/schema`, gerar migration com drizzle-kit, revisar o SQL gerado, incluir política RLS.
- Mudou prompt ou schema de extração em `packages/ai`: rodar os evals (`pnpm --filter @app/ai eval`) e não deixar a taxa de acerto cair.
- Toda regra nova em `packages/core` vem com teste.
- Testar o canal e a IA sem WhatsApp: `pnpm dev:chat` (chat de terminal, só para desenvolvimento, criado na E5; ver seção 3.6 de `docs/plano-dev-canal-whatsapp.md`). O WhatsApp real só é ligado no fim, na E10 (`CHANNEL_MODE=whatsapp`).
- Prefira mudanças pequenas e verificáveis. Rode `pnpm typecheck && pnpm lint && pnpm test` antes de concluir.

## Comandos

```
pnpm install
pnpm dev            # sobe api e web
pnpm db:generate    # gera migration a partir do schema
pnpm db:migrate     # aplica migrations
pnpm db:seed        # categorias padrão e dados de exemplo
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @app/ai eval
pnpm dev:chat       # (a criar na E5) chat de terminal que simula o WhatsApp, só para teste
```

## Estado atual

Fase 0 (fundação) quase pronta: monorepo, TypeScript strict, Biome, Vitest e validação de env funcionam; a API sobe com `/health`. O Postgres do Docker Compose sobe com o papel `app` sem BYPASSRLS. Falta rodar o CI no GitHub. Próximo passo: E1 do canal WhatsApp (`packages/core`) e F0 do painel, seguindo os planos em `docs/`.
