# F5: roteiro de teste à mão (exportação Excel/CSV)

Roteiro para o Luís. Cobre RF29 (CA01 a CA05) com o painel e o worker de verdade, no banco de desenvolvimento. Antes de começar, nada da F5 foi aplicado no seu banco local: as migrations 0021 (`exports`) e 0022 (`included_sensitive`) ainda precisam rodar.

## Preparação

1. Suba o Docker Desktop (o Postgres de desenvolvimento).
2. Aplique as migrations novas (0021 e 0022): `pnpm db:migrate` (exporte `DATABASE_ADMIN_URL` antes, como nas etapas anteriores; o comando não lê o `.env`).
3. Suba os três processos, **todos a partir da pasta `apps/api`** para API e worker (o arquivo vai para `apps/api/.dev-exports/`, relativo ao diretório de trabalho, e os dois precisam enxergar a mesma pasta): `pnpm dev` (API e web) e, em outro terminal, `pnpm dev:worker`.
4. Tenha dados: `pnpm db:seed:dev` (restaurantes e usuários de exemplo) e, se quiser folha, um lançamento numa categoria de folha de pagamento.
5. Abra `http://localhost:3000`, entre como **dono** e vá em Lançamentos.

## Roteiro

1. **CA01 (totais batem).** Filtre outubro, clique em **Exportar**, deixe XLSX e confirme. Aparece "Exportação na fila. Acompanhe em Exportações". Em até alguns segundos surge a faixa "Sua exportação está pronta" com **Baixar**. Abra o arquivo no Excel: a soma da coluna "Valor bruto" (receitas e despesas separadas) e a contagem de linhas têm que ser iguais aos totais da lista com o mesmo filtro. Valores são números (R$ com vírgula), datas são datas, e ordenar por valor funciona.
2. **CA02 (acentos e colunas).** Exporte o mesmo período em **CSV** e abra no Excel em português. "Pão de açúcar" sai correto e cada campo cai na sua coluna (o arquivo é UTF-8 com BOM e separador `;`).
3. **COMPLETO.** Como dono, escolha "Completo" em CSV: o download é um `.zip` com `lancamentos.csv` e `historico.csv`. Em XLSX o COMPLETO tem duas abas ("Lançamentos" e "Histórico") e inclui a lixeira.
4. **CA03 (permissão).** Entre como **gerente sem a permissão EXPORTAR_DADOS**: o botão Exportar não aparece, e `/exportacoes` diz "Você não tem acesso a esta página". Com a permissão, o gerente exporta lançamentos, mas não vê "Completo". O contador exporta lançamentos e a folha aparece no arquivo dele; o gerente sem VER_FOLHA exporta e o arquivo **não** traz nenhuma linha de folha.
5. **Permissão revogada depois de pronto.** Como gerente com VER_FOLHA, gere um arquivo com folha; depois, como dono, tire a permissão VER_FOLHA dele (ou a unidade). O gerente continua vendo o pedido na lista, mas Baixar responde 403 "forbidden" (a tela mostra a mensagem genérica de erro).
6. **CA04 (só quem pediu baixa).** Em `/exportacoes`, clique em Baixar como dono, copie o link do download antes de ele terminar (ou use o botão direito no download) e abra em outra sessão (outro usuário ou outra empresa): resposta 404.
7. **CA05 (link de 1 hora).** Peça o link, espere 1 hora (ou, no teste de integração, avance o relógio de teste) e abra: 403 `link_invalid`. Peça um link novo: funciona. O arquivo some depois de 7 dias (job `delete-export-file`); `/exportacoes` mostra "Expirada" sem o botão.
8. **Limites.** Peça 4 exportações sem esperar terminar: a quarta recusa com "Você já tem 3 exportações em andamento". Um período com mais de 100 mil linhas termina em "Falhou" com a explicação.
9. **Auditoria.** No banco: `select action, target, metadata, created_at from audit_log where action like 'export_%' order by created_at desc;` deve mostrar `export_requested`, `export_ready` (com `rowCount`) e `export_downloaded`, sem texto de busca (a busca vira `[busca]`) e sem nome de arquivo.

## Verificação automática (23/11/2026)

- `pnpm lint` e `pnpm test` (raiz): verdes.
- `@app/db test:int`: 474 testes, 22 arquivos. `@app/api test:int`: 666 testes, 20 arquivos.
- E2E com `CI=true` (build de produção, todas as specs, Desktop Chrome e Pixel 7): 330 passaram; as 2 instabilidades da spec `context.spec.ts` (troca de empresa, anteriores à F5) foram corrigidas abrindo `/dashboard` direto, e em 192 execuções repetidas no modo CI não houve falha.
- A spec `exports.spec.ts` tem 7 cenários por projeto, todos verdes: dono exporta em CSV e baixa com BOM, COMPLETO só do dono, lançador sem botão, conta somente leitura exporta, falha, celular de 360 px e axe na tela e no diálogo.
