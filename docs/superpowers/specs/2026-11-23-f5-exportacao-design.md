# F5: Exportação Excel/CSV (RF29), desenho

Etapa F5 do painel (`docs/planos/painel.md`). Este desenho **cita** o RF29 e os CA de `docs/requisitos.md` e não copia regra; a regra nova entra na DD-42 e nos requisitos 1.20 (T1 do plano). Plano: `docs/superpowers/plans/2026-11-23-f5-exportacao.md`.

## A.1 Contexto e por quê

O RF29 (MVP) é a exportação dos lançamentos em planilha. Atende o dono, o contador e o gerente com EXPORTAR_DADOS. É o caminho de trabalho do contador (DD-03) e garante o direito do cliente de levar os próprios dados.

O que já existe:
- a página `/exportacoes`, vazia, com `PageGuard action="export:data"`;
- o item de menu;
- a ação `export:data` no core, dada ao dono, ao contador e ao gerente com EXPORTAR_DADOS (`permissions.ts:95,117,123`).

**Pronto quando:** o contador abre o arquivo no Excel e os totais batem com o painel (RF29.CA01).

## A.2 Metas, não metas, antimetas

**Metas.** RF29.R1 a R5, Obs1 e CA01 a CA05:
- XLSX e CSV;
- conteúdo LANCAMENTOS e COMPLETO;
- geração em fila, com a situação visível;
- link de 1 hora;
- arquivo apagado em 7 dias;
- só quem pediu baixa o arquivo;
- auditoria;
- aviso de "pronta" no painel.

**Não metas:**
- pacote mensal do contador (RF29.Obs2, v1.1);
- adaptador S3 (fica para a E10, junto com o da mídia);
- e-mail de "pronta" (pendência da F8);
- exportar a partir do dashboard;
- agendar exportações;
- linha de totais dentro do arquivo.

**Antimetas.** Não pode acontecer:
- arquivo com folha para quem não vê folha (`sensivel-falha-fechado.md` item 4);
- link que outra pessoa consiga abrir;
- valor gravado como texto no XLSX;
- acento quebrado no Excel em português;
- soma ou contagem do arquivo diferente do painel para o mesmo filtro.

## A.3 Restrições

- Dinheiro fica em centavos até a borda. O ÷100 acontece só na serialização do arquivo (regra 1 do CLAUDE.md).
- Os filtros são os mesmos da lista (RF29.R2, RF22). `sort`, `dir`, `cursor` e `limit` não entram.
- Regras do projeto que se aplicam:
  - `.claude/rules/tabela-nova.md`, para a tabela nova;
  - `rota-de-tenant.md`, para as rotas;
  - `pg-boss.md`, para os workers;
  - `escrita-idempotente.md`, para o POST;
  - `sensivel-falha-fechado.md`, para a leitura.
- Dependências novas aprovadas: **write-excel-file** (decide a D-F7) e **fflate**. Ficam só em `apps/api`. O `packages/core` continua sem infra.

## A.4 Abordagens consideradas

1. **Link assinado do S3.** Descartada: quem tem a URL baixa o arquivo, o que quebra o RF29.R5 e o CA04.
2. **Download sempre pela API (escolhida).** A API confere sessão, empresa, autor e um token de 1 hora, e lê os bytes por uma porta de armazenamento. Fica em disco no desenvolvimento, em memória nos testes e no S3 a partir da E10.
3. **Gerar dentro da requisição.** Descartada: o RF29.R4 manda gerar em segundo plano, e 24 meses de lançamentos podem passar do tempo de uma requisição.

## A.5 Decisões do Luís nesta sessão

1. Armazenamento: uma porta `ExportFileStore`, com implementação em disco (dev) e em memória (testes). O S3 fica para a E10.
2. COMPLETO em CSV gera um `.zip` com `lancamentos.csv` e `historico.csv`. COMPLETO em XLSX gera duas abas, "Lançamentos" e "Histórico".
3. Aviso de pronta: na tela do painel, em qualquer página, enquanto houver pedido pendente. Também por e-mail na F8, que fica como pendência dela.
4. D-F7: write-excel-file para o XLSX e fflate para o zip. A etapa começa com uma prova. O plano B é o exceljs.

## A.6 Desenho

### Fluxo
1. Na lista de lançamentos (filtros na URL), **Exportar** abre um diálogo com:
   - formato: XLSX ou CSV;
   - conteúdo: LANCAMENTOS, ou COMPLETO (só com `export:full`);
   - o resumo dos filtros.
2. `POST /api/exports` faz, nesta ordem:
   1. checa a idempotência;
   2. checa o teto de pendentes;
   3. grava o pedido `queued` com a unidade ativa;
   4. grava `export_requested` no `audit_log`;
   5. enfileira `generate-export`.
