# F3 (lançamentos): como testar

> Roteiro de teste da F3: a parte "ver" (F3a, RF22 e RF25), a parte "mudar" (F3b, RF23 e RF24) e o lançamento manual (F3c, RF26). Desenho em `docs/superpowers/specs/2026-11-13-f3-lancamentos-design.md`, planos em `docs/superpowers/plans/2026-11-13-f3a-lancamentos-ver.md` e `2026-11-13-f3b-lancamentos-mudar.md`, registro da execução da F3a em [`f3a-execucao.md`](f3a-execucao.md). Criado em 14/11/2026 (F3a); unificado e ampliado com a F3b em 16/11/2026.

## 1. Antes de tudo

1. **Docker Desktop aberto.** Os testes de integração sobem o Postgres pelo Testcontainers. Com o Docker fechado, todos os arquivos falham com `Could not find a working container runtime strategy`, sem nenhum teste rodar.
2. **Migrations 0018 e 0019 no banco de dev.** A 0019 (F3c) acrescenta a coluna `client_request_id`, o índice único parcial e o CHECK de origem exclusiva em `entries`. Rode o `db:migrate` abaixo uma vez para as duas. Texto da 0018: Ela só cria dois índices (`entries_created_idx` e `entries_trash_idx`). A F3b não tem migration nova. O `db:migrate` não lê o `.env`; exporte a variável antes:

   ```
   ! export DATABASE_ADMIN_URL=<a URL de admin do seu .env>; pnpm db:migrate
   ```

3. **Dependências.** Se o `typecheck` do `@app/db` acusar `Cannot find module 'drizzle-orm'` depois de um `pnpm --filter ... add`, rode `pnpm install` na raiz.

## 2. Testes automáticos

| O que | Comando | Esperado (16/11/2026) |
|---|---|---|
| Tudo, menos integração e E2E | `pnpm typecheck && pnpm lint && pnpm test` | verde; core 927, api 474, web 399 |
| Integração (Docker) | `pnpm test:int` | db 20 arquivos (415 testes), api 16 arquivos (514 testes) |
| Só o leitor de lançamentos (inclui `load`, `trash`, `sum`) | `pnpm --filter @app/db exec vitest run entry-reader` | verde |
| Só as rotas de lançamentos (leitura, edição, exclusão, lote, lixeira) | `pnpm --filter @app/api exec vitest run entries-panel` | 209 ou mais |
| Regras de edição do painel (data futura, quantidade, taxa) | `pnpm --filter @app/core test panel-edit` | verde |
| Recorte, contrato, valor em reais, diff de versões | `pnpm --filter @app/core test entry-scope contracts parse-brl version-diff` | verde |
| Telas de lançamentos (lista, drawer, formulário, lote, lixeira) | `pnpm --filter @app/web test features/entries` | verde |
| Campo de valor | `pnpm --filter @app/web test money-input input-masks` | verde |
| E2E de leitura | `CI=true pnpm --filter @app/web exec playwright test e2e/entries.spec.ts` | passam, 2 pulados de propósito |
| E2E de escrita (editar, conflito, excluir, restaurar, lote, contador) | `CI=true pnpm --filter @app/web exec playwright test e2e/entries-write.spec.ts` | desktop e celular; 2 pulados de propósito (lote só no desktop, rolagem só no celular) |
| Lançamento manual no core (duplicidade, `preparePanelCreate`, contrato, campo do 422) | `pnpm --filter @app/core test duplicate panel-create error-field contracts` | verde (core 927) |
| Gravação do painel no banco (chave de tentativa, CHECK, fornecedor novo desfeito) e candidatos de duplicidade | `pnpm --filter @app/db exec vitest run panel-entry-writer` e `... entry-reader` | verde |
| `POST /api/entries` (idempotência, 409, 422, sensível, unidade, fuso, matriz de papéis) | `pnpm --filter @app/api exec vitest run entries-create` e `... entries-panel` | 30 e 217 |
| Formulário de lançamento manual, botão, origem do canal web | `pnpm --filter @app/web test features/entries` | verde |
| E2E do lançamento manual | `pnpm --filter @app/web exec playwright test entries-create` (um worker; pare o `pnpm dev` antes: o `next dev` do Playwright precisa da pasta `.next`) | desktop 3, celular 1; 1 pulado de propósito por projeto |
| E2E completo | `CI=true pnpm --filter @app/web test:e2e` | 287 passam, 7 pulados |

