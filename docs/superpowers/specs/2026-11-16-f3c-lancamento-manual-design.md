# F3c Lançamento manual no painel (RF26): desenho

Aprovado pelo Luís em 16/11/2026, depois de um grill de duas rodadas e de uma revisão do desenho por um segundo modelo (Opus), que conferiu o código. O plano de execução ainda **não existe**: será gerado a partir deste desenho, depois da F3b. Decisão: **DD-37** em `docs/decisoes.md`. Requisitos 1.15.

## Contexto

O RF26 era Desejável, v1.1 (D-F6, DN-10). Passou ao MVP como etapa própria F3c, **depois da F3b** (edição, lixeira e lote), para reaproveitar o formulário (React Hook Form com o schema do contrato), `MoneyInput`, a regra de fornecedor novo por nome e o `can()` na escrita. O plano da F3b não muda, salvo a linha da B13 ("F3b feita, próxima F3c"). A F3c não depende da F6: usa `GET /api/entries/options`.

Fatos do código (conferidos em 16/11/2026): o `Channel` já tem `web`; `createEntry` só exige `inboundMessageId` quando o canal é `whatsapp`; `entries.inbound_message_id` aceita nulo e o CHECK de canal de `entry_versions` aceita `web`; `UNIQUE (inbound_message_id, position)` é NULLS DISTINCT, então vários lançamentos do painel convivem; `entry:create` já existe em `ACTIONS` e na matriz de permissões.

## 1.1 Intenção

Quem prefere o computador, ou tem notas acumuladas, lança no painel sem o WhatsApp, e o painel serve de entrada alternativa enquanto a E10 está travada pela Meta (`contingencia-canal.md`). Sucesso é o "Pronto quando": o dono lança três notas em sequência no celular e elas aparecem na lista com canal Painel e histórico.

## 1.2 Objetivos, não objetivos, anti-objetivos

**Objetivos:** RF26 (R1 a R5, Obs1 a Obs3, CA01 a CA08); RF12.R13 e DATA_ANTIGA no painel; RF25.Obs3 (origem sem mensagem); RF06 (`entry:create`, matriz 2.3 linha "Lançar no painel"); RF37 (conta somente leitura não grava); RNF02, RNF04.R3 e RNF11 na rota nova.

**Não objetivos:** sugestão de categoria e IA (pendência F3c-1); importação, planilha, OFX e XML (F13, RF31 e RF35); anexar foto ou XML; criar categoria, forma ou canal pelo formulário (F6); lançar em grade; limite de envio por minuto (F8); origem PAINEL no fornecedor (RF10.R5 não tem coluna; divergência da F6).

**Anti-objetivos:** a tela calcular taxa ou líquido; lançamento sensível, de outra unidade ou de outra empresa vazar pela resposta do `POST`, pela repetição ou pelo sinal de duplicidade; duplicar por duplo clique; `float`; categoria de outra empresa aceita; dado de tenant em `use cache` ou em chave de query sem `tenantKey`.

## 1.3 Restrições

- Regras inegociáveis do `CLAUDE.md` (1, 2, 3, 4, 5 já com a exceção do painel, 9), `apps/web/CLAUDE.md` e as regras de `.claude/rules/` (rota-de-tenant, e2e-painel, testes, dicionario-testes, tabela-nova, sensivel-falha-fechado, biome-escopo).
- Nenhuma dependência nova, nenhuma ação nova em `ACTIONS` (a matriz de 72 casos não muda), nenhuma tabela nova. Uma migration só com coluna e índice.
- Sem variável de ambiente nova.

## 1.4 Abordagens

1. **Rota nova `POST /api/entries` com gravação própria do painel em `packages/db`, regras puras em `packages/core` e formulário em `features/entries` (escolhida).** Segue o padrão da F3 (contrato Zod em `@app/core/contracts`, `withTenant`, `find` na resposta).
2. Reusar o `EntryStore.register` do canal: descartada, porque ele é feito para mensagem (grava `inboundMessageId`, `ai_usage`, pergunta de volta e nota fiscal).
3. Server Actions do Next: descartada, contraria o padrão da F2 (o navegador fala com `/api/*`).
4. Ordem: dentro da F3b ou antes dela foram descartadas (a F3b já é grande, e o formulário nasceria sem a edição). Adiar para a v1.1 foi descartado pelo Luís.

