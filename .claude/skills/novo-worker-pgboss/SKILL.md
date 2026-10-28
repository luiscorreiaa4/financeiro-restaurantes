---
name: novo-worker-pgboss
description: Cria um novo worker pg-boss neste repositório (fila, DLQ, caso de uso idempotente, adaptador e testes de integração). Use ao adicionar uma fila nova, como as da E7 (confirmação) e da E9 (áudio e foto).
---

# Novo worker pg-boss

Modelo de referência: `process-inbound` (E4). Leia antes `.claude/rules/pg-boss.md`.

1. **Nome e payload.** Constante do nome da fila e schema Zod do payload em `apps/api/src/modules/<modulo>/`. O payload leva só ids, nunca conteúdo de mensagem.
2. **Configuração da fila.** Em `apps/api/src/infra/<nome>-queue.ts`: constante de config (retryLimit, retryDelay, retryBackoff, retryDelayMax opcional, expireInSeconds) e `ensure<Nome>Queues(boss, config)` que cria a DLQ, depois a fila, depois `updateQueue`. Chame de servidor e worker.
3. **Porta e repositório.** Transições de estado como interface em `packages/core/src/ports/ports.ts`, com `UPDATE` guardado no adaptador em `packages/db/src/`. Papel do banco: `app_ingest` se ainda não há tenant; `app` + `withTenant` depois.
4. **Caso de uso.** `apps/api/src/modules/<modulo>/<nome>.ts`: valida o payload com Zod (inválido vira `deadletter`), assume o trabalho com a guarda, executa, conclui; na última tentativa (`retryCount >= retryLimit`) marca falha com `describeError`. Recebe `logger` por injeção.
5. **Adaptador pg-boss.** Como `infra/pg-boss-worker.ts`: `work` com `batchSize`, `perJobResults: true`, e `stop({ graceful: true, timeout })`.
6. **Composição.** Só em `apps/api/src/composition.ts` e `worker.ts`.
7. **Testes.** Unitário do caso de uso com repositório em memória e checagem de que o log não vaza conteúdo. Integração em `apps/api/test/` com Postgres e pg-boss reais e config rápida (retryDelay 0, expireInSeconds 1): caminho feliz, retry transitório, esgotar tentativas até a DLQ, payload inválido, reenfileirar sem duplicar, dois workers, parada limpa no meio de um job, worker derrubado e retomado.
8. **Fechamento.** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int` e atualizar o plano.
