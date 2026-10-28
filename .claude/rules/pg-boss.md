---
paths:
  - "apps/api/src/infra/**"
  - "apps/api/src/jobs/**"
  - "apps/api/src/modules/inbound/**"
  - "apps/api/src/worker.ts"
---

# Filas e workers (pg-boss)

- O handler de `work()` recebe sempre um **lote** (array). Use `perJobResults: true` para responder job a job (`completed`, `failed`, `deadletter`).
- A fila de mensagens mortas (DLQ) deve existir **antes** da fila que a referencia (`deadLetter`).
- `retryDelayMax` só é aceito com `retryBackoff: true`; sem isso o `createQueue` lança erro.
- `createQueue` não altera fila existente: para convergir configuração, chame também `updateQueue` (já feito em `ensureProcessInboundQueues`).
- O esquema `pgboss` só existe depois do primeiro `start()`. Testes que limpam `pgboss.job` precisam iniciar um `PgBoss` antes.
- Idempotência: `singletonKey` = `wa_message_id`, em fila `exclusive`. A garantia real é o `INSERT ... ON CONFLICT DO NOTHING`.
- Estado da mensagem só muda por `UPDATE` com guarda no estado de origem (`InboundProcessingRepo`). Reprocessar o mesmo job nunca repete efeito.
- Erro persistido é um **código curto** (`describeError`), nunca a mensagem do erro: o Drizzle coloca os parâmetros do SQL nela, e eles podem ter o texto do usuário (regra 9).
- Nunca logar conteúdo de mensagem, telefone ou `raw`; o `redact` do logger é a segunda barreira, não a primeira.
- Queue e worker conectam com o papel administrativo (único com acesso ao esquema `pgboss`); a gravação de dados usa `app_ingest` ou `app` + `withTenant`.