## 1.5 Decisões do grill (Luís, 16/11/2026)

1. Etapa própria F3c depois da F3b.
2. Sem sugestão de categoria no MVP; escolha manual.
3. Origem sem mensagem: a versão 1 com canal `web` (inclui editar a regra 5 do `CLAUDE.md`, feito).
4. Rota `/lancamentos/novo` com "Salvar e lançar outro".
5. Idempotência por tentativa mais sinal POSSIVEL_DUPLICIDADE, sem bloquear.
6. Futuro até 60 dias; mais de 60 dias no passado grava com DATA_ANTIGA; pagamento padrão = competência.
7. Taxa e líquido só depois de salvar, vindos do servidor.
8. Campos completos do RF12 para todos os papéis com `entry:create`.
9. Critério de duplicidade: o do código atual (valor e fornecedor, ou descrição e data), em uma função única para canal e painel.
10. Recorte dos candidatos de duplicidade: unidades de acesso, sem sensível invisível, incluindo colegas.

**Chamadas pequenas do desenho (padrão, o Luís pode reverter):** tipo × categoria e limpeza da descrição valem também na edição da F3b (uma linha a mais na B1); CPF na descrição é omitido em silêncio e a tela mostra a descrição salva; repetição de envio cujo lançamento ficou invisível responde 409 `already_submitted` sem dado; categoria sensível sem permissão responde 403, como a F3b.

## 1.6 Achados da revisão que mudam o desenho (para o construtor)

1. **Duplicidade:** o teste do canal está dentro de `buildDrafts` (`packages/core/src/entry/build-drafts.ts`, perto das linhas 171 a 178) e compara `inboundMessageId`; no painel os dois lados são nulos. Extrair `isPossibleDuplicate(candidato, recentes)` para o `core`, sem mudar o comportamento do canal (os testes de `buildDrafts` seguem verdes), excluindo da comparação só quando as **duas** mensagens não são nulas e são iguais. Mover a janela de 24 h (hoje `RECENT_WINDOW_MS` em `entry-handlers.ts`) para o `core`. `findRecentEntries` (`entry-store.ts`) olha a empresa inteira: no painel os candidatos vêm do recorte do ator (usar `sensitiveExpression`), últimas 24 h, fora da lixeira.
2. **Categoria sem chave composta:** `entries.category_id` aponta só para `categories.id` (categorias do sistema têm `tenant_id` nulo), então o banco aceitaria categoria de outra empresa. A API confere a categoria lendo o catálogo sob RLS (nulo ou da empresa, ativa); senão 422 `UnknownReference`, `field: categoryId`.
3. **Regras de criação que o `core` ainda não aplica:** tipo × categoria (hoje `validateFields` aceita receita com categoria de despesa), unidade inativa (RF04.R5) e limpeza da descrição (`sanitizeDescription` em `interpret.ts`, hoje só do canal; descrição vazia depois da limpeza é `DescriptionEmpty`).
4. **Lista fechada de unidade de medida** (RF12.R4: KG, G, L, ML, UN, DZ, CX, PCT, FD, SC, OUTRA) com uma constante `QUANTITY_UNITS` no `core`. Na edição (`contracts/entries.ts`) o campo hoje é texto livre; avisar a F3b. Nome de fornecedor novo: de 2 a 120 caracteres (RF10.R1), também na edição.
5. **`GET /api/entries/options`** ganha, como campos **opcionais** do contrato (sem quebrar a F3a): `active` em categorias, formas, canais e unidades; `defaultSalesChannelId` e `timezone` nas unidades. Se a F3b já tiver resolvido (pendência F3-5), reusar.
6. **Fuso:** "hoje" é `clock.today(unidade.timezone)` da unidade **escolhida**, lida na mesma transação. Teste: 23h30 em America/Sao_Paulo com unidade em America/Manaus.

## 1.7 Contrato (`@app/core/contracts`)