Atenção: `pnpm --filter <pacote> test:int <nome>` **roda todos os arquivos**, porque o script já passa `int.test.ts` como filtro. Para um arquivo só, use `exec vitest run <nome>`. Detalhe em `.claude/rules/testes-integracao-ambiente.md`.

## 3. Roteiro à mão

### Subir

Em quatro terminais, na raiz:

```
pnpm db:seed:dev
pnpm dev
pnpm dev:worker
pnpm dev:chat
```

Abra o painel em `http://localhost:3000` (use `localhost`, não `127.0.0.1`: com o hook de `Origin`, o outro host dá 403 nas escritas).

### Criar dados pelo chat

No `pnpm dev:chat`, como o dono, mande três mensagens:

1. `paguei 450 de gás`
2. `vendi 1200 no salão, cartão de crédito`
3. `paguei 3100 de salário do João`

A terceira cai na categoria de folha (sensível).

### Contas do seed

| Persona | E-mail | Como entrar |
|---|---|---|
| Dono | `dono@demo.dev` | senha `demo12345` ou código |
| Gerente | `gerente@demo.dev` | código (lido na pasta `DEV_MAIL_DIR`) |
| Lançador | `atendente@demo.dev` | código |
| Contadora | `contadora@demo.dev` | código |

### F3a: o que conferir em `/lancamentos` (ver)

**Como dono**
- [ ] A lista mostra os três lançamentos do mês corrente, do mais novo para o mais antigo.
- [ ] Os totais batem: receitas R$ 1.200,00, despesas R$ 3.550,00, resultado negativo, "3 lançamentos". Nenhum aviso de valores restritos.
- [ ] Busca `450,00` (ou `450`): só o gás.
- [ ] Clique no cabeçalho "Valor": ordena do maior para o menor; de novo, do menor para o maior; de novo, volta à ordem de criação. A URL ganha `sort` e `dir`.
- [ ] Filtre por "Despesas" e recarregue a página: o filtro continua. Use o botão voltar: o filtro anterior volta.
- [ ] Abra o gás: aba Dados com valor e datas; aba Origem com o texto "paguei 450 de gás" e "Canal: WhatsApp"; aba Histórico com "Criação · WhatsApp". O botão voltar do navegador fecha o lançamento.
- [ ] Endereço com `&entry=` de um id inventado: "Lançamento não encontrado".

**Como gerente**
- [ ] Se o gerente do seed não tiver VER_FOLHA: o salário não aparece, os totais não somam os R$ 3.100,00 e aparece "Há valores restritos que não entram nestes totais.". A categoria de folha não aparece no filtro de categorias.
- [ ] Copie de uma sessão de dono o endereço `?entry=<id do salário>` e abra como gerente: "Lançamento não encontrado".

**Como lançador**
- [ ] "Lançamentos" aparece no menu (antes da F3a não aparecia; ver a decisão 1 em `f3a-execucao.md`).
- [ ] Só os lançamentos que ele mesmo mandou. Não há o filtro "Lançado por". Pôr `&createdBy=<id do dono>` na URL não muda nada.
- [ ] Nada de folha, nem a que ele mesmo lançou.

**Como contadora**
- [ ] Vê tudo, inclusive a folha, e nenhum botão de alteração (ver F3b abaixo).

**No celular** (DevTools, largura de 390 px)
- [ ] Cartões em vez de tabela, filtros no botão "Filtros" (folha lateral), sem rolagem horizontal.

### F3b: o que conferir (mudar)

