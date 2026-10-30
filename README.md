# Finanças para restaurantes (nome provisório)

Controle financeiro gerencial para restaurantes pequenos e médios, com lançamento de gastos e receitas pelo WhatsApp (texto, áudio e foto de nota) interpretado por IA, e um painel web com gráficos, edição e exportação.

## Documentação

Cada documento tem um papel. Em conflito, vale a ordem da lista (do mais forte para o mais fraco).

- [`docs/requisitos.md`](docs/requisitos.md): **o quê** e as regras de negócio (38 requisitos funcionais, 14 não funcionais, matriz de permissões, pendências). Fonte da verdade. Busque por `### RFnn`.
- [`docs/decisoes.md`](docs/decisoes.md): **por quê**, o registro de decisões
- [`docs/arquitetura.md`](docs/arquitetura.md): **como**, a parte técnica: stack, fluxo, modelo de dados e divergências em relação aos requisitos
- [`docs/planejamento.md`](docs/planejamento.md): visão de produto e de negócio (problema, público, custos, validação, riscos)
- [`docs/mvp.md`](docs/mvp.md): escopo por fase, organizado por requisito (MVP, v1.1, Fase 2)
- [`docs/plano-dev-canal-whatsapp.md`](docs/plano-dev-canal-whatsapp.md): ordem de execução do canal WhatsApp, em 13 etapas (E1 a E13)
- [`docs/plano-dev-frontend.md`](docs/plano-dev-frontend.md): ordem de execução do painel web, em 11 etapas (F0 a F10)
- [`TODOLIST.md`](TODOLIST.md): tarefas e responsáveis (as pendências do Matheus apontam para P01 a P11)
- [`CLAUDE.md`](CLAUDE.md): regras e convenções do repositório (lido automaticamente pelo Claude Code)

## Módulos e nomes

Dois módulos de produto, cada um com um plano. Os nomes abaixo são os usados nos planos e nos commits.

| Módulo | O que é | Onde vive no código | Plano | Fases do MVP |
|---|---|---|---|---|
| **Canal WhatsApp** | Caminho completo da mensagem até o lançamento gravado: webhook, fila, identificação do usuário, **IA** (extração e transcrição), gravação com versão e origem, confirmação | `apps/api`, `packages/whatsapp`, `packages/ai`, `packages/core`, `packages/db` | `plano-dev-canal-whatsapp.md` | 1, 2, 3 e parte da 5 |
| **Painel web** | Consulta, edição e exportação dos lançamentos, dashboard, configurações | `apps/web` (e os endpoints do painel em `apps/api`) | `plano-dev-frontend.md` | 4 e parte da 5 |

Por que "canal WhatsApp" e não "chat IA", "API" ou "AI": a IA é só um passo do caminho (`packages/ai`), e `apps/api` serve também o painel. O canal é o conjunto todo.

Etapas: `E1` a `E13` são do canal WhatsApp, `F0` a `F10` são do painel. Cada plano tem uma tabela de progresso no topo e lista os requisitos (RFs) que cada etapa entrega.

**Testar sem WhatsApp:** durante o desenvolvimento, o canal e a IA são testados por um chat de terminal (`pnpm dev:chat`, criado na E5), só para teste e sem interface visual. O WhatsApp real é configurado no fim do desenvolvimento (E10), quando a Meta estiver liberada. Ver `docs/plano-dev-canal-whatsapp.md`, seção 3.6.

## Estrutura do repositório

Um único repositório (monorepo) com um `package.json` por módulo e **uma só instalação, na raiz**.

```
.claude/                  contexto do Claude Code, compartilhado por todos os módulos
  agents/                 subagentes do projeto (um .md por agente)
  skills/                 skills do projeto (pasta <nome>/SKILL.md)
  rules/                  regras por tema, com `paths:` para valerem só em certas pastas
apps/
  api/                    Fastify: webhook, API do painel, workers
    src/{http,jobs,modules}
  web/                    Next.js: painel
    app/ features/ components/ lib/
packages/
  core/                   domínio puro (dinheiro, regras, permissões, telefone, portas)
  whatsapp/               cliente e schemas da Cloud API; fixtures reais em test/fixtures
  ai/                     extração, transcrição, preços e evals
  db/                     schema Drizzle, migrations, withTenant
  config/                 tsconfig base e validação de env
docs/                     planejamento, arquitetura, MVP e planos de desenvolvimento
CLAUDE.md                 regras gerais (lido sempre)
package.json              scripts da raiz (turbo)
pnpm-workspace.yaml       lista os módulos do monorepo
```

Pastas vazias levam um `.gitkeep` só para o git guardá-las. Apague o `.gitkeep` quando a pasta ganhar o primeiro arquivo.

### Dependências e comandos por módulo