3. O worker passa o pedido para `generating` e **recalcula o ator naquele momento**: `access.listPanelMemberships(userId)` mais `resolvePanelContext` para a empresa e a unidade do pedido, depois `can`.
   - Se não servir, falha com `forbidden`.
   - Se servir, lê as linhas com o recorte do momento, serializa e grava o arquivo com chave determinística.
   - Por fim marca `ready`, grava `export_ready` com `rowCount` e enfileira `delete-export-file` com atraso de 7 dias.
4. A casca do painel consulta `GET /api/exports` a cada 3 s, só enquanto houver pedido `queued` ou `generating`. Quando um pedido passa a `ready`, mostra uma faixa `role="status"`: "Sua exportação está pronta. **Baixar**". Quando passa a `failed`, a faixa diz "A exportação falhou. **Ver exportações**".
5. **Baixar** chama `POST /api/exports/:id/link`, que devolve `{ url, expiresAt }` com um token de 1 h, e o navegador vai até a URL.
6. `GET /api/exports/:id/download?t=…` confere, nesta ordem:
   1. sessão, empresa e se `requested_by` é o usuário (senão 404);
   2. o token: assinatura, os mesmos ids e validade (senão 403 `link_invalid`);
   3. `available` (senão 410).

   Depois envia os bytes com `Content-Disposition: attachment` e `Cache-Control: no-store`, e grava `export_downloaded`.
7. O job `delete-export-file` apaga o arquivo e marca `file_deleted_at`, dentro de `withTenant`. A linha do pedido fica como registro.
   - Rede de segurança: `available` exige `created_at > agora − 7 dias`. A lista e o download respeitam isso mesmo se o job atrasar.

### Banco: tabela `exports` (migration 0021)

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 | |
| `tenant_id` | uuid | `tenantIsolation("exports")` |
| `requested_by` | uuid → users | |
| `unit_choice` | text | `'all'` ou o id da unidade ativa no pedido |
| `format` | text CHECK (`xlsx`, `csv`) | R1 |
| `content` | text CHECK (`entries`, `full`) | R3 |
| `filters` | jsonb | `EntryFilters` já validado |
| `status` | text CHECK (`queued`, `generating`, `ready`, `failed`) | R4 |
| `row_count`, `file_size` | integer, null | |
| `file_key` | text, null | `exports/<tenantId>/<exportId>.<ext>` (determinística) |
| `error_code` | text, null | `forbidden`, `too_many_rows` ou `generation_failed` |
| `client_request_id` | uuid, not null | único em `(tenant_id, requested_by, client_request_id)` |
| `created_at` | timestamptz | |
| `started_at`, `finished_at`, `file_deleted_at` | timestamptz, null | |

- Índice em `(tenant_id, requested_by, created_at desc)`.
- O papel `app` recebe SELECT, INSERT e UPDATE, sem DELETE.

### Core (`packages/core`, puro)
- **Contrato** `contracts/exports.ts`: os schemas do plano (T3), todos `.strict()`.
- **Filtros sem ordem:** `entryFiltersSchema` é extraído de `entryListQuerySchema`, sem mudar o comportamento.
- **Permissão nova** `export:full`, só do dono (RF29.R3).
- **Colunas** (`exports/columns.ts`): lista fixa e ordenada do RF29.R3. Cada coluna tem rótulo em português e um tipo: `text`, `date`, `datetime`, `money`, `int` ou `decimal`. O COMPLETO acrescenta "Situação" (Ativo / Na lixeira) e "Excluído em".
- **Histórico** (`exports/history.ts`): as versões passam por `diffVersion` e viram linhas com lançamento, versão, data e hora, autor, canal, campo, antes e depois. Só o dono pede o COMPLETO. Mesmo assim, um snapshot ilegível vira "(ilegível)", sem conteúdo.
- **CSV** (`exports/csv.ts`):
  - BOM, separador `;` e quebra de linha `\r\n`;
  - aspas no campo que tiver `;`, `"`, `\r` ou `\n`;
  - dinheiro como `1234,56` e `-1234,56`;
  - data como `dd/mm/aaaa` e data e hora como `dd/mm/aaaa hh:mm`, em São Paulo;
  - **injeção de fórmula:** célula do tipo `text` que começa com `= + - @ \t \r` ganha `'` na frente. Vale no CSV e no XLSX. Número nunca leva o `'`.

### Banco (`packages/db`)
- `exportsRepo`:
  - `insert` (a idempotência é da rota, ver `escrita-idempotente.md`), `findByClientRequest`, `get`, `listForUser` e `countPending`;
  - as transições `markGenerating`, `markReady`, `markFailed` e `markFileDeleted` usam `UPDATE` com situação anterior esperada.
- `entryReader.exportRows(tx, scope, filters, { includeDeleted, limit })`:
  - usa as mesmas `conditions` da lista, com uma opção nova para incluir a lixeira;
  - não tem cursor;
  - ordena por `occurred_on, created_at, id`;
  - traz subcategoria e pai, grupo do DRE, natureza e documento do fornecedor;
  - quem chama passa `EXPORT_MAX_ROWS + 1`.
