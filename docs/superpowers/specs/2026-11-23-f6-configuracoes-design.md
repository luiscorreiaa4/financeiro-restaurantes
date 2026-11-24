# F6: Configurações, desenho

> Etapa F6 de `docs/planos/painel.md`, dividida em F6a, F6b e F6c. Planos: `plans/2026-11-23-f6a-catalogos-taxas.md`, `plans/2026-11-23-f6b-colaboradores.md`, `plans/2026-11-23-f6c-categorias-fornecedores.md`.

## Contexto e porquê

A F6 é a etapa em que o dono sai do cadastro mínimo do autocadastro (F1b) e configura a empresa. Sem ela, ele não consegue: cadastrar um funcionário que lance pelo WhatsApp ("Pronto quando" do `painel.md`), informar as taxas da maquininha (o líquido de toda receita sai errado), dizer o canal padrão de cada unidade (DD-08) nem arrumar fornecedores duplicados que a IA cria. O banco e o domínio já vieram da E11 (`units`, `memberships` + `membership_units`, `categories`, `payment_methods`, `sales_channels`, `suppliers`, `validateUnit`, `validateSubcategory`, `validateAccess`, `ensureActiveOwner`, `can()` com `catalog:*` e `user:*`). Faltam a API de gestão, as telas, a mesclagem de fornecedor, a reaplicação de taxa e o realinhamento das categorias do sistema ao requisito.

Requisitos: RF04, RF05, RF07, RF08, RF09, RF10, RF01.Obs3 e RF04.R6; matriz 2.3 e RF06.R2, R3, R5 e R6. Critérios: RF04.CA01–CA05, RF05.CA01–CA09, RF07.CA01–CA05, RF08.CA01–CA05, RF09.CA01–CA03, RF10.CA01–CA03. Pendências herdadas: F2-4 (encerrar sessões), F2-2 (reativar unidade pela tela), aceite de convite (pós-F2).

## Decisões do Luís nesta sessão

1. **Três subetapas**, um desenho e três planos: **F6a** formas, canais, unidades, assistente inicial e reaplicação de taxa; **F6b** colaboradores; **F6c** realinhamento das categorias do sistema, subcategorias e fornecedores com mesclagem.
2. **"Aplicar a nova taxa a um período passado" (RF08, Alteração) entra na F6a**, como job em fila.
3. **Categorias do sistema realinhadas ao RF07.Obs2 (P01) e ao DD-08 na F6c** ("Vendas" única, grupos do RF07.R5), com reclassificação dos dados existentes e evals.
4. **Gerente mescla fornecedores sem ver o que está fora do recorte** (RF10.Obs1 ao pé da letra): todos os lançamentos da empresa passam ao destino; a prévia e o total gasto que ele vê respeitam unidades e folha.
5. **Um módulo por cadastro** (não CRUD genérico); formas de pagamento são o molde.

## Objetivos, não objetivos, antiobjetivos

- **Objetivos:** cada cadastro com lista, busca, filtros, criar, editar, inativar e reativar no papel certo; regras no `core` com teste; API sob RLS com teste de duas empresas e linha na `ROUTE_MATRIX`; telas que funcionam no celular.
- **Não objetivos:** convite de contador com aviso de folha e lista multiempresa (F13, DD-33); limites de unidades e colaboradores por plano (F9, P03); troca do próprio e-mail (F1c-4, segue aberta); fuso da unidade na lixeira e no período (F3-5); criar categoria, forma ou canal pelo formulário de lançamento.
- **Antiobjetivos (falha mesmo funcionando):** o gerente ou o contador conseguir gravar qualquer cadastro pela API; categoria sensível ou valor de folha vazar pela lista de categorias, pelo total gasto do fornecedor ou pela prévia da mesclagem; telefone completo ou e-mail chegarem ao gerente; mudar uma taxa recalcular lançamentos antigos sem o dono pedir; o painel calcular dinheiro.

## Abordagens consideradas

- **A. Um módulo por cadastro (escolhida).** Rota, validação no `core`, repositório no `db`, contrato e tela por cadastro; helpers comuns só para nome normalizado, apelidos e status. Mais arquivos, cada um simples e revisável; o primeiro serve de molde para o Haiku.
- **B. CRUD genérico por fábrica.** Menos código, mas as regras específicas (cartão padrão, última unidade ativa, herança, mesclagem) viram ganchos difíceis de revisar.
- **C. Server Actions do Next.** Fora: a autorização real é da API (`apps/web/CLAUDE.md`).

