# F3 Lançamentos (com F2-3, F0-3 e F0-4): desenho

Aprovado pelo Luís em 13/11/2026. Planos: `docs/superpowers/plans/2026-11-13-f3a-lancamentos-ver.md` e `docs/superpowers/plans/2026-11-13-f3b-lancamentos-mudar.md`.

## Contexto

A F3 é a primeira etapa do painel que mostra e altera dado financeiro (RF22 a RF25). O domínio já existe (`editEntry`, `softDeleteEntry`, `restoreEntry`, `markEntryReviewed` em `packages/core/src/entry/entry.ts`, com versão e guarda de concorrência em `applyChanges`), e as colunas de lixeira, `paid_on`, `orders` e os quatro sinais estão no banco. Falta a leitura (lista paginada, totais, detalhe, lixeira, versões), toda a API de lançamentos, a tela e a API falsa do E2E. A etapa herda F2-3 (categoria sensível filtrada na resposta e matriz papel × rota), F0-3 (base do shadcn serve?) e F0-4 (⚠️ do TanStack Table).

Decidido com o Luís em 13/11/2026: um desenho e **dois planos** (F3a "ver", F3b "mudar"); entram **TanStack Table e React Hook Form**; **ordenação por coluna no servidor** (muda o RF22.Obs3); **mídia do "ver origem" fica para a E10** (a F3 mostra texto, transcrição e chave de acesso); o aviso de valores restritos na lista ganha texto próprio (RF22.Obs7).

## 1.1 Intenção

O dono, o gerente, o lançador com painel e o contador conferem no painel o que entrou pelo WhatsApp: acham um lançamento, veem de onde veio, corrigem, excluem e restauram, com histórico. Sucesso é o "Pronto quando" da etapa: um lançamento criado no `pnpm dev:chat` aparece na lista, é editado no painel e o histórico mostra as duas origens.

## 1.2 Objetivos, não objetivos, anti-objetivos

**Objetivos:** RF22 (CA01 a CA05), RF23 (CA01 a CA04), RF24 (CA01 a CA03), RF25 (R1, R4, Obs1, CA01, CA03, CA04); RF06.R3 e CA02 nas respostas da API (F2-3); matriz papel × rota para toda rota nova (RF06.CA06); fechar F0-3 e o item TanStack Table da F0-4.

**Não objetivos:**
- Áudio e imagem da origem (RF25.R2, R3, Obs2, CA02): ficam para a E10, com o S3. Pendência nova F3-1.
- Itens lidos da nota (RF25.R3): não são gravados em lugar nenhum hoje. Pendência nova F3-2 (E9/E14).
- Lançamento manual (RF26, v1.1), exportação (F5), cadastros e mesclagem de fornecedor (F6).
- Restauração em lote: o `painel.md` cita, o RF24 não prevê. Sai do `painel.md`.
- Rotina de eliminação: nada é apagado; passados 30 dias o lançamento só deixa de aparecer na lixeira (RF24.R2).

**Anti-objetivos:** a tela somar dinheiro (RF22.Obs2); lançamento sensível ou de outro lançador vazar por lista, total, detalhe, histórico, origem, opções de filtro ou parâmetro de URL; `float` em qualquer ponto; dado de tenant em `use cache` ou em chave de query sem `tenantKey`; ordenar no navegador só o que está carregado.

## 1.3 Restrições

- Regras inegociáveis do `CLAUDE.md` (1, 2, 3, 4, 5, 9) e as regras de `apps/web/CLAUDE.md`, `.claude/rules/rota-de-tenant.md`, `e2e-painel.md`, `testes.md`, `dicionario-testes.md`, `tabela-nova.md`, `biome-escopo.md`.
- Dependências novas aprovadas, só em `apps/web`: `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`. Nenhuma outra (sem biblioteca de data, de máscara ou de calendário; sem `fastify-type-provider-zod`).
- Nenhuma tabela nova e nenhuma ação nova em `ACTIONS` (a matriz de 72 casos não muda). Uma migration (0018) só com índices.
- Sem variável de ambiente nova.

## 1.4 Abordagens