- `entryReader.exportVersions(tx, entryIds)`.

### API (`apps/api`)
- **Porta** `ExportFileStore` (`put`, `get`, `delete`), com implementação em disco (recusa produção) e em memória. Em produção, a composição lança erro até a E10.
- **Rotas** `POST /api/exports`, `GET /api/exports`, `POST /api/exports/:id/link` e `GET /api/exports/:id/download`.
  - Guardas: `requirePanelContext`, `requireTenantRoute` e `requirePermission("export:data")`.
  - **Sem `requireWritable`.**
- **Token:** HMAC-SHA256 com chave HKDF de `AUTH_SECRET`, na info `"export-link"`.
- **Workers:**
  - `generate-export`, com DLQ;
  - `delete-export-file`, com DLQ e atraso de 7 dias.
- **Serializadores:** `writeXlsx` (write-excel-file), `writeCsv` (core) e `zipFiles` (fflate).
- **Auditoria:** `export_requested`, `export_ready`, `export_failed` e `export_downloaded`.

### Web (`apps/web`)
- `features/exports/`:
  - cliente e hooks;
  - `export-dialog.tsx`, com o botão na barra da lista;
  - `exports-screen.tsx`, em `/exportacoes`: tabela no computador e cartões no celular;
  - `export-notifier.tsx`, na casca.
- O notificador só monta com sessão completa e `export:data`, e usa a chave `tenantKey`.
- A chave de tentativa só muda depois de sucesso, como na F3c.
- No E2E, `fake-exports.mjs`.

## A.7 O que fica para quem constrói
- Larguras de coluna no XLSX.
- Texto de cada código de erro na tela, seguindo o tom das telas de lançamentos.
- O desenho exato da faixa do notificador, com os tokens neutros (D-F8).

## A.8 Chamadas minhas (vão na DD-42)
1. Exportar não exige conta gravável. Exportar é leitura, e a conta somente leitura também leva os dados (DD-06).
2. Ator e recorte são recalculados na geração. Se o autor perdeu o acesso, a unidade, a permissão ou o direito ao COMPLETO, o pedido fica `failed` com `forbidden`.
3. O download passa sempre pela API, com token HMAC de 1 h e checagem de sessão. Não há link do S3.
4. Tetos:
   - 100 mil linhas por arquivo (`too_many_rows`), igual nos dois formatos;
   - 3 pedidos pendentes por usuário e empresa (429 `too_many_pending`). A idempotência é checada antes do teto, então um reenvio volta 200, nunca 429.
5. Injeção de fórmula: células de texto que começam com `= + - @` ganham `'` (OWASP). Vale também para descrição iniciada com `-`.
6. Ordem do arquivo: data de competência, depois data de criação.
7. Aviso numa faixa `role="status"` da casca, sem biblioteca de toast.
8. Downloads também vão para a auditoria.
9. A linha do pedido fica guardada. Só o arquivo some. A limpeza é um job atrasado por exportação, dentro de `withTenant`, sem cron nem papel que atravesse empresas.
10. O arquivo não traz linha de totais. Quem confere usa a soma da coluna (CA01), e um teste de paridade com `/api/entries/totals` garante o resultado.
11. A chave do arquivo é determinística, então um `put` repetido sobrescreve o mesmo arquivo.

## A.9 Respostas à conferência do construtor
- **Papel da limpeza:** job atrasado por exportação, com o tenant no payload e `withTenant` (chamada 9). Nada atravessa empresas.
- **Contador e COMPLETO:** o RF29.R3 diz "só para o Dono". O contador exporta LANCAMENTOS e vê a folha (DD-04, `entryScopeFor`).
- **Recalcular o ator:** `PanelAccessStore.listPanelMemberships` (`packages/db/src/panel-access-store.ts:15`, papel `app_auth`), depois `resolvePanelContext` (`packages/core/src/access/panel-context.ts:138`). Só vale com `source === "cookie"` e o mesmo `tenantId`. O worker passa a abrir o pool do `DATABASE_AUTH_URL`.
- **Critério da prova:** 100 mil linhas em duas abas, menos de 60 s, pico de heap abaixo de 512 MB, tipos TS compilando. Se falhar, vai para o exceljs.
- **Totais:** sem linha de totais. O teste de paridade usa o mesmo filtro (chamada 10).
- **Idempotência e teto:** a idempotência vem antes (chamada 4).
- **Falha entre `put` e `markReady`:** a chave é determinística (chamada 11).
- **Notificador:** só com sessão completa e `export:data`. A chave `tenantKey` muda com a empresa.
- **Fórmula e números:** o `'` só se aplica a colunas `text` (chamada 5).