`entryCreateBodySchema` (`strictObject`): `clientRequestId: uuid`; `type`; `occurredOn`; `paidOn` opcional; `description` 1 a 200 (trim); `amountCents` inteiro maior que 0; `categoryId` e `unitId`; `supplier`: `{ id }`, `{ name }` (2 a 120) ou nulo; `paymentMethodId` e `salesChannelId` ou nulo; `orders` inteiro maior que 0 ou nulo; `quantity` positivo ou nulo; `quantityUnit` do enum ou nulo. Refinamentos: receita exige canal; despesa não leva canal nem pedidos; quantidade e unidade de medida andam juntas.

Resposta: `entryDetailSchema` (o mesmo do `GET /api/entries/:id`): **201** criado, **200** repetição. Erros só `{ code }`, com `422 { code: "invalid_entry", reason, field? }` (`field` de uma lista fechada de nomes do formulário, compatível com a F3b) e o código novo `409 already_submitted`.

## 1.8 Rota e fluxo da gravação

`POST /api/entries`: `requirePanelContext`, `requireTenantRoute`, `requireEntryAction("entry:create")`, `requireWritable()`. Corpo inválido: 400 `invalid_request`. Dentro de **um** `withTenant`:

1. Procura `(created_by, client_request_id)`. Se existe: `find` com o recorte do ator e responde 200; se o `find` não enxerga (reclassificado, unidade tirada, lixeira vencida), 409 `already_submitted` sem dado.
2. Carrega a unidade (status e fuso). Fora de `actor.units`: 403 `forbidden` (RF06.R5).
3. Carrega o catálogo sob RLS (categoria com `kind`, `status`, `is_sensitive`, `requires_quantity`).
4. `can(actor, "entry:create", { unitId, categoryIsSensitive })`; recusado: 403, nada gravado.
5. Resolve o fornecedor por nome pela mesma função da F3b.
6. `preparePanelCreate` (core): limpeza da descrição, datas, hoje + 60 (`PANEL_FUTURE_DAYS`, da B1 da F3b) senão `DateTooFarAhead`, `old_date` quando passou de `OLD_DATE_DAYS`, categoria ativa e compatível (`CategoryTypeMismatch`, `UnknownReference`), unidade ativa (`UnitInactive`), forma e canal ativos, quantidade obrigatória (`QuantityRequired`), taxa por `resolveFeeRule` só em receita e `NO_FEE` em despesa. Sem `category_to_review` nem `channel_to_review`: a escolha foi explícita.
7. Candidatos de duplicidade no recorte e `isPossibleDuplicate`.
8. `createEntry(draft, { channel: "web", actorId, at: clock.now(), id: uuidv7 })`.
9. Insere fornecedor, lançamento e versão 1; relê por `entryReader.find` e valida com `entryDetailSchema.parse` (regras 4 e 5 de `sensivel-falha-fechado.md`).

Corrida com a mesma chave: o 23505 de `entries_client_request_unique` desfaz a transação inteira (inclusive o fornecedor novo) e uma transação nova relê e responde 200. Nada de valor ou descrição em log.

## 1.9 Banco

Migration (a próxima livre depois da F3b): `ALTER TABLE entries ADD COLUMN client_request_id uuid`; `CREATE UNIQUE INDEX entries_client_request_unique ON entries (tenant_id, created_by, client_request_id) WHERE client_request_id IS NOT NULL`; `CHECK (client_request_id IS NULL OR inbound_message_id IS NULL)` chamado `entries_origin_exclusive_check`. A chave fica fora do `Entry` de domínio (não vai para o retrato das versões) e **nunca** serve de `entries.id`: uma chave primária global escolhida pelo navegador deixaria descobrir, pelo erro, ids de outra empresa. Sem tabela nova: `tabela-nova.md` não se aplica, e a coluna é registrada em `arquitetura.md`.

## 1.10 Tela