1. **Contrato Zod em `@app/core/contracts`, leitor SQL em `packages/db`, rotas num plugin `entries` da API, tela em `features/entries` (escolhida).** É a recomendação D-F3 e D-F4 já registrada, reusa os casos de uso do canal sem tocar neles e não pede dependência no servidor. O contrato é a única interface que os modelos menores precisam seguir.
2. OpenAPI gerado (`fastify-type-provider-zod` + `@fastify/swagger`) e cliente tipado: duas dependências não aprovadas e uma troca do padrão de `safeParse` manual das rotas existentes. Descartada.
3. Server Actions do Next chamando a API: contraria o padrão da F2 (o navegador fala com `/api/*`; escrita pelo servidor do Next exigiria exceção de `Origin`). Descartada.

## 1.5 Regras que mudam (entram antes em `decisoes.md` e `requisitos.md`)

- **DD-35 (13/11/2026):** a lista de lançamentos pode ser ordenada no servidor por Criação (padrão, decrescente), Data, Data de Pagamento ou Valor Bruto, nos dois sentidos, com desempate pelo identificador e cursor por (coluna, id). RF22.Obs3 passa a dizer: "Paginação contínua por cursor. Ordem padrão: data e hora de criação decrescentes. O usuário pode ordenar por Data, Data de Pagamento ou Valor Bruto, crescente ou decrescente; a ordenação é feita pelo servidor sobre a consulta inteira, com desempate pelo identificador. Em qualquer ordem, a próxima página não repete lançamentos nem pula os que já existiam quando a consulta começou e não foram alterados. (DD-35)". Requisitos sobe para **1.14**.
- **RF22.Obs7 (nova, DD-36):** "Para quem não pode ver categorias sensíveis, os totais da lista não somam esses lançamentos e a tela mostra o aviso 'Há valores restritos que não entram nestes totais.' quando eles existem no período filtrado. O aviso 'inclui valores restritos' do RF06, regra 3, continua valendo para os relatórios."
- **DD-36 (13/11/2026):** desenho da F3. (a) D-F3 e D-F4 deixam de ser recomendação: contrato em `@app/core/contracts`, dinheiro como `number` inteiro em centavos. (b) TanStack Table e React Hook Form adotados; F0-3 fecha como "a base `@base-ui/react` serve" (1.9.0 tem dialog, alert-dialog, select, checkbox, popover, tabs, field, form); o ⚠️ do TanStack Table sai da F0-4. (c) Mídia do "ver origem" adiada para a E10 (F3-1) e itens da nota sem persistência (F3-2). (d) A F3 cria uma rota própria de opções de filtro; as leituras de cadastro da F6 não são antecipadas. (e) Correções do `painel.md`: sinal `CANAL_A_REVISAR` (RF22.R4), data de pagamento e pedidos entram na F3 e não na F13 (RF22, RF23, DD-02, DD-13), sem restauração em lote (RF24), contador é MVP e só lê (DD-03, RF23.CA04). (f) Texto do aviso de valores restritos na lista (RF22.Obs7).

## 1.6 Quem vê o quê (uma função só, no `core`)

`entryScopeFor(actor, userId, requestedUnitIds, activeUnitId)` devolve o recorte que **toda** consulta usa:

- `unitIds`: os pedidos no filtro, se todos estiverem nas unidades de acesso do ator; sem filtro, a unidade ativa do seletor (ou todas as de acesso, se o seletor estiver em "todas"). Unidade fora do acesso: erro, e a rota responde 403 `forbidden` sem dado (RF06.R5, RF22.R2).
- `ownerUserId`: o próprio usuário para o lançador, nulo para os demais (RF22.R3, CA03). O filtro "lançado por" enviado por um lançador é ignorado.
- `includeSensitive`: `can(actor, "entry:view", { categoryIsSensitive: true, isOwnEntry: true })` (dono, contador, gerente com VER_FOLHA).

Lançamento fora do recorte não existe para o chamador: lista e totais o omitem; detalhe, origem, edição, exclusão e restauração respondem **404 `not_found`** (não 403, para não revelar que existe). Mutação exige ainda `can(actor, ação, { unitId, isOwnEntry, categoryIsSensitive })` com o lançamento carregado; ao trocar categoria ou unidade na edição, o `can` vale para o valor antigo **e** para o novo.

Aviso de valores restritos (`hasRestricted`): verdadeiro quando existe lançamento sensível que casa com os filtros e o ator não pode ver sensíveis. Para o lançador é sempre falso (ele só vê os próprios).

## 1.7 API (todas com `requirePanelContext`, `requireTenantRoute`, `requirePermission`; escrita com `requireWritable`)