**Editar (dono)**
- [ ] Abra o gás e clique em **Editar**. Mude o valor digitando `1234,56`: o campo mostra `1.234,56`. Salve: o drawer volta com R$ 1.234,56 e a lista e os totais mudam.
- [ ] Aba **Histórico**: "Criação · WhatsApp" e "Alteração · Painel", com o valor antes e depois.
- [ ] Mude só a descrição de uma **receita** com forma de pagamento: a taxa e o líquido não mudam. Troque a forma de pagamento: a taxa e o líquido são recalculados.
- [ ] Data de competência: hoje + 60 dias salva; hoje + 61 mostra "A data pode ser no máximo 60 dias à frente de hoje.".
- [ ] Categoria que exige quantidade (ex.: insumo por peso) sem quantidade e unidade de medida: "Informe a quantidade e a unidade de medida.".
- [ ] Fornecedor: digite um nome novo e escolha "Usar “X” como novo fornecedor"; salve e confira o fornecedor no lançamento. Duplo clique em **Salvar** grava uma versão só.
- [ ] Lançamento com sinal de revisão (ex.: "Categoria a revisar"): **Marcar como revisado** limpa o sinal. Junto de uma edição, o histórico mostra duas versões (alteração, depois revisão).

**Conflito de edição (duas abas)**
- [ ] Abra o mesmo lançamento em duas abas e clique em Editar nas duas. Salve na A; salve na B: a B mostra "Este lançamento foi alterado por [nome] às hh:mm. Recarregar?" e mantém o que você digitou. **Recarregar** traz a versão da A.

**Excluir e lixeira**
- [ ] **Excluir** no drawer: o diálogo tem motivo opcional com contador `n/200` (não passa de 200). Confirme: o lançamento some da lista e dos totais.
- [ ] **Lixeira** (botão no topo de Lançamentos, ou `/lancamentos/lixeira`): o lançamento aparece com "Excluído por", motivo e "Restaurável até" (30 dias). Filtre por período, unidade e quem excluiu; a URL guarda os filtros.
- [ ] **Restaurar**: o lançamento volta à lista; o histórico mostra "Exclusão" e "Restauração" (canal Painel).
- [ ] Lançamento excluído há mais de 30 dias não aparece na lixeira (para testar, ajuste `deleted_at` e `restorable_until` no banco dev).

**Lote (gerente ou dono, na tabela do computador)**
- [ ] Marque duas ou mais linhas: aparece "N selecionados". **Excluir selecionados** mostra a quantidade e a soma **calculadas pelo servidor**. Confirme com motivo: todas vão para a lixeira e a seleção some.
- [ ] Trocar o filtro ou a ordem limpa a seleção. Abrir um lançamento no drawer não limpa.
- [ ] O lançador não vê as caixas de seleção nem exclui em lote.

**Permissões**
- [ ] **Contadora** (e conta somente leitura): sem **Editar**, **Excluir**, caixas de seleção nem o botão da lixeira.
- [ ] **Lançador**: edita e exclui só os próprios; restaura só os próprios; não vê o lançamento de outro (nem pelo `?entry=`).
- [ ] **Gerente sem VER_FOLHA**: o salário não aparece na lista, nos totais, no histórico, na origem nem na lixeira. Trocar a categoria de um lançamento para a de folha é recusado (mesma mensagem de categoria que não existe). Se o dono marcar o salário como excluído, ele também não aparece na lixeira do gerente.

**No celular** (390 px)
- [ ] O formulário de edição e a lixeira (cartões) não têm rolagem horizontal.

### F3c: o que conferir em `/lancamentos/novo` (lançamento manual)

Entre como dono e abra `/lancamentos`: o botão **Novo lançamento** aparece no topo (e, com a lista vazia, também no meio da página).

**Lançar três notas em sequência (o "Pronto quando" da etapa)**
- [ ] Clique em **Novo lançamento**. A unidade do seletor vem escolhida; com "Todas as unidades" ela começa vazia (se houver mais de uma ativa). A data de competência é hoje e a de pagamento acompanha a competência até você mexer nela.
- [ ] Digite `450,00` no valor, "Gás de cozinha" na descrição, escolha uma categoria de despesa (só aparecem as ativas e do tipo) e clique em **Salvar e lançar outro**. Aparece "Despesa de R$ 450,00 salva (líquido R$ 450,00)" com o link **Abrir**; Tipo, Data de competência e Unidade ficam, o resto limpa e o foco volta ao valor.
- [ ] Lance mais duas (uma delas como **Receita**: o canal de venda vem com o padrão da unidade e aparece o campo Pedidos). Na última use **Salvar**: você vai para `/lancamentos?entry=...` com o detalhe aberto.
- [ ] Na lista as três aparecem com o canal **Painel**. No detalhe, aba **Origem**: "Lançado manualmente no painel por <seu nome> em dd/mm/aaaa hh:mm". Aba **Histórico**: a criação (versão 1) com o canal Painel.