## Desenho comum às três subetapas

**Rotas.** Gestão sob **`/api/settings/<cadastro>`** (`units`, `payment-methods`, `sales-channels`, `categories`, `suppliers`, `members`, `fee-reapplications`). O `GET /api/units` da F2 continua servindo só ao seletor de contexto. Guardas na ordem de `.claude/rules/rota-de-tenant.md`: `requirePanelContext`, `requireTenantRoute()`, `requirePermission(<ação>)` e, na escrita, `requireWritable()`. Erros só com `{ code }`; validação de domínio responde 422 `{ code, field, reason }`.

**Permissões** (`packages/core/src/permissions/permissions.ts`), conferidas contra a matriz 2.3 (RF06.CA06):

| Ação | Dono | Gerente | Lançador | Contador |
|---|---|---|---|---|
| `catalog:view` (unidades, formas, canais, categorias) | ✓ | ✓ | – | ✓ |
| `catalog:manage` | ✓ | – | – | – |
| `user:view` (colaboradores) | ✓ | ✓ (suas unidades, mascarado) | – | – |
| `user:manage` | ✓ | – | – | – |
| **`supplier:view`** (nova) | ✓ | ✓ | – | ✓ |
| **`supplier:manage`** (nova: editar e mesclar, RF10.Obs1) | ✓ | ✓ | – | – |

**Contrato.** `packages/core/src/contracts/settings.ts`, exportado por `@app/core/contracts`, todos os objetos `.strict()`. O web não redefine schema.

**Domínio.** Validadores em `packages/core/src/registry/` (existentes `unit.ts`, `category.ts`; novos `payment-method.ts`, `sales-channel.ts`, `supplier.ts`, `member.ts`, `names.ts`). `names.ts` reúne o que é comum: nome normalizado (reusa `normalizeName` de `entry/catalog.ts`), validação de apelidos (quantidade e tamanho) e colisão de nome/apelido contra os existentes da empresa.

**Histórico (RF04, RF05, RF07, RF10 "Alteração", RF06.R6).** Toda escrita de cadastro grava uma linha em `audit_log` na mesma transação: `action` (`unit.update`, `member.deactivate`…), `target` (id), `metadata` `{ before, after }` só com os campos que mudaram. Celular entra mascarado (4 últimos dígitos). Sem tabela nova de histórico.

**Concorrência na edição.** Última gravação vence (só o dono edita catálogo; colisão real é improvável). Exceções com regra própria: última unidade ativa, último dono ativo, cartão padrão único e mesclagem, todas conferidas dentro da transação com `SELECT ... FOR UPDATE`.

**Repetição de envio (duplo clique, rede ruim).** Criação de cadastro é protegida pela chave natural: nome único na empresa (unidade, forma, canal, subcategoria entre irmãs) e telefone único por empresa (colaborador). A repetição responde 409 `name_taken` / `already_member` e a tela mostra "já existe" com link para abrir. A reaplicação de taxa, que é job, usa `client_request_id` como manda `.claude/rules/escrita-idempotente.md`.

**Telas.** `app/(app)/configuracoes/` vira um índice com cartões por cadastro (só os que `allowedActions` libera) e subrotas: `unidades`, `formas-de-pagamento`, `canais-de-venda`, `categorias`, `fornecedores`, `colaboradores`, `primeiros-passos`. Cada feature em `apps/web/features/settings/<cadastro>/` com `*-api.ts`, `use-*.ts`, lista e formulário (React Hook Form, `select` nativo, trava com `useRef`). Para quem só consulta, o formulário abre somente leitura, sem botões de gravar. Lista vira cartões no celular. Toda página nova entra em `APP_ROUTES`. API falsa em `apps/web/e2e/fake-settings.mjs`.

## F6a — formas, canais, unidades, assistente inicial e reaplicação de taxa

