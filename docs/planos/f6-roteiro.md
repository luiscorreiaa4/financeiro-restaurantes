# F6: roteiro de teste à mão

Roteiro para o Luís. As seções cobrem a **F6a** (formas, canais, unidades, assistente inicial, reaplicação de taxa e reativar unidade) e a **F6b** (colaboradores, no fim do arquivo). A da F6c entra quando ela for feita. Critérios: RF04.CA01 a CA05, RF08.CA01 a CA05, RF09.CA01 a CA03.

## Preparação (F6a)

1. Suba o Docker Desktop (o Postgres de desenvolvimento).
2. Aplique a migration nova (0023, tabela `fee_reapplications`): `pnpm db:migrate`, exportando `DATABASE_ADMIN_URL` antes (o comando não lê o `.env`).
3. Suba os três processos em terminais separados, a partir da raiz: `pnpm dev`, `pnpm dev:worker` (a reaplicação de taxa roda no worker) e, para lançar receitas, `pnpm dev:chat`. A fila `fee-reapply` é nova: ela nasce com a política `exclusive` só em banco sem a fila; se a fila já existisse, apague-a ou avise.
4. Tenha dados: `pnpm db:seed:dev` e entre no painel (`http://localhost:3000`) como **dono**.

## Roteiro

1. **Mudar a taxa (RF08.CA01).** Em Configurações, abra **Formas de pagamento**, edite **Crédito**, digite `3,2` na taxa. Aparece "Venda de R$ 100,00 rende R$ 96,80 líquidos" (o valor vem do servidor). Salve: a lista mostra "taxa 3,20 %".
2. **Arredondamento (CA02).** Ainda no Crédito, ponha `3,25`. No `pnpm dev:chat`, lance "vendi 10,10 no crédito": a taxa é R$ 0,33 e o líquido R$ 9,77.
3. **Taxa antiga não muda (CA03).** Mude o Crédito para `4` e abra o lançamento anterior: a taxa dele continua a de antes.
4. **Limite (CA05).** Digite `120` na taxa: o campo recusa ("entre 0 e 100") e o botão Salvar fica desabilitado.
5. **Cartão padrão.** Marque **Débito** como cartão padrão: o Crédito deixa de ser. Tente inativar o Débito enquanto ele é o padrão: é recusado.
6. **Cadastros do sistema.** "Não informada" aparece com o selo "do sistema" e abre só para leitura (sem Salvar, sem Reaplicar).
7. **Canais (RF09).** Em **Canais de venda**, ponha `23` no iFood. O texto explica que a comissão substitui a taxa da forma. Lance, pelo chat, "vendi 200 no ifood no crédito": taxa R$ 46,00 e líquido R$ 154,00 (RF09.CA01; vale só a comissão do canal, P06).
8. **Reaplicar a taxa a um período passado.** Lance 2 ou 3 receitas no Crédito. Mude a taxa do Crédito. Clique em **Reaplicar taxa**, escolha o mês, **Ver prévia** ("N lançamentos; o líquido muda em ...") e **Confirmar**. Com o worker ligado o estado vai de "Na fila" a "Concluída: N atualizados". Abra um lançamento: ganhou uma versão nova, canal "web". Peça a reaplicação de novo: 0 lançamentos mudam. Receita do iFood no crédito não muda (P06).
9. **Unidades (RF04.CA01).** Em **Unidades**, crie "Praia" com apelido, município da lista e canal padrão Salão. Ela aparece no seletor de unidade da casca (recarrega sozinho). Troque o fuso: lançamentos antigos mantêm a data.
10. **Última unidade ativa (CA02).** Inative a penúltima unidade: o diálogo mostra quantos colaboradores só têm aquela unidade. Tente inativar a última ativa: aparece "Não é possível inativar a última unidade ativa...".
11. **Quem só consulta (CA05).** Entre como **gerente** (ou **contador**): as três telas abrem sem botão de salvar, criar, inativar nem reaplicar, com o aviso de somente leitura. Pela API a escrita responde 403.
12. **Assistente inicial.** Crie uma empresa nova em "Criar outra empresa". Na tela final, **Configurar agora** leva a `/configuracoes/primeiros-passos`: passo 1 (canal padrão por unidade), passo 2 (taxas, com a prévia), passo 3 desabilitado "em breve". Cada passo tem **Pular**.
13. **Reativar unidade no acesso restrito (F2-2).** Em uma empresa de teste com uma única unidade, inative-a direto no banco (a API recusa a última): `update units set status = 'inactive' where id = '<id>';`. Saia e entre de novo: você cai em `/acesso-restrito`, que lista a unidade com **Reativar**. Clique: você volta ao painel normal.
14. **Auditoria.** No banco: `select action, metadata, created_at from audit_log where action like 'payment_method.%' or action like 'sales_channel.%' or action like 'unit.%' or action = 'fee_reapplication_requested' order by created_at desc;` mostra cada mudança com `before`/`after` só do que mudou.