| Rota | Ação | Plano | Notas |
|---|---|---|---|
| `GET /api/entries` | `entry:view` | F3a | Filtros do RF22, `sort`, `dir`, `cursor`, `limit` (padrão 50, máx. 100). Não traz lixeira |
| `GET /api/entries/totals` | `entry:view` | F3a | Mesmos filtros; receitas, despesas, resultado, quantidade, `hasRestricted` |
| `GET /api/entries/options` | `entry:view` | F3a | Categorias (sem sensíveis para quem não vê), fornecedores, formas, canais, unidades de acesso, membros (vazio para lançador) |
| `GET /api/entries/:id` | `entry:view` | F3a | Detalhe com versões; aceita lançamento na lixeira (dentro dos 30 dias) |
| `GET /api/entries/:id/source` | `entry:view` | F3a | Canal, tipo, texto, transcrição, chave de acesso, quem e quando; `restricted` (RF25.Obs1); `mediaAvailable: false` |
| `PATCH /api/entries/:id` | `entry:edit` | F3b | `{ expectedVersion, patch, markReviewed }`; 409 `entry_stale` |
| `DELETE /api/entries/:id` | `entry:delete` | F3b | Corpo `{ reason? }` (até 200) |
| `POST /api/entries/:id/restore` | `entry:restore` | F3b | Só dentro de `restorable_until` |
| `POST /api/entries/batch/preview` | `entry:delete` | F3b | `{ ids }` → quantidade e soma, calculadas no servidor |
| `POST /api/entries/batch/delete` | `entry:delete` | F3b | Só dono e gerente (RF24.Obs3); tudo ou nada; até 100 ids |
| `GET /api/trash` | `entry:restore` | F3b | Filtros: período de exclusão, unidade, quem excluiu; cursor |

Erros: só `{ code }` (`not_found`, `forbidden`, `invalid_request`, `account_read_only`), com duas exceções documentadas: `422 { code: "invalid_entry", reason }` (`reason` é o código do erro de domínio, para a tela apontar o campo) e `409 { code: "entry_stale", current }` (`current` é o detalhe atual, que o chamador já pode ver; a tela monta a frase do RF23.Obs2 com o autor e a hora da última versão). `entry_stale` é distinto de `context_changed`, que continua tratado pelo `browser-client`.

**Regras resolvidas na API e no `core`, nunca na tela:**
- Canal de origem do lançamento = `channel` da versão 1 (`action = create`) em `entry_versions`.
- Busca livre (RF22.R5): se o texto vira um valor em reais, casa `amount_cents` exato; se tem 44 dígitos, casa a chave em `fiscal_documents` pela mensagem de origem; sempre casa descrição e nome do fornecedor (`ilike`, com `%` e `_` escapados).
- Período obrigatório, até 24 meses (RF22.R1), validado no contrato.
- Totais: receitas = soma do valor bruto das receitas; despesas = soma do valor bruto das despesas; resultado = receitas − despesas (**chamada minha**: o RF22.Obs2 não diz bruto ou líquido; o RF27 trata de líquido no dashboard).
- Cursor: texto opaco (base64url de `{ v, id }`); `v` de `created_at` vai como texto do Postgres com microssegundos, nunca via `Date`, para não repetir nem pular (RF22.CA04).
- Edição: data de competência futura até 60 dias contados de hoje no fuso da unidade (RF23.R1); quantidade obrigatória quando a categoria exige (RF12.R4); taxa só é recopiada da forma ou do canal quando um deles muda (RF23.Obs4, DE-18, reusando a lógica do canal); versão com canal `web` (RF23.Obs3).
- Fornecedor na edição: escolher um existente, limpar, ou digitar um nome novo, que a API associa ou cria pelo mesmo caminho do canal (RF12.R7, RF10) (**chamada minha**).
- "Marcar como revisado" junto de uma edição gera duas versões (alteração, depois revisão) na mesma gravação; sozinho, uma.
- Histórico: o servidor devolve, por versão, a lista de campos que mudaram com antes e depois, já com nomes no lugar de ids. Versão cujo antes ou depois está em categoria sensível vem como `restricted: true`, sem campos, para quem não vê sensíveis (**chamada minha**: cobre o lançamento que saiu de uma categoria sensível).
- Lixeira: mostra `deleted_at` não nulo com `restorable_until >= hoje`; fora disso o lançamento não aparece e restaurar responde 404.

## 1.8 Tela