**Formas de pagamento (RF08).** Lista com filtro por tipo e status. Criar e editar nome, tipo, taxa percentual (entrada em "3,20 %", gravada em pontos-base, 0 a 10000; CA05), taxa fixa (`MoneyInput`, centavos), apelidos (até 10), status e "forma de cartão padrão". A forma de cartão padrão só pode ser de tipo crédito ou débito; marcar uma desmarca a anterior na mesma transação; inativar a forma de cartão padrão é recusado (`default_card_inactive`), assim como desmarcá-la sem escolher outra. **Pré-visualização do líquido** (RF08.Obs3) calculada pelo servidor: `GET /api/settings/fee-preview?feePercentBp=&feeFixedCents=` devolve a taxa e o líquido de uma venda de R$ 100,00 com `computeFee`; a tela mostra "Venda de R$ 100,00 rende R$ 96,80 líquidos". Mudar a taxa não altera lançamentos (CA03).

**Canais de venda (RF09).** Igual às formas, sem taxa fixa e sem cartão padrão; comissão em pontos-base. No tipo APLICATIVO, a tela explica a regra provisória P06 ("a comissão substitui a taxa da forma de pagamento"). Inativar um canal que é o padrão de alguma unidade é recusado (`channel_is_unit_default`).

**"Não informada" e "Não informado".** Continuam existindo (RF08.Obs4 e lançamentos antigos), identificados pela constante de nome de `SIGNUP_DEFAULTS`. Aparecem na lista com selo "do sistema", somente leitura: não se edita, não se inativa, não se escolhe como cartão padrão nem como canal padrão; taxa sempre zero. Isto resolve o conflito apontado em RF08.Obs2/RF09.Obs2 (P07): nota nova no `requisitos.md`.

**Unidades (RF04).** Lista com filtro por status e busca por nome ou apelido. Criar e editar nome, apelidos (até 5, até 30 caracteres, únicos na empresa entre nomes e apelidos), CNPJ opcional, UF e município (lista IBGE, DD-29, reusa a do autocadastro), fuso sugerido pela UF (`timezoneForUf`, editável) e canal padrão da receita (só canal ativo e que não seja "Não informado"). Inativar recusa a última ativa (`ensureNotLastActiveUnit`, CA02); reativar sempre permitido. Unidade criada aparece para quem tem TODAS (RF04.Obs3, já dado por `all_units`); o seletor de contexto recarrega a lista. Trocar o fuso ou o canal padrão não altera lançamentos.

**Reativar unidade no acesso restrito (F2-2).** Em `/acesso-restrito`, o dono que ficou sem unidade ativa vê as unidades inativas das empresas em que é dono, com "Reativar". Rota própria `POST /api/restricted/units/:id/reactivate`, aceita sessão restrita, confere pelo `app_auth` que o usuário é dono ativo da empresa da unidade, grava pelo `app` sob `withTenant` e devolve o usuário à entrada do painel.

**Reaplicação de taxa (RF08 e RF09, Alteração).** Na tela da forma ou do canal, o dono escolhe "Aplicar a taxa atual a lançamentos passados" e um período (data do lançamento, todas as unidades).
1. **Prévia** (`POST /api/settings/fee-reapplications/preview`): o servidor conta as receitas não excluídas do alvo no período cuja taxa mudaria com a regra atual (`resolveFeeRule` com a forma e o canal de cada lançamento; P06 decide quem manda) e soma a diferença do líquido. A tela mostra "312 lançamentos; o líquido muda em −R$ 1.234,56".
2. **Confirmação** (`POST /api/settings/fee-reapplications`, com `clientRequestId`): grava uma linha em `fee_reapplications` (tabela nova) com o alvo, o período, a taxa vista na prévia e o autor, e enfileira o job `fee-reapply` (pg-boss).
3. **Job** (`novo-worker-pgboss`): confere que a taxa do alvo ainda é a da prévia (senão termina `failed` com `rate_changed`, nada gravado); percorre os lançamentos em lotes de 200 com `editEntry(entry, { feePercentBp, feeFixedCents }, { channel: "web", actorId: autor })` e `entryStore.applyChanges` (guarda de versão); lançamento que mudou no meio é relido uma vez e, se ainda divergir, conta como "pulado". Idempotente: rodar de novo não gera versão (o `editEntry` devolve `NothingToChange`). Termina `done` com `updated` e `skipped`.
4. **Tela:** a última reaplicação do alvo com o estado; atualiza por consulta periódica enquanto não termina, como na F5.

**Assistente inicial (RF01.Obs3, RF04.R6).** `/bem-vindo` ganha "Configurar agora", que leva a `/configuracoes/primeiros-passos`: (1) canal padrão de cada unidade (sugestão Salão), (2) taxas das formas, com a pré-visualização, (3) colaboradores (a F6a mostra o passo desabilitado com "em breve"; a F6b o liga). Pode pular qualquer passo; sem estado salvo de "assistente concluído".

