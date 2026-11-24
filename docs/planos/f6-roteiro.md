# F6: roteiro de teste à mão

Roteiro para o Luís. Esta seção cobre a **F6a** (formas, canais, unidades, assistente inicial, reaplicação de taxa e reativar unidade). As seções da F6b e da F6c entram quando elas forem feitas. Critérios: RF04.CA01 a CA05, RF08.CA01 a CA05, RF09.CA01 a CA03.

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
