# Design

## Context

Estado atual conferido em `packages/core/src/permissions` e `packages/db/schema` (ver proposal.md para o motivo):

- `ROLES = ["owner","manager","staff"]`; `can(role, action, ctx)` só conhece `isOwnEntry` e `categoryIsSensitive`, e trata folha como exclusiva do `owner`.
- `memberships` tem `unit_id` (nulo = todas) e `deactivated_at`; `sender-directory.ts` lê `memberships.unitId`.
- `entries.flags` e `entry_versions.action` já têm `restore`; `ENTRY_FLAGS` não tem `canal_a_revisar`; `CHANNELS` não tem `email`.
- `categories`, `payment_methods`, `sales_channels` só têm nome, taxa e (categorias) tipo/natureza/sensível.
- As divergências e a etapa de cada uma estão em `docs/arquitetura.md`. A regra `.claude/rules/tabela-nova.md` vale para toda tabela e coluna nova (FORCE RLS, grants, `fixtures.ts`, `schema.test.ts`).

Inconsistência encontrada em `requisitos.md`: **RF05.R4** diz que CONTADOR "está previsto para a Fase 2 e não aparece como opção no MVP", enquanto RF06, RF36, a matriz 2.3 e DD-03 o colocam no MVP. Vale DD-03; a tarefa 1.1 corrige o R4 em `requisitos.md` (subindo a versão) antes do código.

## Goals / Non-Goals

**Goals:**
- Dados e domínio prontos para E10, E12, E14 e F2/F6/F12/F13, com a matriz 2.3 como teste.
- Migration que não perde acesso de ninguém e roda sobre o seed de desenvolvimento.

**Non-Goals:**
- Telas, endpoints do painel e convite por e-mail (F2, F6, F13). Aqui o convite existe como caso de uso de domínio com o aceite do aviso.
- Valores e fórmulas reais de imposto (P16, P17).
- Autenticação, colunas de `tenants`/`users` do autocadastro (F1) e assinatura (F9).

## Decisions

**D1. Unidades de acesso em tabela de junção `membership_units`, mantendo "TODAS" em coluna.** `memberships` ganha `all_units boolean` e `default_unit_id`; `membership_units (tenant_id, membership_id, unit_id)` guarda a lista, com FKs compostas por `tenant_id`. Check: `all_units` verdadeiro ⇒ sem linhas na junção (garantido no domínio e em teste, pois check entre tabelas não existe); `default_unit_id` precisa estar na lista ou o vínculo ser `all_units` (validação no domínio, mais FK composta). Alternativa descartada: `uuid[]` em `memberships`, que perde a FK por elemento e quebra o isolamento por chave composta (RNF02). Alternativa descartada: manter `unit_id` e criar a junção só para listas, pois deixa dois caminhos para a mesma regra.

**D2. Migration em duas fases na mesma migration.** (1) cria colunas e junção; (2) `INSERT ... SELECT` converte `unit_id` nulo em `all_units = true` e `unit_id` preenchido em uma linha de junção, também padrão (para `all_units`, o padrão fica nulo e o domínio usa a primeira unidade ativa, como hoje, DE-17); `deactivated_at` vira `status = 'deactivated'`, e `invited`/`active` conforme a existência de mensagem recebida do usuário; (3) remove `unit_id` e a FK `memberships_unit_fk`. Sem `DROP` antes do backfill. Rollback: restaurar do backup, pois o projeto ainda não está em produção; não se escreve migration reversa.

**D3. Situação do vínculo como `status` (`invited | active | deactivated`)**, mantendo `deactivated_at` como data. A identificação do remetente trata `deactivated` como desconhecido (RF05.CA05). A transição `invited → active` acontece na identificação da primeira mensagem (RF05.CA07), junto do opt-in que já existe.

**D4. Permissões adicionais continuam em `memberships.permissions jsonb`, validadas por enum no `core` e por check no banco** (`permissions <@ ...` não se aplica a objeto; o check usa as chaves permitidas). Alternativa: tabela própria; descartada por excesso para 4 valores fixos.

**D5. `can()` ganha contexto explícito, sem ler banco.** Assinatura nova: `can(actor, action, ctx)` com `actor = { role, permissions, unitScope }`, onde `unitScope` é `"all"` ou lista de unidades; `ctx` leva `unitId`, `isOwnEntry`, `categoryIsSensitive`. Regras: `accountant` só ações de leitura/exportação e sempre vê sensível; `manager` vê sensível só com VER_FOLHA; unidade fora do escopo recusa (RF06.R5). A matriz 2.3 vira uma tabela de dados no teste (papel × ação × variações) para que o teste espelhe o documento linha a linha. **BREAKING:** todos os chamadores de `can()` migram na mesma etapa (typecheck aponta); `ROLES` ganha `accountant`.

**D6. Aceite do aviso de folha na `audit_log`.** Linha com ação `accountant_invite_accepted_payroll_notice`, ator, vínculo e data. Alternativa: coluna em `memberships`; descartada porque a auditoria é imutável e a coluna não é. Se `audit_log` ainda não aceita ações fora de uma empresa, não é problema aqui: o aceite sempre tem `tenant_id`.

**D7. `entries`: `paid_on date` (not null, com default aplicado no domínio e backfill `= occurred_on`), `orders integer` com check `> 0`, `deleted_by`, `delete_reason`, `restorable_until`.** Receita com canal obrigatório vira check `type <> 'revenue' or sales_channel_id is not null`, **depois** de um backfill dos lançamentos antigos para o canal "Não informado" da empresa (criado na migration se faltar). `ENTRY_FLAGS` ganha `channel_to_review`; `CHANNELS` ganha `email`. Sinais continuam em `text[]`.

