# Proposal

## Why

O `core` e o `db` ainda refletem o modelo anterior aos requisitos v1.0 e v1.1: três papéis, uma só unidade por vínculo, lançamento sem data de pagamento e sem sinais de revisão novos, cadastros sem os campos que a IA e o painel usam, e nada de imposto estimado. A seção "Divergências entre o modelo de dados atual e os requisitos" de `docs/arquitetura.md` lista o que falta. Sem fechar isso, a E10 (envio real), a E12 (resumos por papel), a E14 (importações) e as etapas do painel F2, F6, F12 e F13 não têm onde gravar nem o que checar. A E10 está bloqueada pela Meta, então a E11 é a próxima etapa do canal.

## What Changes

Cumpre a **E11** de `docs/planos/canal-whatsapp.md`. Só dados e domínio; telas ficam na F2, F6 e F12.

- **Papéis e permissões (`packages/core`)**: papel `accountant` (RF06, RF36, DD-03, DD-04); permissões adicionais VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL e CONSULTAR_RELATORIOS_WHATSAPP (RF05.R7); `can()` passa a receber as permissões e o escopo de unidades; a matriz da seção 2.3 vira teste (RF06.CA06). **BREAKING**: `ROLES` e a assinatura de `can()` mudam.
- **Unidades de acesso (`memberships`)**: tabela de vínculo colaborador × unidade, mantendo "TODAS", unidade padrão dentro da lista, situação CONVIDADO/ATIVO/DESATIVADO, `invited_by` e data do convite, acesso ao painel (RF05.R5 a R8, P13, DN-07). Migração dos vínculos atuais (`unit_id` único ou nulo) sem perder acesso. **BREAKING**: `memberships.unit_id` sai.
- **Aceite do aviso de folha** ao convidar o contador, registrado na auditoria (RF36.CA03, DD-04).
- **Unidades (RF04)**: apelidos, CNPJ, município, UF, status, `default_sales_channel_id` (DD-08) e a regra "não inativar a última ativa".
- **Cadastros de apoio (RF07, RF08, RF09)**: Exige Quantidade, palavras de apoio, status, tipo de forma de pagamento e de canal (inclui `APLICATIVO`, DE-19), apelidos, forma de cartão padrão da empresa.
- **Lançamento e histórico (RF12.R12, R13, R21 a R23, RF24, RF25.R4)**: `entries.paid_on` (padrão = `occurred_on`, DD-02), `entries.orders` (DD-13), sinal `CANAL_A_REVISAR` e receita com canal obrigatório (DD-08), motivo e autor da exclusão, canal de origem `email`.
- **Imposto estimado (RF39, DD-05)**: `tax_settings` (por empresa, com RLS) e `tax_rules` (global, versionada por vigência, só leitura para o app), mais a estrutura de cálculo em `packages/core` testada por regime. Valores e fórmulas reais dependem de P16 e P17 `[PROVISÓRIO]`: aqui só a estrutura e regras de exemplo em teste.
- **Comandos do canal adiados pela DE-17**: `trocar unidade`, `trocar empresa` e empresa citada no texto (RF11.R5, RF19).
- **Ajuste de prompt e schema de extração (`packages/ai`)**: data de pagamento, pedidos, canal padrão e pergunta de investimento acima de R$ 1.500; rodar os evals com os casos RF12.CA11 a CA14.

Fora desta etapa: telas (F2, F6, F12, F13), `parar`/`voltar` e cotas (E10), `exports` (F5), `imports` (E14), `recurring_rules` (E13), colunas de `tenants` e `users` de autocadastro e assinatura (F1, F9), valores reais dos impostos (P16, P17).

## Capabilities

### New Capabilities
- `role-permissions`: papéis (incluindo `accountant`), permissões adicionais, categoria sensível e a matriz da seção 2.3 como contrato testável.
- `unit-access`: lista de unidades de acesso por colaborador, unidade padrão, situação do vínculo, convite e aceite do aviso de folha.
- `unit-registry`: dados da unidade (apelidos, CNPJ, município, UF, status, canal padrão da receita).
- `support-catalogs`: campos de apoio de categorias, formas de pagamento e canais de venda usados pela IA e pelo painel.
- `entry-record`: campos e sinais novos do lançamento e do histórico (data de pagamento, pedidos, revisão, exclusão, canal de origem).
- `estimated-tax`: configuração por empresa, regras versionadas por vigência e cálculo puro do imposto estimado.

### Modified Capabilities
<!-- Nenhuma: `openspec/specs/` ainda está vazio. -->

## Impact

- `packages/core`: `permissions`, `entry` (catálogo, sinais), novo módulo `tax`.
- `packages/db`: `schema/tenants.ts`, `catalog.ts`, `entries.ts`, nova tabela de vínculo e `tax_*`; migrations revisadas com FORCE RLS e grants; `fixtures.ts`, `schema.test.ts`, seed e `seed-dev`; repositórios que leem `memberships.unit_id` (identificação do remetente, `sender-directory`, `entry-store`).
- `packages/ai`: prompt e schema de extração; evals.
- `apps/api` e fluxo de conversa: uso da lista de unidades e das permissões novas; `trocar unidade`/`trocar empresa`.
- Docs: `arquitetura.md` (divergências fechadas), tabela de progresso de `canal-whatsapp.md` e `andamento.md`.
- Sem dependência nova. Nenhum conflito com `requisitos.md` encontrado, salvo o ponto aberto em design.md (RF05.R4 ainda diz que CONTADOR "não aparece no MVP"; RF36 e DD-03 prevalecem).