## Verificação automática (23/11/2026)

- `pnpm typecheck`, `pnpm lint` e `pnpm test` (raiz): verdes. core 1129, web 521, api 534 (unitários).
- `@app/db test:int`: 533 testes, 26 arquivos. `@app/api test:int`: 877 testes, 26 arquivos.
- E2E: `settings-catalog.spec.ts` verde no Desktop Chrome (5) e no Mobile Chrome (4; o seletor de unidade no menu do celular é provado só no desktop). Suíte completa com `CI=true` (build de produção, Desktop Chrome e Mobile Chrome): 373 passaram, 9 puladas, 0 falhas.

## F6b: colaboradores

Critérios: RF05.CA01 a CA09. **Preparação:** aplique a migration 0024 (`display_name` do vínculo): exporte `DATABASE_ADMIN_URL` e rode `pnpm db:migrate`. Acrescente no `.env` a linha `PRODUCT_WHATSAPP_NUMBER=<número do WhatsApp do produto, só dígitos com DDI>` (sem ela a API avisa no log e não recusa o número do produto) e confira `NEXT_PUBLIC_WHATSAPP_NUMBER`. Suba `pnpm dev`, `pnpm dev:worker` e `pnpm dev:chat`; entre como **dono** (`pnpm db:seed:dev`).

1. **Cadastrar (CA01, CA04).** Em **Configurações > Colaboradores**, **Novo colaborador**: nome "Bia Cozinha", celular `(11) 97777-0004`, papel Lançador, uma unidade (a padrão fica sozinha). Salve. Abre o diálogo com o texto pronto, **Copiar** e **Abrir no WhatsApp** (link `wa.me` do produto com o texto). A lista mostra "Convidado".
2. **Primeira mensagem (CA07).** No `pnpm dev:chat`, entre com o celular da Bia e mande "Oi", depois "vendi 100 no pix". O lançamento aparece no painel **com o nome "Bia Cozinha"** (o nome que o dono deu) e a Bia passa a "Ativo".
3. **Nome por empresa (RF05.R2).** Cadastre o mesmo celular em outra empresa sua com outro nome: cada empresa mostra o seu nome em "lançado por", e nada de uma aparece na outra (CA02).
4. **Painel exige e-mail (CA03).** Marque **Acesso ao painel** sem e-mail: o erro aparece antes de enviar. Com e-mail, o convite sai (no dev, o e-mail falso grava o arquivo em `dev-emails` ou o log do adaptador).
5. **Celular com 9 dígitos (CA01).** Cadastre `1197777-0005` e tente cadastrar `119 7777-0005` e a forma sem o 9: recusa como "já é colaborador" (mesmo número).
6. **Número do produto e estrangeiro.** Cadastrar o número do WhatsApp do produto ou `+1 415...` é recusado.
7. **Sempre um dono (CA06).** Tente rebaixar ou desativar o único dono: "A empresa precisa de pelo menos um dono ativo".
8. **Sessão cai ao reduzir acesso (CA09, F2-4).** Abra o painel numa janela anônima como **gerente** (com painel). Como dono, rebaixe esse gerente a Lançador (ou tire a unidade, ou desative). Na janela do gerente, a próxima ação leva ao login.
9. **Desativar (CA05).** Desative a Bia: no `dev:chat`, ela vira "desconhecida". **Reativar** volta a "Ativo" (se já tinha respondido) ou "Convidado".
10. **Trocar celular.** Edite a Bia e mude o celular: pede a confirmação "o número antigo deixa de ser reconhecido". Se a pessoa tem vínculo em outra empresa, recusa com "desative e cadastre de novo".
11. **Gerente (CA08).** Entre como gerente: a lista mostra só quem tem unidade em comum, celular `•••• 0004`, sem e-mail e sem botões.
12. **Assistente.** Em `/configuracoes/primeiros-passos`, o passo 3 tem **Cadastrar colaborador** e leva ao formulário já aberto (`?novo=1`).