## F6b — colaboradores (RF05)

**Nome por empresa.** Coluna nova `memberships.display_name` (nulo = usa `users.name`). RF05.R2: o nome exibido é o que o dono informou, e o mesmo número pode estar em outra empresa com outro nome. Os leitores de "lançado por" (lista, detalhe, histórico, exportação, opções de filtro) passam a usar `coalesce(m.display_name, u.name)` da empresa do lançamento.

**Lista.** `GET /api/settings/members` com busca por nome e final do celular, filtros por papel, unidade e situação. Dono vê todos, com celular mascarado na lista e completo no detalhe, e e-mail. Gerente vê só quem tem acesso a alguma das suas unidades (TODAS conta), com celular mascarado e sem e-mail (RF05.CA08). Contador e lançador não acessam (403).

**Cadastrar (dono).** Nome (2–120), celular (normalizado com `normalizeBrazilianPhone`; com e sem 9º dígito são o mesmo, CA01; fora do Brasil e o número do produto são recusados), e-mail (obrigatório só com painel, CA03), papel DONO, GERENTE ou LANCADOR (o contador é convidado na F13), unidades de acesso (TODAS ou lista), unidade padrão (entre as de acesso, CA04; automática com uma só), acesso ao painel (padrão Não para lançador) e permissões adicionais válidas para o papel (`PERMISSIONS_BY_ROLE`). Validação por `validateAccess`.
- **Usuário global.** `users` não tem `tenant_id` e o papel `app` não grava nele. Um repositório novo pelo `app_auth` acha o usuário pelos candidatos do telefone ou cria um novo (nome, telefone E.164 com 9º dígito, e-mail). Número de outra empresa: só cria o vínculo, sem revelar nada (CA02). Se o usuário achado já tem outro e-mail, ou o e-mail informado é de outra pessoa, recusa com 422 `contact_conflict` e texto neutro ("Não foi possível usar esse celular com esse e-mail; confira com o colaborador"). Depois, o vínculo é gravado pelo `app` sob `withTenant`, com `status = invited`, `invited_by`, `invited_at` e auditoria. Usuário criado sem vínculo (falha entre os dois passos) é inofensivo: sem vínculo ele é desconhecido; a nova tentativa o reaproveita.
- **Resposta** traz o texto pronto e o link `https://wa.me/<número do produto>?text=<texto>` (RF05.Obs2), mostrados num diálogo com "Copiar". Com painel Sim, sai também o e-mail de convite pela porta `EmailSender` (falsa até a F8), depois da gravação; falha no envio não desfaz o cadastro.

**Editar (dono).** Nome, papel, unidades, unidade padrão, painel, permissões. `ensureActiveOwner` garante um dono ativo (CA06; para transferir, promove o outro antes). **Troca de celular** pede confirmação na tela ("o número antigo deixa de ser reconhecido") e só é aceita se o usuário não tem vínculo em outra empresa; senão 422 `phone_shared` com o texto "desative e cadastre de novo com o número novo". Número já usado por outra pessoa: 422 `phone_in_use`. Troca de e-mail segue a mesma regra de vínculo único.

**Desativar e reativar.** `POST .../:id/deactivate` grava `status = deactivated` e `deactivated_at`; o canal já trata como desconhecido (CA05). `POST .../:id/reactivate` volta a `active` se a pessoa já registrou opt-in, senão a `invited`. O dono não desativa a si mesmo se for o último dono.

**Encerrar sessões (F2-4, CA09).** Rebaixar papel, retirar unidades, retirar painel, retirar permissão ou desativar apaga as sessões do painel do usuário com `authStore.deleteSessionsExcept(userId, null)`. As sessões são por usuário, então ele sai de todas as empresas e entra de novo (custo aceito: é raro e o login por código é rápido). Função pura `isAccessReduction(before, after)` no `core` decide.

**Convite aceito.** Continua como hoje: CONVIDADO vira ATIVO na primeira mensagem, com o opt-in (CA07, já feito no canal). O painel já aceita vínculo convidado com painel liberado (filtra só `deactivated_at`).

**Assistente.** O passo 3 de `/configuracoes/primeiros-passos` passa a abrir o cadastro de colaborador.