- Cada módulo tem o **seu `package.json`** (suas dependências e scripts). O `package.json` da raiz só orquestra.
- O `pnpm install` roda **uma vez, na raiz**, e gera **um `pnpm-lock.yaml`**. Cada módulo tem um `node_modules` pequeno, só com atalhos (links) para o que ele usa; os pacotes de verdade ficam em um repositório compartilhado do pnpm.
- Da raiz: `pnpm dev`, `pnpm test`, `pnpm typecheck` e `pnpm lint` rodam em todos os módulos.
- Só um módulo, ainda da raiz: `pnpm --filter @app/api dev`, `pnpm --filter @app/core test`, `pnpm --filter @app/web build`.
- Entrar na pasta do módulo e rodar `pnpm dev` ou `pnpm test` também funciona, mas só para aquele módulo.

## Stack

TypeScript · pnpm + Turborepo · Fastify · Next.js · PostgreSQL + Drizzle · pg-boss · Claude API · WhatsApp Cloud API

## Estado atual

Fase 0 (fundação) pronta: monorepo, TypeScript strict, Biome, Vitest, validação de variáveis de ambiente com Zod e Postgres 16 no Docker Compose funcionam. O workflow de CI está escrito, mas ainda não rodou no GitHub. Canal WhatsApp: E1 a E5 feitas (domínio, banco com RLS, webhook, fila e workers, identificação e roteamento, com o `pnpm dev:chat`). Próximo passo: E6 (extração por IA, texto) no canal e F0 (fundação do web) no painel, que podem andar em paralelo.

## Primeiros passos

Requisitos: Node 24 (veja `.nvmrc`), pnpm 10 e Docker.

```bash
pnpm install
cp .env.example .env     # preencha os valores (veja os comentários em .env.example)
docker compose up -d     # Postgres 16 em localhost:5432
pnpm dev                 # API em :4000 (GET /health) e web em :3000
```

O `.env` nunca vai para o git. Segredos só em variáveis de ambiente, validadas na inicialização por `packages/config/env`.

### Comandos

```bash
pnpm test         # testes de todos os pacotes
pnpm typecheck
pnpm lint         # Biome (Markdown fica fora)
pnpm format       # aplica as correções do Biome
pnpm db:generate  # gera migration a partir do schema (ainda sem tabelas)
pnpm db:migrate
pnpm db:seed
```

## Como trabalhar com o Claude Code

### Abra sempre na raiz

Inicie o Claude Code (terminal ou extensão do VS Code) **na pasta raiz do repositório**, mesmo ao trabalhar em um módulo só. Motivos, conforme a documentação do Claude Code:

- As configurações compartilhadas (`.claude/settings.json`, permissões, hooks) são lidas do diretório onde a sessão começa. Começando em `apps/api`, as da raiz não valem.
- O `CLAUDE.md` da raiz, o `.claude/skills/` e o `.claude/agents/` são carregados a partir da raiz. Os `CLAUDE.md` das pastas **acima** de onde você começa também carregam, mas as configurações não.
- Os módulos dependem uns dos outros (`api` usa `core`, `db`, `whatsapp` e `ai`). Uma mudança costuma tocar mais de um deles, e comandos como `pnpm --filter` e `turbo` partem da raiz.

### Foco em um módulo, ainda na raiz

Para o agente ficar por dentro de um módulo, sem sair da raiz:

1. **`CLAUDE.md` dentro do módulo** (por exemplo `apps/api/CLAUDE.md`, `packages/core/CLAUDE.md`). Ele carrega **sob demanda**, quando o Claude lê um arquivo daquela pasta. Use para convenções e armadilhas daquele módulo.
2. **Regras com `paths:`** em `.claude/rules/` (por exemplo `webhook.md` com `paths: apps/api/src/http/**`). Valem só ao mexer nesses arquivos.
3. **Skills e agentes em `.claude/` na raiz**, um para cada fluxo repetido (por exemplo, "criar migration com RLS"). Uma skill pode também ficar em `<módulo>/.claude/skills/`, mas só carrega depois que o Claude lê um arquivo daquela pasta.
4. **Diga no pedido o módulo e a etapa**: "Trabalhe só em `apps/web`, etapa F0".

Entrar na pasta do módulo antes de abrir o Claude só vale para uma tarefa isolada e sem dependência de outros módulos, sabendo que as configurações da raiz não valem e que editar outras pastas do monorepo pode pedir permissão extra (não conferi esse detalhe na documentação de permissões).

### Retomar o trabalho

O Claude Code lê o `CLAUDE.md` sozinho, mas **não** lê os planos sozinho. Diga qual módulo e peça a próxima etapa:

```text
Leia o CLAUDE.md e docs/plano-dev-canal-whatsapp.md e execute a próxima etapa pendente.
```

```text
Leia o CLAUDE.md e docs/plano-dev-frontend.md e execute a próxima etapa pendente.
```

Ao concluir uma etapa, atualize a tabela de progresso do plano e o campo "Atualizado em". Antes de dar uma etapa por pronta, rode `pnpm typecheck && pnpm lint && pnpm test`.