**Erros e avisos**
- [ ] Clique em Salvar sem valor: "Informe o valor." no campo e nada é enviado (RF26.CA01).
- [ ] Clique duas vezes rápido em Salvar: só um lançamento é criado.
- [ ] Repita uma nota igual (mesmo valor e fornecedor, ou mesma descrição e data) em até 24 h: grava e avisa "Parece repetido...".
- [ ] Use uma data de mais de 60 dias atrás: grava e avisa "Data com mais de 60 dias". Use uma data mais de 60 dias à frente: o servidor recusa com a mensagem no campo da data.
- [ ] Escreva um CPF na descrição (ex.: `Gás 123.456.789-09`): o lançamento grava sem o CPF e a mensagem de sucesso mostra "Descrição registrada" sem ele.
- [ ] Escolha uma categoria que exige quantidade: aparecem Quantidade e Unidade de medida (lista fechada: KG, G, L, ML, UN, DZ, CX, PCT, FD, SC, OUTRA); trocar para uma categoria que não exige descarta os dois.
- [ ] Troque o tipo para Despesa depois de preencher canal e pedidos: os dois somem e não vão no envio.

**Permissões**
- [ ] **Gerente sem VER_FOLHA**: a categoria de folha nem aparece na lista do formulário; forçar o id dela pela API devolve a mesma mensagem de uma categoria que não existe.
- [ ] **Lançador**: só as unidades dele; o formulário funciona e o lançamento aparece só para ele (e para dono e gerente).
- [ ] **Contadora** e **conta somente leitura**: sem o botão **Novo lançamento**; abrir `/lancamentos/novo` direto mostra "Você não tem acesso a esta página" (contadora) ou "Conta somente leitura: não é possível lançar." (conta somente leitura).
- [ ] **Duas abas**: comece o formulário, troque a empresa ou a unidade em outra aba e envie: aparece o aviso de contexto e o digitado não se perde.

**No celular** (390 px)
- [ ] O formulário de lançamento manual cabe numa coluna, sem rolagem horizontal, com os botões no fim.

## 4. Limites conhecidos (não são defeito da F3)

- Áudio e imagem da origem só na E10 (F3-1); mostra a transcrição e a chave da nota.
- O aviso de valores restritos respeita a busca (F3-3, decisão do Luís).
- O filtro "Lançado por" lista todos os vínculos da empresa (F3-4).
- Campo que não mudou numa reclassificação continua visível nas versões seguintes; o detalhe abre lançamento na lixeira pelo endereço; as opções de filtro não escondem cadastro inativo (F3-5).
- "Hoje" (data futura, prazo da lixeira, período padrão) usa o fuso de São Paulo no prazo da lixeira; a data futura da edição usa o fuso da unidade. O prazo de restauração soma dias em UTC (F3b-4).
- Duas edições simultâneas com o mesmo fornecedor novo podem criar dois cadastros (F3b-1); `quantity` e o período da lixeira não têm teto (F3b-2); a categoria de destino é conferida fora da transação de gravação (F3b-3).
- O teto de valor do lançamento é o inteiro seguro do JavaScript em centavos (F3c-3): o painel e o canal aceitam números absurdos; falta um teto de negócio.
- `possible_duplicate` no painel compara com os lançamentos das unidades de acesso, inclusive dos colegas, para o lançador também (decisão 10 do grill da F3c); o sinal revela que um colega lançou algo igual nas últimas 24 h.
- Unidade inexistente responde 422 e unidade existente fora do acesso responde 403 (D8 da F3c); o id é um UUID v7 que ninguém adivinha.