- `/lancamentos`: barra de filtros (folha lateral no celular), totais do servidor com o aviso "Há valores restritos que não entram nestes totais.", tabela (TanStack Table, cabeçalhos de Data, Pagamento e Valor ordenáveis, seleção de linhas para dono e gerente) no desktop e cartões no celular, botão "Carregar mais". Filtros, `sort` e `dir` moram na URL (RF22.Obs1, CA01); o lançamento aberto também (`?entry=<id>`). Estados carregando, vazio (texto do RF22.Obs6) e erro com "Tentar de novo".
- Drawer do lançamento (o `Sheet` existente) com abas **Dados**, **Origem** e **Histórico**. Em F3a, Dados é leitura; em F3b ganha o formulário (React Hook Form com o schema do contrato), "Marcar como revisado", "Excluir" (diálogo com motivo opcional) e o aviso de conflito do RF23.Obs2 com "Recarregar".
- Origem: texto e transcrição como texto puro (RF25.R1, CA03), chave de acesso, quem enviou e quando; "Áudio e imagem ficam disponíveis em breve" quando a origem é mídia; "Contém informação restrita" sem conteúdo quando `restricted`.
- `/lancamentos/lixeira` (F3b): lista com filtros, "Restaurável até" e "Restaurar". Acesso por um botão no topo de Lançamentos, sem item de menu (**chamada minha**).
- Datas com `<input type="date">` (o valor já é `AAAA-MM-DD`); dinheiro com máscara brasileira e `parseBRLInput` do `core`; botões de editar, excluir e restaurar seguem `canEdit`, `canDelete` e `canRestore` que a API manda por lançamento (conforto; a API repete a checagem).
- Dados por React Query com `tenantKey(ctx, "entries", ...)`; lista com `useInfiniteQuery`.

## 1.9 Esclarecimentos da conferência do construtor

Respondidas pelo projeto:
- O lançador **não** vê lançamento sensível, nem o próprio: `includeSensitive` sai do `can` do `core`, que só libera dono, contador (leitura) e gerente com VER_FOLHA (RF06.R3).
- Quem altera o quê é a matriz 2.3 de `requisitos.md`: dono tudo; gerente nas suas unidades; lançador edita, exclui e restaura só os próprios; contador nada. Exclusão em lote só dono e gerente (RF24.Obs3).
- Campos editáveis são os do RF23 (inclui o tipo). Taxa em valor e líquido são sempre recalculados pelo `core`; as taxas copiadas só são trocadas quando forma ou canal muda.
- O período filtra a data de competência (`occurred_on`). `paid_on` nunca é nulo.
- Os totais **excluem** os sensíveis para quem não os vê; `hasRestricted` só diz que existem.
- Excluir e restaurar geram versão com canal `web` (RF24.Obs1). Isolamento entre empresas de `entry_versions` e `fiscal_documents` vem do RLS e é provado nos testes de integração.

Chamadas minhas (pequenas):
- Edição que leva o lançamento para categoria sensível ou unidade fora do alcance do ator: recusada inteira com 403 `forbidden`.
- A garantia de "não repetir nem pular" vale para lançamentos que não foram alterados durante a navegação (está no texto novo do RF22.Obs3).
- Lote: qualquer id fora do recorte, já excluído ou sem permissão derruba tudo com 404, sem dizer qual. Não há comparação com a pré-visualização; a resposta da exclusão devolve quantidade e soma.
- Só o `PATCH` exige `expectedVersion`. Edição sem diferença e sem "revisado" responde 422 (`NothingToChange`); "revisado" em lançamento sem sinais responde 200 sem gravar versão.
- Busca: OU entre valor, chave e texto, sempre dentro do recorte; texto de 44 dígitos não é tentado como valor.
- `source.restricted` é verdadeiro só quando outro lançamento da mesma mensagem está em categoria que o ator não vê; nesse caso não vão texto nem transcrição.
- Histórico mostra o nome atual do cadastro e o autor de cada versão a todos que veem o lançamento.
- "Restaurável até" compara datas (inclusive) com hoje no fuso da unidade; restaurar não revalida cadastro desativado.
- `?entry=<id>` inválido ou invisível: "Lançamento não encontrado", sem distinguir o motivo. A seleção do lote é limpa ao mudar filtro ou ordem e só existe na tabela do desktop.
- Filtro de unidade explícito prevalece sobre o seletor do topo, desde que dentro das unidades de acesso.

## 1.10 O que fica para quem constrói

Layout fino (espaçamentos, ícones, textos de rótulo não fixados aqui), divisão interna de componentes dentro de `features/entries`, e o SQL exato do leitor desde que passe nos testes de integração nomeados no plano.