- `/lancamentos/novo` com `PageGuard action="entry:create"` e conta gravável (RF37); entra em `APP_ROUTES`. Botão "Novo lançamento" no topo da lista e no estado vazio, só com `entry:create` **e** `accountAllows(accountStatus, role).write` (`allowedActions` não considera a situação da conta).
- Uma coluna, nesta ordem: Tipo (Despesa/Receita); Valor (`MoneyInput`, `inputmode="decimal"`); Descrição; Data de competência (padrão hoje); Categoria (só ativas e compatíveis com o tipo); Unidade (padrão a do seletor; vazia se "todas"; já escolhida se só há uma); Fornecedor (combobox com "Usar 'X' como novo fornecedor"); Forma de pagamento; só em receita: Canal (padrão o da unidade, obrigatório) e Pedidos; quando a categoria exige, Quantidade e Unidade de medida; Data de pagamento (acompanha a competência enquanto o usuário não mexer).
- Trocar o tipo limpa a categoria incompatível; virar despesa limpa canal e pedidos.
- "Salvar" vai para `/lancamentos?entry=<id>` (a gaveta mostra taxa e líquido do servidor). "Salvar e lançar outro" mantém Tipo, Data de competência e Unidade, a data de pagamento volta a acompanhar a competência, limpa o resto, gera chave nova, põe o foco em Valor e mostra numa região `role="status"` (`aria-live`) "Despesa de R$ 450,00 salva (líquido R$ 450,00)" com valores **do servidor** e o link "Abrir"; com `possible_duplicate` avisa "Parece repetido: já existe um lançamento igual nas últimas 24 h"; com `old_date`, "Data com mais de 60 dias". Botões desativados durante o envio.
- Erros: o 422 aponta o campo por `field` ou `reason`. RF26.CA01: sem valor, "Informe o valor." no campo e nada é enviado.
- Celular: uma coluna, botões no fim, sem rolagem horizontal. Sem toast nem calendário novos. Troca de empresa ou unidade em outra aba (`context_changed`) não pode perder o que foi digitado (mesmo cuidado da B9 da F3b).
- Aba Origem para `originChannel === "web"`: "Lançado manualmente no painel por X em dd/mm/aaaa hh:mm", usando `createdBy` e `createdAt` que já vêm no item e no detalhe (a API de origem continua devolvendo `kind: "none"`).

## 1.11 Permissões e sensível

`entry:create` e a matriz de 72 casos não mudam (linha nova na tabela 2.3 do `requisitos.md`). Lançador só nas unidades de acesso; categoria sensível só para dono e gerente com VER_FOLHA; contador e conta somente leitura recusados. Linha nova na `ROUTE_MATRIX`: `POST /api/entries`, com dono, gerente, gerente sem folha e lançador em 201; contador em 403; sessão restrita em 401; conta somente leitura em 403 (`requireWritable` antes do corpo); lançador sem painel em 401; a `body(fixture)` gera chave nova a cada chamada.

## 1.12 O que não se aplica ao painel (RF12)

RF15 (pergunta de volta) vira validação no campo; RF16 (confirmação por WhatsApp) vira mensagem na tela; RF12.R6 (IA sugere categoria), R17 a R20 (`ai_usage`) e R23 (pergunta de investimento) saem; RF11 e RF21 não se aplicam.

## 1.13 Testes esperados

- **Core** (`panel-create.test.ts`): competência hoje + 60 aceita e +61 recusada no fuso da unidade; mais de 60 dias atrás grava com DATA_ANTIGA; receita com categoria de despesa recusada; receita sem canal recusada; categoria que exige quantidade sem quantidade recusada; descrição com CPF gravada sem o CPF; taxa da receita vem da forma, canal aplicativo substitui (P06); despesa nunca tem taxa. (`duplicate.test.ts`): dois lançamentos do painel sem mensagem se reconhecem; mesma mensagem não conta; os casos de `buildDrafts` seguem verdes.
- **Integração db:** dois lançamentos do painel sem mensagem não colidem; mesma chave do mesmo usuário colide e de outro não; CHECK recusa chave junto com mensagem; candidatos de duplicidade excluem sensível invisível e outra unidade.
- **API** (`entries-panel.int.test.ts`): cria com 201, versão 1 com canal `web` e origem sem mensagem; duplo envio grava um só e devolve 200 com o mesmo id; corrida de duas requisições com a mesma chave grava um só; repetição de lançamento hoje invisível responde 409 sem dado; gerente sem VER_FOLHA e lançador com categoria sensível recebem 403 e nada é gravado; lançador em unidade fora do acesso recebe 403; categoria de outra empresa responde 422; unidade inativa responde 422; contador e conta somente leitura recebem 403; outra empresa não vê o lançamento; sem `Origin` responde 403; linha na `ROUTE_MATRIX`; filtro `originChannel=web` funciona.
- **Web:** sem valor a gravação é bloqueada com mensagem no campo (CA01); "Salvar e lançar outro" mantém tipo, data e unidade e limpa o resto (CA08); a mensagem de sucesso mostra o líquido do servidor (CA07); duplo clique envia uma vez com a mesma chave; contador e conta somente leitura não veem o botão; trocar para despesa limpa canal e pedidos; aba Origem para o canal web.
- **E2E** (`entries-create.spec.ts`, Desktop Chrome e Pixel 7): criar e ver na lista com canal "Painel" e no histórico (CA02); lançar em sequência; sem rolagem horizontal (`scrollWidth <= clientWidth`); contador sem botão. A API falsa ganha `POST /api/entries` com repetição.