## F6c: categorias e fornecedores

Critérios: RF07.CA01 a CA05, RF10.CA01 a CA03. **Preparação:** aplique a migration 0025 (`status`, `merged_into_id` e `origin` do fornecedor): exporte `DATABASE_ADMIN_URL` e rode `pnpm db:migrate`. Depois rode **uma vez** `pnpm db:realign-categories` no banco dev (idempotente: a segunda execução não muda nada). Suba `pnpm dev`, `pnpm dev:worker` e `pnpm dev:chat`; entre como **dono** (`pnpm db:seed:dev`).

1. **Realinhamento.** O comando imprime quantas categorias novas, lançamentos reclassificados e categorias antigas inativadas. Em **Lançamentos**, os de Salão, Delivery e Balcão aparecem em "Vendas" (o canal continua o mesmo); "Folha de pagamento" virou "Salários". Abra um lançamento reclassificado: o histórico tem uma versão a mais, canal "system". Rode o comando de novo: tudo zero.
2. **Árvore (RF07).** Em **Configurações > Categorias**, as categorias do RF07.Obs2 aparecem com o selo "do sistema" e sem botão de editar. Busque "camarão" e "sal" e filtre por tipo e situação.
3. **Subcategoria (CA02).** **Nova subcategoria em Carnes**: o diálogo mostra "Herdado de Carnes" (Despesa, CMV, exige quantidade). Crie "Frutos do mar" com palavras de apoio "camarão, lula". No `pnpm dev:chat`, mande "comprei 5 kg de camarão por 200" e confira que o lançamento cai em "Frutos do mar" e pede ou usa quantidade e unidade.
4. **Folha (CA03).** **Nova subcategoria em Salários**: a caixa "Categoria sensível" aparece marcada e travada. Entre como **gerente sem VER_FOLHA**: "Salários" e suas subcategorias não aparecem, nem na busca "sal".
5. **Sistema é só leitura (CA01).** Pela tela não há como editar; pela API, `PATCH` em categoria do sistema responde 422.
6. **Fornecedores (RF10).** Em **Configurações > Fornecedores**, veja o total gasto e a última compra do mês corrente; mude "De" e "Até" (vão para a URL). Entre como gerente: o CPF aparece como `•••.•••.789-01`; como dono ou contador, inteiro. Gerente sem VER_FOLHA não soma a folha no total.
7. **Mesclar (CA02).** Crie dois fornecedores parecidos pelo chat ("paguei 50 no Ceasa" e "paguei 30 no Ceasa Norte"). Em **Mesclar Ceasa Norte**, escolha "Ceasa": a prévia mostra "N lançamentos" e o aviso "lançamentos que você não vê também passam para o destino". Confirme. "Ceasa Norte" some da lista; os lançamentos estão em "Ceasa" com uma versão nova cada. Mande "paguei 40 pro Ceasa Norte" no chat: vai para "Ceasa", sem criar fornecedor.
8. **Lixeira.** Exclua um lançamento do fornecedor antes de mesclar; depois da mesclagem, restaure: ele aparece no destino.
9. **Quem só consulta.** Entre como **contador**: a lista abre sem "Editar" nem "Mesclar". Como **lançador**, a página responde "Você não tem acesso a esta página".
10. **Evals (pendente, F6c-1).** `pnpm --filter @app/ai eval` (gasta crédito): a taxa de acerto não pode cair em relação ao baseline.