## F6c — categorias do sistema, subcategorias e fornecedores

**Realinhamento das categorias do sistema (decisão 3).** `SYSTEM_CATEGORIES` passa a ser a lista do RF07.Obs2, todas no primeiro nível (o segundo nível é só da empresa, RF07.R2), com tipo, natureza e grupo do DRE do RF07.R5, inclusive DEDUCAO e INVESTIMENTO. Um script administrativo, idempotente, reclassifica os lançamentos das categorias antigas para as novas por uma tabela de-para fixa (Salão, Delivery e Balcão → Vendas; Insumos → Mercearia; Folha de pagamento → Salários; Internet → Internet e telefone; Impostos e taxas → Impostos sobre faturamento; Descartáveis → Embalagens e descartáveis; mesmo nome → mesmo nome), gerando versão com canal `system`, e inativa as antigas. Prompt e evals da extração acompanham, e a taxa de acerto não pode cair.

**Subcategorias (RF07).** Árvore com busca por nome e palavra de apoio, filtros por tipo e status. As do sistema ficam somente leitura (CA01). O dono cria a subcategoria sob uma categoria do sistema (`validateSubcategory`: herda tipo, grupo, sensível e exige quantidade, CA02 e CA03), edita nome, natureza (só despesa), palavras de apoio (até 30, até 40 caracteres) e status. Trocar a categoria pai é recusado. Nome único entre irmãs, comparado sem caixa nem acento. Gerente sem VER_FOLHA e lançador não recebem categorias sensíveis (regra `sensivel-falha-fechado.md`); o contador recebe (DD-04). Inativa some das opções de lançamento e da IA (CA04, já pelo `status`).

**Fornecedores (RF10).** Migration: `status` (ativo/inativo), `merged_into_id` (chave composta para `suppliers`), `origin` (`message`, `invoice`, `panel`, `import`; nulo nos antigos) e índice único parcial de documento por empresa. O índice de nome passa a valer só para fornecedores não mesclados. Validação de CPF nova no `core` (`isValidCpf`); CNPJ reusa `isValidCnpj`. Os pontos de criação passam a gravar a origem (canal: `message`; painel F3c: `panel`).
- **Lista** com busca por nome, apelido ou documento, total gasto e data da última compra no período (padrão: mês corrente), ambos calculados pelo banco **no recorte do ator** (unidades e folha). CPF mascarado para quem não é dono nem tem EXPORTAR_DADOS (RF10.R2, CA03). Fornecedores mesclados não aparecem; inativos aparecem com filtro.
- **Editar** (dono e gerente): nome, documento, apelidos (até 10), status.
- **Mesclar** (dono e gerente): escolhe origem e destino; prévia com a quantidade de lançamentos que o ator vê e o aviso "lançamentos que você não vê também passam para o destino". Numa transação: trava os dois, move todos os lançamentos da origem (inclusive da lixeira) para o destino com versão nova cada um (CA02), soma os apelidos mais o nome da origem (acima de 10, 422 `aliases_overflow`), leva o documento se o destino não tem (dois documentos diferentes: 422 `document_conflict`), marca a origem como inativa e mesclada, e audita. Síncrono.
- **Busca do canal e do painel** (`findSupplier`) ignora fornecedor mesclado; o nome antigo chega ao destino pelo apelido.

## Constantes e valores (copiados do requisito)

Unidade: nome 2–60; apelidos ≤ 5, ≤ 30 caracteres. Colaborador: nome 2–120. Categoria: nome 2–60; palavras de apoio ≤ 30, ≤ 40 caracteres; 2 níveis. Forma e canal: nome 2–40; apelidos ≤ 10; taxa 0–10000 bp; taxa fixa ≥ 0 centavos. Fornecedor: nome 2–120; apelidos ≤ 10. Taxa: `round_half_up(bruto × bp ÷ 10000) + fixa`, limitada ao bruto (`computeFee`). Exemplos de teste: 320 bp sobre 10000 → 320/9680 (RF08.CA01); 325 bp sobre 1010 → 33 (CA02); iFood 2300 bp sobre 20000 → 4600/15400 (RF09.CA01).

## Chamadas minhas (respostas à conferência do construtor; conferir)

