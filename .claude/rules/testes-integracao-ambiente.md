---
paths:
  - "**/*.int.test.ts"
  - "**/test/**"
  - "**/package.json"
---

# Ambiente dos testes de integração

Armadilhas que custaram tempo na F3a (registro em `docs/planos/f3a-execucao.md`, seção 2). O `.claude/dicionario-testes.md` continua sendo o mapa do que rodar.

1. **Docker Desktop aberto antes de `test:int`.** O Testcontainers sobe o Postgres; com o Docker fechado todos os arquivos falham com `Could not find a working container runtime strategy`, sem rodar teste. Confira com `docker info`. No Windows, dá para abrir pela linha de comando: `cmd.exe //c start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"`.
2. **Um arquivo só: `pnpm --filter <pacote> exec vitest run <nome>`.** O script `test:int` já passa `int.test.ts` como filtro, então `pnpm --filter <pacote> test:int <nome>` roda **todos** os arquivos de integração do pacote.
3. **Depois de `pnpm --filter <pacote> add`, rode `pnpm install` na raiz** se outro pacote passar a acusar `Cannot find module` (na F3a o `@app/db` perdeu o `drizzle-orm` depois de um `add` no web).
4. **Biblioteca nova: confira a API instalada, não só a versão aceita.** Leia `node_modules/<pacote>/dist/index.d.ts` e a documentação que vem no pacote (`skills/`, `README.md`). Na F3a o TanStack Table instalado era a v9, com outra API, e o passo 0 só tinha olhado a compatibilidade com o React.
5. **E2E que prova o que o CI prova:** `CI=true pnpm --filter @app/web exec playwright test <spec>` (usa `next build`). Detalhes em `.claude/rules/e2e-painel.md`.
