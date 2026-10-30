---
paths:
  - "packages/db/schema/**"
  - "packages/db/migrations/**"
  - "packages/db/test/fixtures.ts"
---

# Tabela nova ou coluna nova no banco

Regra de negócio por trás: isolamento entre empresas (RNF02, em especial R1 a R5) e auditoria imutável (RNF04). Antes de criar a tabela, confira em `docs/arquitetura.md` ("Divergências entre o modelo de dados atual e os requisitos") se o campo ou a tabela já está previsto, com o RF e a etapa.

Checklist (na E5 a contagem do `schema.test.ts` foi esquecida e quebrou o `pnpm test`):

1. Edite `packages/db/schema`, rode `pnpm db:generate` (com um nome: `drizzle-kit generate --name ...`) e **revise o SQL gerado**.
2. A migration gerada não traz `FORCE ROW LEVEL SECURITY`, `REVOKE` nem `GRANT`. Acrescente à mão, no padrão da `0002` e da `0003`: `FORCE RLS`; `REVOKE UPDATE, DELETE ... FROM app` em tabela de histórico; `GRANT ... TO app_ingest` só se o webhook ou a identificação do remetente precisar.
3. Tabela com `tenant_id` precisa de política para o papel `app`. `tenant_id` nulo (mensagem ainda sem dono) só com política explícita para `app_ingest`.
4. Atualize juntos, ou o CI quebra:
   - `TABLES` (ordem alfabética) e `insertsFor` em `packages/db/test/fixtures.ts`, e uma linha da tabela em `createTenant`;
   - a lista e a contagem ("define as N tabelas") em `packages/db/src/schema.test.ts`.
5. Rode `pnpm test:int` no `db`: o meta-teste de isolamento cobre a tabela nova sozinho.
6. `pnpm db:migrate` não lê o `.env`: exporte `DATABASE_ADMIN_URL` antes de aplicar no banco local.