1. **Rotas em `/api/settings/*`**, não `/api/units` etc. como lista o `painel.md` (o `GET /api/units` da F2 já serve ao seletor).
2. **Repetição de envio pela chave natural** (nome/telefone → 409), sem `client_request_id` nos cadastros; só a reaplicação de taxa usa a regra `escrita-idempotente.md`.
3. **Histórico só em `audit_log`, sem tela de leitura nesta etapa.** Metadados: celular com os 4 últimos dígitos, e-mail mascarado (`f•••@dominio`), CPF mascarado, CNPJ inteiro. A tela de histórico de cadastro fica como pendência (`andamento.md`).
4. **Rota restrita de reativação:** o tenant vem da própria unidade, lida pelo `app_auth` (`units_auth_select` já existe), junto com a conferência de vínculo de dono ativo nessa empresa; a gravação é pelo `app` em `withTenant(tenantIdDaUnidade)`. Não passa pelos guardas de contexto (a sessão é restrita por definição); tem teste próprio de outra empresa e de não dono.
5. **`users` pelo `app_auth`:** o papel já insere (autocadastro) e atualiza (perfil). Passo ⚠️ na F6b confere o `GRANT` de colunas (`phone_e164`, `email`); plano B: migration com `GRANT UPDATE (phone_e164, email) ON users TO app_auth`.
6. **Realinhamento das categorias:** script `pnpm db:realign-categories`, rodado à mão (papel administrativo, ignora RLS de propósito), global: cria as novas do sistema pelo `seedSystemCategories` novo, reclassifica os lançamentos de todas as empresas pelo de-para, com versão `system`, e inativa as antigas. O canal do lançamento não muda (é a dimensão que separa Salão/Delivery/Balcão agora). Subcategorias de empresa penduradas em categoria antiga (só em dev) mudam de pai pelo mesmo de-para. `DRE_GROUP_LABELS` passa a ter os 11 grupos do RF07.R5 (hoje falta `receita_bruta`, `deducoes`, `investimentos`; e sobram `manutencao` e `outras`, que viram `operacionais`).
7. **Mesclagem síncrona com teto de 5.000 lançamentos na origem** (acima: 422 `merge_too_large`, caso para o suporte). Na transação, trava os dois fornecedores e os lançamentos (`FOR UPDATE`), então a guarda de versão não falha; lançamento na lixeira também muda, por uma função própria `reassignSupplier` (o `editEntry` recusa excluído).
8. **`fee_reapplications`:** estados `queued`, `running`, `done`, `failed`; uma só em andamento por alvo (índice único parcial → 409 `reapply_in_progress`); período de até 366 dias e fim até hoje; fila `fee-reapply` com DLQ; job travado vai para a DLQ pelo padrão da skill e a linha fica `failed`.
9. **Recorte de fornecedores:** fornecedor é da empresa; gerente e contador veem todos (nome, apelidos, documento conforme RF10.R2). Total gasto e última compra: gerente no recorte de unidades e folha; contador vê tudo (DD-04); dono vê tudo. O contador tem `export:data`, então vê CPF inteiro.
10. **Unidade inativada:** nada muda em `membership_units` nem na unidade padrão; o canal já pula unidade inativa (`pickUnit`). O diálogo de inativar mostra quantos colaboradores têm só aquela unidade.
11. **`display_name`** não tem retrato no lançamento: "lançado por" mostra o nome atual do vínculo, inclusive em lançamentos antigos. Sem backfill.
12. **Ordem:** F6a → F6b → F6c. `supplier:*` entra na F6c. A F6b depende da F6a só pelo assistente e pelos componentes comuns de `features/settings`.
13. **Número do produto na API** (recusar cadastrar o número do produto; RF05.R2): variável opcional nova `PRODUCT_WHATSAPP_NUMBER` em `packages/config/env`; ausente, a checagem é pulada com aviso no log de inicialização. O link `wa.me` é montado no web com `NEXT_PUBLIC_WHATSAPP_NUMBER` (reusa `buildWhatsappLink`). O Luís acrescenta a variável no `.env`.
14. **Convite aceito pelo painel** não muda a situação: CONVIDADO só vira ATIVO pela primeira mensagem (CA07), como hoje.

## O que fica para o construtor

Textos de tela e de erro (português do Brasil, seguindo `DOMAIN_ERRORS`); layout dos cartões; nomes internos de funções que não cruzam pacote; tamanho do lote do job (200 é ponto de partida).
