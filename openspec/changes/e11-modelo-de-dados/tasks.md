# Tasks

Cada tarefa escreve o teste primeiro (TDD). Migrations seguem `.claude/rules/tabela-nova.md`.

## 1. Documentação primeiro

- [x] 1.1 Corrigir RF05.R4 em `docs/requisitos.md` (CONTADOR é MVP, DD-03), subir a versão no topo e registrar em `docs/decisoes.md` as decisões D1, D5, D6 e D7 do design como DE-xx
- [x] 1.2 Conferir em RF24 o prazo de "restaurável até" e, se for `[PROVISÓRIO]`, isolar em constante única com o ID

## 2. Papéis e permissões (`packages/core`)

- [x] 2.1 Teste: matriz da seção 2.3 como tabela de dados (papel × ação × variações), cobrindo RF06.CA02, CA04, CA06 e RF36.CA04 (falha antes da implementação)
- [x] 2.2 `ROLES` com `accountant`, enum de permissões adicionais, validação papel × permissão (RF05.R7) com erro tipado
- [x] 2.3 Nova assinatura de `can(actor, action, ctx)` com escopo de unidades, VER_FOLHA, EXPORTAR_DADOS e contador somente leitura que vê folha
- [x] 2.4 Migrar todos os chamadores de `can()` e `ROLES` no monorepo até `pnpm typecheck` passar

## 3. Unidades de acesso (`packages/db` e `core`)

- [x] 3.1 Teste de integração da migração: dados do seed (`unit_id` nulo, único e desativado) mantêm o mesmo acesso após converter
- [x] 3.2 Schema: `memberships` com `all_units`, `default_unit_id`, `status`, `invited_by`, `invited_at`; tabela `membership_units` com FKs compostas
- [x] 3.3 Gerar a migration com `--name`, revisar o SQL, escrever o backfill antes do `DROP` de `unit_id`, acrescentar FORCE RLS e grants
- [x] 3.4 Atualizar `fixtures.ts` (`TABLES`, `insertsFor`, `createTenant`) e a contagem em `schema.test.ts`; rodar `pnpm test:int` no `db`
- [x] 3.5 Regras de domínio com teste: padrão dentro da lista (RF05.CA04), sempre um Dono ativo (CA06), unidade nova entra para quem tem TODAS
- [x] 3.6 Ajustar `sender-directory`, identificação do remetente e `dev-seed` ao novo modelo; `desativado` responde como desconhecido (RF05.CA05) e `invited → active` na primeira mensagem (CA07)
- [x] 3.7 Caso de uso de convite do contador com aceite do aviso de folha na `audit_log` e mesmo e-mail em várias empresas (RF36.CA01, CA03)
- [ ] 3.8 `trocar unidade`, `trocar empresa` e empresa citada no texto no roteador de conversa, restritos às unidades de acesso (DE-17, RF11.R5, RF06.R5), com teste no `dev:chat`
  - **Pendente (06/11/2026), precisa de decisão antes de implementar.** O design não cobre o estado de conversa que esta tarefa exige: (a) guardar a unidade/empresa escolhida "até nova troca" (RF19); `trocar empresa` vale entre empresas e as tabelas são isoladas por tenant, então pede tabela nova com política própria (ex.: `conversation_preferences` por usuário); (b) a lista numerada e a resposta "2" são dois turnos e não podem colidir com a pergunta pendente (RF15, DE-16); (c) reconhecer a empresa citada no texto (RF11.R5) mexe na extração. Ver "Perguntas abertas" em `design.md`. O que já existe e a tarefa deve reusar: `accessibleUnitIds`, `senderToActor`, `resolveSender`, `SenderMembership.unitIds`/`defaultUnitId`.

## 4. Unidades e cadastros de apoio

- [x] 4.1 Testes de `core`: nome/apelidos/CNPJ/UF da unidade (RF04.CA01 a CA03), não inativar a última ativa, herança de subcategoria e limite de dois níveis
- [x] 4.2 Schema e migration de `units` (apelidos, CNPJ, município, UF, status, `default_sales_channel_id` com FK composta) com backfill de município/UF e canal padrão
- [x] 4.3 Schema e migration de `categories`, `payment_methods` (tipo, apelidos, status, `is_default_card`) e `sales_channels` (tipo `APLICATIVO` etc., apelidos, status); seed com as formas e canais "Não informada" e "Não informado" `[PROVISÓRIO – P01, P02, P05, P06, P07]`
- [x] 4.4 Regra de taxa: canal `APLICATIVO` com comissão substitui a taxa da forma; "cartão" usa a forma padrão (RF09.R4, RF12.R8) com teste
- [x] 4.5 Atualizar `fixtures.ts`, `schema.test.ts` e rodar `pnpm test:int`

## 5. Lançamento e histórico

- [x] 5.1 Testes de `core`: `paid_on` padrão, `orders > 0`, canal padrão com `CANAL_A_REVISAR`, limite de investimento em constante única (RF12.CA11 a CA14)
- [x] 5.2 Schema e migration de `entries` (`paid_on`, `orders`, `deleted_by`, `delete_reason`, `restorable_until`), backfill de `paid_on` e do canal "Não informado" nas receitas antigas, depois o check de receita com canal
- [x] 5.3 `ENTRY_FLAGS` com `channel_to_review`, `CHANNELS` com `email`, ação "marcar como revisado" gerando versão
- [x] 5.4 Ajustar `entry-store` e o fluxo de lançamento da E7 para gravar os campos novos e citar o canal usado na confirmação
- [x] 5.5 Teste de integração: excluir e restaurar gera duas versões e preserva os dados

## 6. Imposto estimado

- [x] 6.1 Testes de `core/tax` por regime com regras de exemplo: arredondamento meio-para-cima, vigência (RF39.CA03), troca de regime, opção desligada (CA01), aviso do R7
- [x] 6.2 Módulo puro `packages/core/src/tax`, sem acesso a infra; valores reais atrás de constante `[PROVISÓRIO – P16, P17]`
- [x] 6.3 Schema e migration de `tax_settings` (RLS) e `tax_rules` (global, `REVOKE` de escrita para `app`); auditoria de ativar, desativar e alterar
- [x] 6.4 Atualizar `fixtures.ts` e `schema.test.ts`; teste de somente leitura de `tax_rules`; `pnpm test:int`

## 7. IA (`packages/ai`)

- [x] 7.1 Acrescentar ao dataset de evals os casos RF12.CA11 a CA14
- [x] 7.2 Atualizar o schema Zod e o prompt de extração (`paidOn`, `orders`, canal ausente, pergunta de investimento) sem a IA calcular nada
- [ ] 7.3 Rodar `pnpm --filter @app/ai eval` e confirmar que a taxa de acerto não caiu (gasta crédito)
  - **Pendente (06/11/2026): bloqueada por credencial.** `pnpm --filter @app/ai eval` falhou com 401 `invalid x-api-key` (a `ANTHROPIC_API_KEY` do `.env` é inválida). Código, dataset (casos e01 a e07) e prompt prontos. Com chave válida: rodar `pnpm --filter @app/ai eval --max-usd=0.3`, conferir que nada caiu em relação a `baseline.json` e, se as métricas novas forem boas, `--update-baseline`.

## 8. Fechamento

- [x] 8.1 Atualizar `docs/arquitetura.md` (divergências fechadas), a tabela de progresso de `docs/planos/canal-whatsapp.md` e `docs/planos/andamento.md`; seguir o "Fechamento de etapa" do plano (propor, sem criar, regras, skills e hooks)
- [x] 8.2 `pnpm typecheck && pnpm lint && pnpm test` e `pnpm test:int` no `db`
