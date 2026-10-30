# CLAUDE.md

Guia para o Claude Code trabalhar neste repositório. Leia antes de qualquer tarefa.
As regras de negócio estão em `docs/requisitos.md` (veja "Onde está cada coisa" abaixo). Visão de produto e negócio em `docs/planejamento.md`, arquitetura em `docs/arquitetura.md`, escopo por fase em `docs/mvp.md`.
Planos de desenvolvimento por módulo: `docs/plano-dev-canal-whatsapp.md` (etapas E1 a E13) e `docs/plano-dev-frontend.md` (etapas F0 a F10). Cada plano tem uma tabela de progresso no topo: "próxima etapa" é a primeira com status "A fazer". Atualize a tabela ao concluir uma etapa e siga o "Fechamento de etapa" do plano, que inclui propor (sem criar) regras, skills, hooks e `CLAUDE.md` de módulo para o que repetiu na etapa.

## O produto em uma frase

Controle financeiro **gerencial** para restaurantes pequenos e médios, alimentado por **WhatsApp** (texto, áudio e foto de nota). A IA interpreta a mensagem, registra receitas e despesas e devolve uma confirmação clara. Um painel web mostra gráficos, permite editar lançamentos e exportar para Excel.

Não é sistema fiscal: não emite nota, não apura imposto. Somos aliados do contador.

## Onde está cada coisa

Hierarquia da documentação, da mais forte para a mais fraca:

| Documento | Papel |
|---|---|
| `docs/requisitos.md` | **O quê** e as regras de negócio (38 RFs, 14 RNFs, matriz de permissões, pendências). Fonte da verdade. |
| `docs/decisoes.md` | **Por quê**: registro de decisões (D1 a D7, D-F1 a D-F7, DE-xx das etapas, DN-xx de 29/10/2026). |
| `docs/arquitetura.md` | **Como**: stack, fluxo, modelo de dados e divergências do modelo atual em relação aos requisitos. |
| `docs/planejamento.md` | Visão de produto e de negócio: problema, público, custos, validação, riscos. |
| `docs/mvp.md` | Escopo por fase, por RF (MVP, v1.1, Fase 2). |
| `docs/plano-dev-*.md`, `plano-luis.md`, `subplano-sem-cnpj.md` | Ordem de execução. Listam os RFs que cada etapa entrega e **não** copiam regra de negócio. |
| `TODOLIST.md` | Tarefas e responsáveis; as pendências do Matheus apontam para P01 a P11. |

**Antes de implementar qualquer funcionalidade, localize o RF e as regras (`RFnn.Rn`) em `docs/requisitos.md` buscando pelo título `### RFnn` com Grep. Não leia o arquivo inteiro: ele é grande. Em conflito entre um plano e `requisitos.md`, vale `requisitos.md`; aponte o conflito em vez de escolher sozinho.**

Regra de manutenção:

- Decisão nova ou mudança de regra entra primeiro em `docs/decisoes.md` e `docs/requisitos.md` (subindo a versão no topo), e depois nos planos, que só referenciam.
- O `.docx` v1.0 (`docs/Documento_de_Requisitos_v1.0.docx`) é um retrato e não deve ser editado. Uma versão nova é gerada a partir do `.md` (pandoc) quando os sócios pedirem.
- Pendência `[PROVISÓRIO – Pxx]` em `requisitos.md`: vale a proposta escrita ao lado. Isole o valor em configuração ou constante única, com o ID no comentário, e não trate como bloqueio (a decisão final é do Matheus).

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
| Auth | Better Auth, acesso por senha ou por código (OTP) no e-mail, mais autocadastro do dono (RF01 a RF03); código por WhatsApp e segundo fator na v1.1 |
| Arquivos | Armazenamento compatível com S3 (áudios, fotos, exportações) |
| IA | Claude (Haiku para extração, Sonnet para casos difíceis e relatórios) via saída estruturada (`output_config.format`) na extração, tool use só para consultas e relatórios; transcrição com gpt-transcribe (o gpt-4o-transcribe será desligado em 26/02/2027) |
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

Cada regra aponta para o requisito que a detalha em `docs/requisitos.md`.