**D8. Cadastros: colunas com check por enum (`oneOf`) e arrays de apelidos como `text[]`**, no mesmo padrão de `suppliers.aliases`. Unicidade de apelidos na empresa, nome sem acento/maiúscula e limites de tamanho ficam no domínio (`core`) com índice único em coluna normalizada só para nome de unidade. Forma de cartão padrão: `tenants`-nível seria coluna em `tenants` (sem RLS de escrita para `app`), então vai em `payment_methods.is_default_card boolean` com índice único parcial por empresa.

**D9. Hierarquia de categorias:** herança de tipo, grupo e sensível aplicada no domínio ao criar subcategoria (e conferida por teste); `origin` derivável de `tenant_id` nulo, então não vira coluna (evita dado duplicado). `parent_id` já existe; limite de dois níveis validado no domínio.

**D10. Imposto: `tax_settings` por empresa (RLS padrão) e `tax_rules` global.** `tax_rules` não tem `tenant_id`: política `SELECT` para `app`, `REVOKE INSERT, UPDATE, DELETE` do `app`; carga só por seed/migration. Sem `UPDATE` nem exclusão de linha (vigência só por linha nova), reforçado por trigger-free `REVOKE`. `tax_settings` guarda regime, data de início, parâmetros `jsonb` validado por Zod por regime e `show_estimate`. Histórico de regime: uma linha por vigência (`valid_from`), para o mês antigo usar o regime antigo (RF39.R2), com `unique(tenant_id, valid_from)`. O cálculo é função pura em `packages/core/src/tax`, que recebe as regras como argumento (não lê o banco). Parâmetros reais ficam atrás de constante com `[PROVISÓRIO – P16/P17]`; os testes usam regras de exemplo.

**D11. `meta-teste de isolamento` cobre as tabelas novas** (`membership_units`, `tax_settings`) via `fixtures.ts`; `tax_rules` entra na lista de tabelas globais do teste, com teste próprio de somente leitura.

**D12. Prompt/schema da extração (`packages/ai`):** o schema Zod ganha `paidOn` (opcional), `orders` (opcional) e o sinal de canal ausente; o servidor aplica o canal padrão e o limite de R$ 1.500 (constante única). A IA só extrai (regra 3). Evals ganham os casos RF12.CA11 a CA14; a taxa de acerto atual não pode cair.

**D13. `trocar unidade`, `trocar empresa` e empresa citada (DE-17)** entram no roteador de conversa existente, usando a lista de unidades do vínculo. Empresa citada em texto casa por nome/apelido só entre as empresas em que o telefone tem vínculo ativo; sem casamento, pergunta (RF15).

## Risks / Trade-offs

- [Migration destrutiva em `memberships`] → backfill antes do `DROP`, teste de migração sobre dados do seed e conferência de contagem de acessos antes e depois.
- [`can()` com assinatura nova quebra chamadores] → typecheck falha de forma visível; migrar todos na mesma etapa, sem adaptador de compatibilidade.
- [Check "receita exige canal" falha em dados antigos] → backfill para "Não informado" antes do check; se o canal não existir, a migration o cria por empresa.
- [Regras de imposto provisórias] → só estrutura e dados de exemplo em teste; aviso do RF39.R7 no retorno; nada de valor real até P16/P17.
- [Regras entre tabelas (todas × lista, padrão na lista) não cabem em `CHECK`] → domínio valida e há teste de integração; aceito o risco de escrita direta por SQL.
- [Escopo grande para uma etapa (M/G)] → tarefas agrupadas por entrega verificável; pode ser entregue em commits separados, com a matriz de permissões e a migration como marcos.

## Migration Plan

1. Corrigir RF05.R4 em `requisitos.md` e registrar a decisão em `decisoes.md` (D5, D6 e D7 desta etapa como DE-xx).
2. Gerar migrations com `drizzle-kit generate --name ...`, revisar o SQL, acrescentar `FORCE RLS`, `REVOKE` e `GRANT` à mão (padrão das migrations 0002 e 0003).
3. Aplicar em banco local com `DATABASE_ADMIN_URL` exportado, depois `pnpm db:seed:dev`.
4. Rollback: restaurar o banco; não há migration reversa.

## Open Questions

- **Tarefa 3.8 (aberta em 06/11/2026): onde mora a escolha de unidade e empresa pelo WhatsApp?** Opção recomendada: tabela `conversation_preferences` (usuário, `default_tenant_id` opcional, `default_unit_id` opcional, `updated_at`) com política que deixa o papel `app` ler e gravar só as linhas do próprio usuário dentro do tenant corrente, e o `trocar empresa` gravado pelo papel `app_ingest` (que já enxerga os vínculos de todos os restaurantes). A lista numerada fica como pergunta pendente de um tipo novo (`choice`), para reaproveitar a validade de 24 h e o `cancelar`. A empresa citada no texto (RF11.R5) entra como dica nova na extração (`company_hint`), casada pelo sistema só entre os vínculos ativos do telefone. Se aprovada, vira DE-xx em `decisoes.md` e o design é atualizado antes do código.
- **Contador criado só por e-mail:** `users.phone_e164` é obrigatório; ajuste na F1/F13.

- Nome exato da ação de auditoria do aceite do aviso e se o `audit_log` atual comporta ator sem empresa (não afeta a E11, pois o aceite tem empresa).
- Prazo de "restaurável até" na lixeira: usar o valor de RF24 (conferir ao implementar; se for `[PROVISÓRIO]`, constante única).