## 1.14 Tarefas, estimativa e riscos

Tamanho M, cerca de 60% da F3b: 13 tarefas, 5 críticas.

| Ordem | Tarefa | Classe | Depende de |
|---|---|---|---|
| C0 | Plano de execução a partir deste desenho | NATIVA | F3b feita |
| C1 | Core: `isPossibleDuplicate` extraído, canal verde | CRÍTICA | |
| C2 | Core: `preparePanelCreate`, `QUANTITY_UNITS`, erros novos | CRÍTICA | B1 da F3b |
| C3 | Contrato: corpo, 422 com `field`, campos de opções | CRÍTICA | C2 |
| C4 | Migration e gravação do painel no db; candidatos de duplicidade no recorte | CRÍTICA | C3 |
| C5 | `POST /api/entries`, `ROUTE_MATRIX`, integração | CRÍTICA | C4 |
| C6 | Opções com `active`, canal padrão e fuso (se a F3b não fez) | NATIVA | C3 |
| C7 | Cliente web e hook de criação (invalida `tenantKey(ctx, "entries")`) | NATIVA | C5 |
| C8 | API falsa do E2E: `POST` | HAIKU | C3 |
| C9 | Formulário e página `/lancamentos/novo`, botão na lista | NATIVA | C7 |
| C10 | Aba Origem para o canal web | NATIVA | |
| C11 | E2E | NATIVA | C8, C9 |
| C12 | Fechamento (planos, `andamento.md`, `pendencias.md`, `dicionario-testes.md`, propostas) | NATIVA | tudo |

**Riscos:** a F3b ainda não decidiu o passo 0(c) da B2 (onde fica a gravação do painel); a extração da duplicidade mexe no canal (os evals não mudam, os testes do canal precisam ficar verdes); o critério de duplicidade pode ser mudado depois pelo Matheus (o texto do RF12.R13 foi alinhado ao código). **Custo de adiar:** baixo para o código, porque nada depende da F3c; alto para o produto se a Meta seguir travando a E10.

## 1.15 O que fica para quem constrói

Layout fino, divisão de componentes dentro de `features/entries`, nomes internos de funções e o SQL exato dos candidatos de duplicidade, desde que passem nos testes nomeados.

## 1.16 Propostas para o fechamento da etapa (não criadas)

- Regra `.claude/rules/escrita-idempotente.md` (para `apps/api/src/http/**` e `packages/db/src/**`): escrita disparada pelo navegador leva chave por tentativa, índice único parcial por empresa e autor, o 23505 vira releitura em transação nova, a resposta da repetição passa pelo mesmo `find` com recorte, e a chave nunca é chave primária.
- Acréscimo em `sensivel-falha-fechado.md`, item 4: sinais calculados contra outros lançamentos (duplicidade) também levam dado; o candidato respeita o recorte.
- Acréscimo em `tabela-nova.md`: chave estrangeira simples para tabela com `tenant_id` nulo (categorias) não protege entre empresas; conferir a referência lendo sob RLS.
- Skill `nova-rota-de-escrita-de-lancamento`: guardas na ordem, `withTenant` único, `find` na resposta, linha na `ROUTE_MATRIX`, teste sem `Origin`, teste com duas empresas, API falsa e E2E.
- Hook `PostToolUse` em `packages/db/migrations/*.sql`: lembrete do checklist de `tabela-nova.md` quando aparecer `ADD COLUMN` ou `CREATE TABLE`.