1. **Dinheiro é inteiro em centavos** (`bigint` no banco, `number` seguro ou `bigint` no TS). Nunca `float`. Formatação só na borda (`formatBRL`). (RNF13)
2. **Toda tabela de dados de cliente tem `tenant_id`** e política de RLS. Toda query do app roda com `SET LOCAL app.tenant_id` dentro de transação. Teste de isolamento obrigatório para tabelas novas. (RNF02)
3. **A IA nunca faz contas nem inventa números.** Ela extrai dados para um schema Zod; o sistema valida, calcula e grava. Relatórios em linguagem natural: a IA escolhe consultas/ferramentas pré-definidas e parametrizadas; o banco calcula. (RNF13.R3, RF20, RF30)
4. **Nada é apagado de verdade.** Lançamentos usam soft delete (`deleted_at`) e toda alteração gera registro em `entry_versions` (quem, quando, antes/depois, canal). (RNF04, RF24, RF25)
5. **Todo lançamento guarda a origem**: `inbound_message_id` com o texto, a transcrição ou a mídia original. (RF12.R12, RF25)
6. **Webhook responde 200 em menos de 1 s.** Valida assinatura, grava a mensagem bruta, enfileira job, responde. Processamento é sempre assíncrono e idempotente (chave: `wa_message_id`). (RF11, RNF05)
7. **Salvar direto, confirmar sempre.** Cada lançamento gera resposta curta no WhatsApp com o que foi registrado e como corrigir. Na dúvida sobre informação essencial, a IA pergunta antes. (RF12.R17, RF15, RF16)
8. **Custos de IA são medidos** por tenant em `ai_usage` (tokens, minutos de áudio, custo estimado). (RNF08)
9. **Segredos só em variáveis de ambiente**, validadas com Zod na inicialização (`packages/config/env`). Nunca logar conteúdo de mensagens, CPFs ou valores de salário em logs. (RNF01.R6, RNF11)

## Convenções

- Código, nomes de tabelas e identificadores em **inglês**; textos para o usuário em **português do Brasil**.
- Glossário: lançamento = `entry`; despesa = `expense`; receita = `revenue`; unidade/restaurante = `unit`; conta/empresa cliente = `tenant`; fornecedor = `supplier`; forma de pagamento = `payment_method`; canal de venda = `sales_channel`; categoria = `category`.
- Papéis (RF06): DONO = `owner`, GERENTE = `manager`, LANCADOR = `staff`, CONTADOR = `accountant` (Fase 2, RF36; ainda não existe no código). Permissões adicionais: VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL, CONSULTAR_RELATORIOS_WHATSAPP. O mapeamento completo dos enums do documento para o código está nas notas de `docs/requisitos.md`.
- Datas de negócio em `date` (sem hora), fuso padrão `America/Sao_Paulo`. Timestamps em `timestamptz`.
- IDs: UUID v7.
- Validação de entrada com Zod em toda fronteira (HTTP, webhook, saída do LLM, jobs).
- Erros de domínio tipados (`Result`/erros nomeados), não strings soltas.
- Commits no padrão Conventional Commits.

## Como trabalhar aqui

- Antes de mudar schema: editar `packages/db/schema`, gerar migration com drizzle-kit, revisar o SQL gerado, incluir política RLS.
- Mudou prompt ou schema de extração em `packages/ai`: rodar os evals (`pnpm --filter @app/ai eval`) e não deixar a taxa de acerto cair.
- Toda regra nova em `packages/core` vem com teste.
- Testar o canal e a IA sem WhatsApp: `pnpm dev:chat` (chat de terminal, só para desenvolvimento, criado na E5; ver seção 3.6 de `docs/plano-dev-canal-whatsapp.md`; usuários de exemplo em `pnpm db:seed:dev`). O WhatsApp real só é ligado no fim, na E10 (`CHANNEL_MODE=whatsapp`).
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
pnpm dev:worker     # worker da fila (pg-boss); rode em outro terminal junto de pnpm dev
pnpm db:seed:dev    # restaurantes e usuários de exemplo para o chat (recusa NODE_ENV=production)
pnpm dev:chat       # chat de terminal que simula o WhatsApp, só para teste (precisa de dev e dev:worker)
```

## Estado atual

Fase 0 (fundação) pronta, falta só rodar o CI no GitHub. Canal WhatsApp: **E1 a E9 feitas** (núcleo, banco com RLS, webhook, fila, identificação, extração por IA, lançamento com confirmação, correção e desfazer, evals, áudio e foto); a E3 tem a ressalva do teste com mensagem real (P1 da Meta) e a E9 a de áudio e foto nunca testados com mídia real. Próxima etapa do canal: **E10** (envio real e operação; bloqueada pela Meta), com **E11** (modelo de dados dos requisitos) podendo andar antes. O `pnpm dev:chat` aceita texto, `/reply`, `/audio`, `/foto` e `/custo`; `pnpm --filter @app/ai eval` mede a IA (gasta crédito). Painel: nenhuma etapa feita; **F0** pode começar já. Os requisitos v1.0 (29/10/2026) pedem ajustes nas etapas já feitas e etapas novas (E11 a E13, F9 e F10); veja as notas "Ajustes pelos requisitos v1.0" nos planos e a seção de divergências em `docs/arquitetura.md`.
