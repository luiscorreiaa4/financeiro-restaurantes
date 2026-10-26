# Finanças para restaurantes (nome provisório)

Controle financeiro gerencial para restaurantes pequenos e médios, com lançamento de gastos e receitas pelo WhatsApp (texto, áudio e foto de nota) interpretado por IA, e um painel web com gráficos, edição e exportação.

## Documentação

- [`CLAUDE.md`](CLAUDE.md): regras e convenções do repositório (lido automaticamente pelo Claude Code)
- [`docs/planejamento.md`](docs/planejamento.md): produto, usuários, regras de negócio, LGPD, negócio
- [`docs/arquitetura.md`](docs/arquitetura.md): stack, decisões técnicas, fluxo e modelo de dados
- [`docs/mvp.md`](docs/mvp.md): escopo da primeira versão, em fases

## Stack

TypeScript · pnpm + Turborepo · Fastify · Next.js · PostgreSQL + Drizzle · pg-boss · Claude API · WhatsApp Cloud API

## Primeiros passos

O código ainda não existe. Para começar com o Claude Code:

```bash
claude
> Leia o CLAUDE.md e os docs e faça o scaffold da Fase 0 descrita em docs/mvp.md.
```
