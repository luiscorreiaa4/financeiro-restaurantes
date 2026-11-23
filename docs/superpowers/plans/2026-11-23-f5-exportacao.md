# F5: Exportação Excel/CSV (RF29), plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou executing-plans). Passos com `- [ ]`.

**Goal:** exportação de lançamentos em XLSX e CSV (RF29), em fila, com download pela API, link de 1 h e arquivo apagado em 7 dias.

**Architecture:**
- **Core:** contrato, colunas, CSV e histórico, todos puros.
- **db:** tabela `exports`, o repositório e as leituras de exportação no `entryReader`.
- **api:** rotas, token, workers pg-boss e serializadores XLSX e zip.
- **web:** diálogo na lista, tela `/exportacoes` e notificador na casca.

**Tech Stack:** TypeScript strict, Fastify, Zod, Drizzle, pg-boss, write-excel-file, fflate, Next.js, TanStack Query, Vitest, Testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-f5-exportacao-design.md`. Requisitos: RF29 (R1 a R5, Obs1, CA01 a CA05), RF22 (filtros), RF06.R3 (sensível), DD-03, DD-04 e DD-06.

## Global Constraints
- Formato CSV: `;`, UTF-8 com BOM `﻿` e `\r\n` (RF29.R1).
- XLSX: dinheiro é número no formato `"R$" #,##0.00`, data é `Date` UTC no formato `dd/mm/yyyy`, nunca texto (RF29.R1).
- Situações: `queued`, `generating`, `ready`, `failed`, que correspondem a NA_FILA, GERANDO, PRONTO e FALHOU (RF29.R4).
- `EXPORT_LINK_TTL_SECONDS = 3600`; `EXPORT_RETENTION_DAYS = 7` (RF29.R5).
- `EXPORT_MAX_ROWS = 100_000`; `EXPORT_MAX_PENDING = 3` (DD-42).
- Quem exporta: `export:data` (dono, contador e gerente com EXPORTAR_DADOS). COMPLETO: `export:full`, só do dono (RF29.Obs1 e R3).
- Folha: a mesma `sensitiveExpression` da lista. Contador vê; gerente sem VER_FOLHA e lançador não veem (RF06.R3, DD-04).
- Erros de rota só com `{ code }`. Logs sem filtros de texto livre (`q`) nem conteúdo.
- Dinheiro em centavos até `writeCsv` e `writeXlsx`.

## Review Focus (cada linha vira teste na tarefa dona)
1. Gerente sem VER_FOLHA exporta um período com folha: o arquivo gerado pelo worker não tem nenhuma linha de categoria sensível, e `rowCount` não conta essas linhas (T10).
2. O link do dono é aberto pela sessão do contador da mesma empresa: 404, e nenhum byte é enviado (T11).
3. Token emitido em `t0`: download em `t0 + 3600 s` passa; em `t0 + 3601 s` recebe 403 `link_invalid`. O relógio é injetado (T9, T11).
4. A descrição `=HYPERLINK("x")` vira `'=HYPERLINK(""x"")` entre aspas no CSV e `'=HYPERLINK("x")` no XLSX. O valor `-123456` centavos vira `-1234,56`, sem `'` (T4, T8).
5. O gerente perde EXPORTAR_DADOS entre o pedido e a geração: o pedido vira `failed`/`forbidden`, `put` nunca é chamado e `export_failed` fica na auditoria (T10).
6. Com 3 pendentes, o reenvio do mesmo `clientRequestId` devolve 200 com o mesmo `id`. Um `clientRequestId` novo devolve 429 (T11).

## Desvios do desenho aprovado
- Nas perguntas, a limpeza era um job agendado (`boss.schedule`). O plano usa um job atrasado por exportação, para não atravessar empresas com um papel sem RLS (chamada 9).
- **T2 (23/11/2026), sem plano B:** write-excel-file 4.1.1 e fflate 0.8.3 passaram. 110 mil linhas em duas abas: 2,2 s e pico de heap de 79 MB (critério: 60 s e 512 MB). O pg-boss 12.38.0 aceita `startAfter` em segundos, e `keep_until = start_after + retentionSeconds` (padrão 14 dias), então o job de 7 dias sobrevive; a fila `delete-export-file` leva `retentionSeconds` de 8 dias por garantia. O `strFromU8` do fflate descarta o BOM: testes de BOM conferem os bytes `EF BB BF`. A API do write-excel-file 4.x para várias abas é `writeXlsxFile([{ data, sheet }, ...]).toBuffer()`.
- A lista não tem o parâmetro `status`. `GET /api/exports` devolve os últimos 7 dias, que é uma lista pequena, e o notificador decide sozinho.

## Tarefas

### T1: Documentação das decisões — HAIKU
**Modify:**
- `docs/decisoes.md`:
  - D-F7 passa a "Decidida (DD-42)";
  - nova linha **DD-42 | 23/11/2026**, com as decisões A.5 e as chamadas A.8 de 1 a 11.
- `docs/requisitos.md`:
  - versão **1.20 (23/11/2026)** no topo, com o resumo antes do "Antes, 1.19";
  - notas no RF29: R1 (COMPLETO em CSV é `.zip` com dois CSV), R4 (aviso no painel, e-mail na F8), R5 (download pela API com sessão e token de 1 h; arquivo apagado por job em 7 dias) e Obs1 (tetos de 100 mil linhas e 3 pendentes; downloads na auditoria). Cada nota cita DD-42.
- `docs/planos/painel.md`:
  - linha 200 (D-F7): "Decidida em 23/11/2026 (DD-42)";
  - seção F5: "**Decisões:** DD-42".
- `docs/planos/andamento.md`:
  - fecha o item D-F7 (linha 92);
  - acrescenta as pendências "F8: e-mail de exportação pronta, com link para `/exportacoes`, nunca o arquivo (DD-42)" e "E10: `ExportFileStore` S3 e criptografia em repouso (DD-42)".
- `docs/planos/pendencias.md`: uma linha para cada pendência nova.

- [ ] Editar os arquivos.
- [ ] Rodar `git diff --stat`: 5 arquivos de `docs/`.
- [ ] Sugerir o commit `docs: DD-42 e requisitos 1.20 (exportação, F5)`.

### T2: ⚠️ Prova das bibliotecas e do pg-boss — NATIVA
**Create:** `apps/api/test/spikes/export-libs.spike.test.ts`. Fica fora da suíte padrão, com nome `*.spike.test.ts` e exclusão no `vitest.config` do api se o padrão o pegar.

**Modify:** `apps/api/package.json`, com `pnpm --filter @app/api add write-excel-file fflate`. Conferir no lockfile que não entrou nada além de write-excel-file e fflate.

- [ ] **write-excel-file.**
  - `import writeXlsxFile from "write-excel-file/node"` compila com TS strict. Se não compilar, verificar o `exports` e os tipos no `node_modules`.
  - Gerar duas abas: "Lançamentos" com 100 mil linhas (data, texto, moeda, inteiro) e "Histórico" com 10 mil linhas, por `toBuffer()`.
  - Medir o tempo e o pico de `process.memoryUsage().heapUsed`. **Critério:** menos de 60 s e menos de 512 MB.
  - Gravar `prova.xlsx` no scratchpad da sessão para o Luís abrir no Excel. Conferir: R$ com vírgula, data como data, ordenar por valor funciona.
  - **Plano B:** se falhar, usar `exceljs` (`stream.xlsx.WorkbookWriter`), trocar a dependência e registrar o desvio no plano e na DD-42.
- [ ] **fflate:** `zipSync({ "lancamentos.csv": strToU8(csv), "historico.csv": ... })` gera um zip que o Windows abre.
- [ ] **pg-boss:**
  - conferir no `node_modules/pg-boss` (tipos e README da versão instalada) que `send(queue, data, { startAfter: <segundos> })` aceita 7 dias;
  - verificar qual opção de fila controla quanto tempo um job `created` sobrevive (`retentionSeconds`, ou o nome da versão). Configurar a fila `delete-export-file` com retenção de pelo menos 8 dias.
  - **Plano B:** se não der para reter 7 dias, `delete-export-file` vira um job diário que se reagenda. O payload leva só `tenantId`: lista os vencidos daquele tenant e se reenfileira por 24 h, e é criado na primeira exportação do tenant.
- [ ] Registrar o resultado na seção "Desvios" do plano, se houver.
- [ ] Sugerir o commit `chore(api): write-excel-file e fflate (D-F7)`.

### T3: Contrato e permissão `export:full` — CRÍTICA
**Modify:**
- `packages/core/src/permissions/permissions.ts`: `"export:full"` em `ACTIONS`, dado só ao owner.
- `packages/core/src/contracts/entries.ts`: extrair o filtro.
- `packages/core/src/contracts/index.ts`: `export * from "./exports"`.

**Create:** `packages/core/src/contracts/exports.ts`.

**Test:** `permissions.test.ts` e `contracts/exports.test.ts`.

**Interfaces (Produces):**
```ts
// entries.ts: sem mudar o comportamento de entryListQuerySchema
export const entryFiltersSchema /* z.object({from,to,type,unitIds,categoryIds,supplierId,paymentMethodId,salesChannelId,createdBy,originChannel,flags,q}).superRefine(periodRefine) */;
export type EntryFilters = z.infer<typeof entryFiltersSchema>;
// entryListQuerySchema = z.object({ ...shape dos filtros, sort, dir, cursor, limit }).superRefine(periodRefine)

// exports.ts
export const EXPORT_FORMATS = ["xlsx", "csv"] as const;
export const EXPORT_CONTENTS = ["entries", "full"] as const;
export const EXPORT_STATUSES = ["queued", "generating", "ready", "failed"] as const;
export const EXPORT_ERROR_CODES = ["forbidden", "too_many_rows", "generation_failed"] as const;
export const EXPORT_LINK_TTL_SECONDS = 3600;
export const EXPORT_RETENTION_DAYS = 7;
export const EXPORT_MAX_ROWS = 100_000;
export const EXPORT_MAX_PENDING = 3;
export const exportCreateBodySchema = z.object({
  format: z.enum(EXPORT_FORMATS), content: z.enum(EXPORT_CONTENTS),
  filters: entryFiltersSchema, clientRequestId: z.uuid(),
}).strict();
export const exportItemSchema = z.object({
  id: idSchema, format: z.enum(EXPORT_FORMATS), content: z.enum(EXPORT_CONTENTS),
  status: z.enum(EXPORT_STATUSES), rowCount: z.int().nullable(), fileSize: z.int().nullable(),
  errorCode: z.enum(EXPORT_ERROR_CODES).nullable(), filters: entryFiltersSchema,
  createdAt: timestampSchema, finishedAt: timestampSchema.nullable(), available: z.boolean(),
}).strict();
export const exportListResponseSchema = z.object({ items: z.array(exportItemSchema) }).strict();
export const exportLinkResponseSchema = z.object({ url: z.string().startsWith("/api/exports/"), expiresAt: timestampSchema }).strict();
export type ExportItem = z.infer<typeof exportItemSchema>; // + ExportFormat, ExportContent, ExportStatus, ExportErrorCode, ExportCreateBody
```

**Testes:**
- `can(owner,"export:full")` é true. É false para manager com EXPORTAR_DADOS, accountant e staff.
- `allowedActions(owner)` contém `export:full`.
- `exportCreateBodySchema` recusa `sort` dentro de `filters` (strict), `format:"pdf"` e período invertido. Aceita o corpo mínimo.
- Os testes atuais de `entryListQuerySchema` continuam verdes, sem mudança.

- [ ] Escrever os testes primeiro, ver falhar, implementar e rodar `pnpm --filter @app/core test -- permissions contracts`.
- [ ] Rodar `pnpm --filter @app/core typecheck`.
- [ ] Rodar `pnpm --filter @app/web typecheck`, porque `allowedActions` aparece no web.
- [ ] Sugerir o commit `feat(core): contrato de exportação e permissão export:full`.

### T4: Colunas, CSV e histórico no core — NATIVA
**Create:**
- `packages/core/src/exports/columns.ts`
- `csv.ts`
- `history.ts`
- `format.ts`
- `index.ts`, mais o export no `packages/core/src/index.ts`

**Test:** `*.test.ts` ao lado de cada um.

**Interfaces (Produces):**
```ts
export type ExportCellType = "text" | "date" | "datetime" | "money" | "int" | "decimal";
export interface ExportColumn<R> { key: string; label: string; type: ExportCellType; value: (row: R) => string | number | null }
export interface ExportEntryRow { /* EntryRow + subcategory, categoryParentName, dreGroup, nature, supplierDocument, deletedAt; montado em T7 */ }
export const ENTRY_EXPORT_COLUMNS: readonly ExportColumn<ExportEntryRow>[]; // ordem do RF29.R3
export const FULL_EXPORT_EXTRA_COLUMNS: readonly ExportColumn<ExportEntryRow>[]; // Situação, Excluído em
export interface ExportHistoryRow { entryId: string; version: number; changedAt: string; author: string; channel: string; field: string; before: string; after: string }
export const HISTORY_EXPORT_COLUMNS: readonly ExportColumn<ExportHistoryRow>[];
export function historyRows(versions: readonly EntryVersionInput[], names: VersionNames): ExportHistoryRow[];
export function centsToDecimalText(cents: number): string;      // -123456 -> "-1234,56"
export function businessDateToBR(date: string): string;          // "2026-10-05" -> "05/10/2026"
export function timestampToBR(iso: string, tz = "America/Sao_Paulo"): string; // "dd/mm/aaaa hh:mm"
export function neutralizeFormula(text: string): string;         // '=' '+' '-' '@' '\t' '\r' no início ganham "'"
export function toCsv<R>(columns: readonly ExportColumn<R>[], rows: readonly R[]): string; // BOM + ; + \r\n
```

`EntryVersionInput` é o formato de `EntryVersionRow` (`entry-reader.ts:41`), redeclarado no core sem importar o db.

Ordem e rótulos das colunas, copiados do RF29.R3:

> Data de competência, Data de pagamento, Tipo, Descrição, Quantidade, Unidade de medida, Valor bruto, Taxa, Líquido, Pedidos, Categoria, Subcategoria, Grupo do DRE, Natureza, Fornecedor, Documento do fornecedor, Forma de pagamento, Canal, Unidade, Lançado por, Canal de origem, Sinais de revisão, Criado em.

Como montar algumas colunas:
- **Categoria e Subcategoria:** se a categoria tem pai, Categoria = pai e Subcategoria = a própria. Se não tem, Subcategoria fica vazia.
- **Grupo do DRE:** usar `dreGroupLabel`.
- **Natureza:** "Fixa" ou "Variável".
- **Tipo:** "Receita" ou "Despesa".
- **Sinais e canal de origem:** usar os rótulos do painel. Se esses rótulos estão só no web, movê-los para `packages/core/src/entry/labels.ts` e fazer o web importar de lá, sem mudar o texto.

**Testes:**
- `toCsv` começa com `﻿` e usa `;` e `\r\n`.
- `Pão de açúcar` sai intacto (CA02).
- Campo com `;` sai entre aspas; aspas são dobradas.
- `centsToDecimalText(-123456) === "-1234,56"` e `centsToDecimalText(5) === "0,05"`.
- Review Focus 4.
- `timestampToBR("2026-10-01T02:30:00Z") === "30/09/2026 23:30"`.
- `historyRows` com um snapshot ilegível gera "(ilegível)" sem valores.
- `ENTRY_EXPORT_COLUMNS.map(c => c.label)` é igual à lista acima.

- [ ] Fazer em TDD e rodar `pnpm --filter @app/core test -- exports`.
- [ ] Rodar o typecheck do core e o Biome dos arquivos tocados.
- [ ] Sugerir o commit `feat(core): colunas, CSV e histórico da exportação`.

### T5: Tabela `exports` (migration 0021) — CRÍTICA
Seguir `.claude/rules/tabela-nova.md` inteiro.

**Create:** `packages/db/schema/exports.ts` (exportar no `schema/index.ts`) e `packages/db/migrations/0021_exports.sql`, gerado por `pnpm db:generate --name exports` e completado à mão com:
- `ENABLE` e `FORCE ROW LEVEL SECURITY`;
- `REVOKE ALL` do `app`;
- `GRANT SELECT, INSERT, UPDATE` ao `app`.

**Modify:**
- `packages/db/test/fixtures.ts`: `"exports"` em `TABLES`, na ordem alfabética, e a entrada em `insertsFor` com colunas mínimas válidas (format `csv`, content `entries`, status `queued`, filters `{}`, client_request_id).
- `packages/db/src/schema.test.ts`: "define as **27** tabelas".

**Colunas:** as da tabela A.6 do desenho, com CHECKs no schema por `oneOf(...)`, o índice único de `(tenant_id, requested_by, client_request_id)` e o índice da lista.

**Testes:** o meta-teste de isolamento (`pnpm --filter @app/db test:int`) passa com a tabela nova. O papel `app` não consegue DELETE (`permission denied`).

- [ ] Revisar o SQL gerado, rodar `pnpm db:migrate` e `pnpm --filter @app/db test:int`.
- [ ] Sugerir o commit `feat(db): tabela exports com RLS (F5)`.

### T6: `exportsRepo` — CRÍTICA
**Create:** `packages/db/src/exports-repo.ts` (export no index) e `packages/db/src/exports-repo.int.test.ts`.

**Interfaces (Produces):**
```ts
export interface ExportRecord { id: string; tenantId: string; requestedBy: string; unitChoice: string; format: ExportFormat; content: ExportContent; filters: EntryFilters; status: ExportStatus; rowCount: number | null; fileKey: string | null; fileSize: number | null; errorCode: ExportErrorCode | null; createdAt: string; startedAt: string | null; finishedAt: string | null; fileDeletedAt: string | null }
export const EXPORTS_CLIENT_REQUEST_UNIQUE = "exports_client_request_unique";
export const exportsRepo = {
  insert(tx, input: { id; tenantId; requestedBy; unitChoice; format; content; filters; clientRequestId }): Promise<ExportRecord>,
  findByClientRequest(tx, requestedBy: string, clientRequestId: string): Promise<ExportRecord | null>,
  get(tx, id: string): Promise<ExportRecord | null>,
  listForUser(tx, requestedBy: string, since: Date): Promise<ExportRecord[]>,   // created_at desc
  countPending(tx, requestedBy: string): Promise<number>,                       // queued + generating
  markGenerating(tx, id): Promise<boolean>,      // where status='queued'
  markReady(tx, id, { fileKey, fileSize, rowCount }): Promise<boolean>, // where status='generating'
  markFailed(tx, id, errorCode): Promise<boolean>, // where status in ('queued','generating')
  markFileDeleted(tx, id): Promise<boolean>,     // where file_deleted_at is null
  audit(tx, { tenantId, actorId, action: "export_requested"|"export_ready"|"export_failed"|"export_downloaded", exportId, metadata }): Promise<void>, // insert em audit_log, target = exportId
};
export function isExportAvailable(r: ExportRecord, now: Date): boolean; // ready && file_deleted_at null && createdAt > now-7d
```
A idempotência segue `escrita-idempotente.md`: a rota faz `findByClientRequest` e, se o `insert` violar a unicidade, relê fora do `withTenant` com `isUniqueViolation`.

**Testes (int):**
- as transições recusam a situação errada e devolvem `false`;
- `listForUser` não traz pedidos de outro usuário;
- `countPending` conta só `queued` e `generating`;
- outro tenant não enxerga, sob RLS;
- `audit` grava em `audit_log` com `action` e `metadata`;
- `isExportAvailable`: limite de 7 dias exatos, com unitário.

- [ ] Fazer em TDD, rodar `pnpm --filter @app/db test:int -- exports-repo` e depois o typecheck.
- [ ] Sugerir o commit `feat(db): repositório de exportações`.

### T7: Leitura para exportação no `entryReader` — CRÍTICA
**Modify:** `packages/db/src/entry-reader.ts` e `entry-reader.int.test.ts`.

**Interfaces (Produces):**
```ts
// conditions(scope, query, sensitivity, opts?: { includeDeleted?: boolean }) — padrão false; chamadas atuais intactas
exportRows(tx: Transaction, scope: EntryScope, filters: EntryFilters, opts: { includeDeleted: boolean; limit: number }): Promise<ExportEntryRow[]>;
// lê limit linhas; quem chama passa EXPORT_MAX_ROWS + 1
exportVersions(tx: Transaction, entryIds: readonly string[]): Promise<EntryVersionRow[]>; // entry_id = any($1), order by entry_id, version
exportVersionNames(tx: Transaction): Promise<VersionNames>; // reaproveitar o carregador de nomes do histórico de GET /api/entries/:id/history
```

**Regras:**
- usa os mesmos `ROW_COLUMNS`, mais as junções de categoria pai e o documento do fornecedor;
- a sensibilidade vem de `sensitiveExpression` (nada de `coalesce`);
- com `includeDeleted`, ativos e lixeira entram juntos;
- ordem `occurred_on asc, created_at asc, id asc`.

**Testes (int)**, com o seed de referência dos testes do reader:
- **Paridade CA01:** para três filtros (período, período mais tipo, período mais unidade), a contagem de `exportRows` é igual a `totals.count`, e a soma de `amountCents` por tipo é igual a `revenueCents` e `expenseCents`.
- Escopo de gerente sem VER_FOLHA: nenhuma linha sensível. Escopo de contador: a linha da folha aparece.
- Lançador (`ownerUserId`): só os próprios lançamentos.
- `includeDeleted:false` exclui a lixeira; `true` inclui, com `deletedAt`.
- Uma categoria de outro tenant não vaza.
- Subcategoria e pai vêm preenchidos.

- [ ] Fazer em TDD e rodar `pnpm --filter @app/db test:int -- entry-reader`.
- [ ] Sugerir o commit `feat(db): leitura de lançamentos para exportação`.

### T8: Porta de arquivo e serializadores — NATIVA
**Modify:** `packages/core/src/ports/ports.ts`.

**Create:**
- `apps/api/src/infra/exports/local-export-store.ts`
- `export-writers.ts`
- os testes de cada um.

**Interfaces (Produces):**
```ts
export interface ExportFileStore {
  put(key: string, bytes: Uint8Array): Promise<void>;   // sobrescreve
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;                   // chave ausente não é erro
}
export function exportFileKey(tenantId: string, exportId: string, ext: "xlsx" | "csv" | "zip"): string; // `exports/${tenantId}/${exportId}.${ext}`
export function createInMemoryExportStore(): ExportFileStore & { keys(): string[] };
export function createLocalExportStore(dir: string, nodeEnv: string): ExportFileStore; // lança em production; impede path traversal (chave validada por regex)
export interface ExportSheet<R> { name: string; columns: readonly ExportColumn<R>[]; rows: readonly R[] }
export function writeXlsx(sheets: readonly ExportSheet<any>[]): Promise<Uint8Array>; // money: cents/100 c/ format '"R$" #,##0.00'; date: Date UTC 'dd/mm/yyyy'; datetime: Date 'dd/mm/yyyy hh:mm'; text: neutralizeFormula
export function writeCsv<R>(sheet: ExportSheet<R>): Uint8Array;                    // toCsv do core, UTF-8
export function zipFiles(files: Record<string, Uint8Array>): Uint8Array;           // fflate zipSync
export function exportFileName(content: ExportContent, format: ExportFormat, filters: EntryFilters): string; // lancamentos_2026-10-01_2026-10-31.xlsx | lancamentos-completo_….zip
export function exportContentType(ext: "xlsx" | "csv" | "zip"): string;
```

**Testes:**
- Reler o XLSX com o próprio zip (fflate `unzipSync`) e conferir que o `sheet1.xml` tem a célula de valor como número (`<v>1234.56</v>`, sem `t="s"`) e que o `styles.xml` traz o `numFmt` `"R$" #,##0.00`.
- O CSV gerado começa com os bytes `EF BB BF`.
- O zip tem as duas entradas.
- `createLocalExportStore` recusa `NODE_ENV=production` e recusa a chave `../x`.
- Review Focus 4 no XLSX.

- [ ] Fazer em TDD e rodar `pnpm --filter @app/api test -- exports`.
- [ ] Sugerir o commit `feat(api): porta de arquivo e serializadores de exportação`.

### T9: Token do link — CRÍTICA
**Create:** `apps/api/src/infra/exports/export-link.ts` e o teste.

**Interfaces (Produces):**
```ts
export function createExportLinkSigner(secret: string, clock: { now(): Date }): {
  issue(input: { exportId: string; userId: string; tenantId: string }): { token: string; expiresAt: Date };
  verify(token: string, input: { exportId: string; userId: string; tenantId: string }): boolean;
};
// chave = hkdfSync("sha256", secret, "", "export-link", 32); token = base64url(`${expiresAtEpoch}.${hmac}`); timingSafeEqual
```

**Testes:**
- Review Focus 3.
- Token de outro `exportId`, `userId` ou `tenantId` dá `false`.
- Token adulterado ou malformado (sem ponto, base64 inválido) dá `false` e não lança.
- Dois `issue` seguidos geram tokens que verificam.

- [ ] Fazer em TDD.
- [ ] Sugerir o commit `feat(api): token de 1 hora para o link da exportação`.

### T10: Workers `generate-export` e `delete-export-file` — CRÍTICA
Seguir a skill `novo-worker-pgboss` e `.claude/rules/pg-boss.md`.

**Create:**
- `apps/api/src/modules/exports/generate-export.ts`, o caso de uso;
- `delete-export-file.ts`;
- `queues.ts`, com nomes e payload Zod `{ tenantId: uuid, exportId: uuid }`;
- `apps/api/src/infra/exports-queue.ts`, que cria a DLQ e depois a fila, e chama `updateQueue`; a retenção de `delete-export-file` sai da T2;
- os testes de integração.

**Modify:**
- `apps/api/src/composition.ts` e `worker.ts`: o worker abre o pool `DATABASE_AUTH_URL` para o `PanelAccessStore` e registra as duas filas.
- `createPgBossQueue` passa a garantir também as filas novas.

**Interfaces (Produces):**
```ts
export const GENERATE_EXPORT_QUEUE = "generate-export"; export const DELETE_EXPORT_FILE_QUEUE = "delete-export-file";
export function createGenerateExport(deps: { appDb: Database; access: PanelAccessStore; store: ExportFileStore; queue: JobQueue; clock: Clock; logger }): (payload: { tenantId: string; exportId: string }) => Promise<"done" | "skipped">;
export function createDeleteExportFile(deps: { appDb; store; logger }): (payload) => Promise<"done" | "skipped">;
```

**Passos do `generate-export`:**
1. `markGenerating`. Se o pedido já estiver `generating`, continua, porque é um retry. Se estiver em outra situação, devolve `skipped`.
2. Monta o ator: `resolvePanelContext(await access.listPanelMemberships(record.requestedBy), { tenantId, unitId: record.unitChoice })`.
3. Falha com `forbidden` em qualquer um destes casos:
   - a resolução não está `ok`;
   - `source !== "cookie"`;
   - o `tenantId` é diferente;
   - falta `can(actor,"export:data")`;
   - o conteúdo é `full` e falta `can(actor,"export:full")`.
4. Monta o escopo com `entryScopeFor({ actor, userId, activeUnitId: unitChoice, requestedUnitIds: filters.unitIds })`. Se der erro, falha com `forbidden`.
5. Lê as linhas com `exportRows(limit = EXPORT_MAX_ROWS + 1)`. Se vier mais que o teto, falha com `too_many_rows`.
6. Para o conteúdo `full`, lê também as versões e os nomes e monta `historyRows`.
7. Serializa no formato pedido, faz `put(exportFileKey(...))`, `markReady` e grava a auditoria `export_ready` com `{ rowCount }`.
8. Enfileira `delete-export-file` com `startAfterSeconds: 7*86400`.
9. Exceção inesperada: deixa o pg-boss tentar de novo. Na última tentativa (DLQ), um handler `onFinalFailure` faz `markFailed("generation_failed")` e grava a auditoria. A mensagem de erro não é persistida.
10. Falha de domínio (`forbidden`, `too_many_rows`): `markFailed` e `export_failed` na mesma transação. Não há retry.

**Testes (int, Testcontainers, config rápida):**
- O caminho feliz de cada combinação (xlsx ou csv, entries ou full) grava o arquivo no store em memória e `ready` com `rowCount` certo.
- Review Focus 1 e 5.
- O contador gera o arquivo com a folha.
- O job repetido depois de `ready` devolve `skipped`, sem segundo `put`.
- Com `EXPORT_MAX_ROWS` trocado por injeção (deps com `maxRows` opcional, padrão a constante), o teto vira `too_many_rows`.
- `delete-export-file` apaga a chave, marca `file_deleted_at`, e o segundo job devolve `skipped`.

- [ ] Fazer em TDD e rodar `pnpm --filter @app/api test:int -- exports`.
- [ ] Sugerir o commit `feat(api): workers de exportação`.

### T11: Rotas `/api/exports` — CRÍTICA
Seguir `rota-de-tenant.md` e `escrita-idempotente.md`.

**Create:** `apps/api/src/http/exports/exports-routes.ts` e o teste.

**Modify:**
- `apps/api/src/app.ts`: registrar com as deps do painel, mais `exportStore`, `queue`, `linkSigner` e `clock`.
- `composition.ts`.
- `apps/api/test/support/route-matrix.ts`.

**Rotas (preHandler `requirePanelContext`, `requireTenantRoute`, `requirePermission("export:data")`):**
- **`POST /api/exports`**
  - O corpo passa por `exportCreateBodySchema`; inválido dá 400 `invalid_request`.
  - `content:"full"` sem `export:full` dá 403 `forbidden`.
  - Se o `clientRequestId` já existe para o usuário, devolve **200** com o item.
  - Se já há `countPending >= 3`, devolve 429 `too_many_pending`.
  - A unidade dos filtros passa por `entryScopeFor`; se falhar, 403.
  - Grava o pedido com `insert`, `audit("export_requested", { format, content, filters: { ...filters, q: filters.q ? "[busca]" : undefined } })` e `queue.enqueue(GENERATE_EXPORT_QUEUE, …)`. Resposta **202** com o item.
- **`GET /api/exports`**: `listForUser(userId, now - 7d)`, mapeado para `exportItemSchema` com `available` de `isExportAvailable`.
- **`POST /api/exports/:id/link`**
  - Outro usuário, outro tenant ou id inexistente dão **404** `export_not_found`.
  - Fora de `ready` dá 409 `export_not_ready`.
  - Pedido não disponível dá 410 `export_expired`.
  - No caminho certo, devolve `{ url: "/api/exports/<id>/download?t=<token>", expiresAt }`.
- **`GET /api/exports/:id/download`**
  - Ordem: 404 (autor), depois 403 `link_invalid`, depois 410.
  - O arquivo vem de `store.get`; se for `null`, 410.
  - Headers:
    - `Content-Type` por `exportContentType`;
    - `Content-Disposition: attachment; filename="<exportFileName>"`;
    - `Cache-Control: no-store`;
    - `X-Content-Type-Options: nosniff`.
  - Grava a auditoria `export_downloaded`.
- Toda resposta JSON passa por `schema.parse`.

**Matriz** (`ROUTE_MATRIX`): as quatro rotas. Respostas esperadas por persona:
- `owner`, `accountant` e `manager` (o fixture tem EXPORTAR_DADOS?): permitido. Conferir o fixture: se o `manager` não tiver, ele recebe 403, e `managerNoPayroll` segue a mesma conferência.
- `staff`: 403.
- `restricted`: igual às outras rotas de leitura.
- `readOnly`: **permitido** (chamada 1).

O `url` de link e download usa um export criado no setup da matriz para cada persona.

**Testes:**
- Review Focus 2, 3 e 6.
- CA03: gerente sem EXPORTAR_DADOS recebe 403 no POST.
- CA04: o link do dono aberto com a sessão do usuário de outra empresa dá 404.
- CA05: o relógio avança 3601 s e o download dá 403.
- Com duas empresas, o `GET /api/exports` de A não traz pedido de B.
- O download sem `t` dá 403.
- O `POST` sem `Origin` é recusado pelo `originGuard`, que já existe; o teste só confirma.

- [ ] Fazer em TDD e rodar `pnpm --filter @app/api test:int -- exports-routes route-matrix`.
- [ ] Sugerir o commit `feat(api): rotas de exportação`.

### T12: API falsa do E2E — HAIKU
**Create:** `apps/web/e2e/fake-exports.mjs`.

**Modify:** `apps/web/e2e/fake-api.mjs`, perto da linha 369: rotear `/api/exports*` para `answerExports`. O `__reset` chama `resetExports`. Nas personas, `ACTIONS_BY_ROLE.owner` ganha `export:full`.

**Comportamento fixo:**
- `POST` cria `{status:"queued"}` com `id` sequencial e responde 202; repetir o `clientRequestId` responde 200.
- Cada `GET /api/exports` avança `queued` → `generating` → `ready`, um passo por chamada, com `rowCount: 3`.
- `link` devolve `{ url: "/api/exports/<id>/download?t=fake", expiresAt }`.
- `download` devolve um CSV de 3 linhas, com BOM, `Content-Disposition` com `lancamentos_….csv`.
- Um corpo com `filters.q === "falhar"` termina em `failed`/`generation_failed`.

- [ ] Implementar e testar à mão com `node apps/web/e2e/fake-api.mjs` mais `curl`.
- [ ] Sugerir o commit `test(web): API falsa de exportações`.

### T13: Cliente, hooks e diálogo de exportação — NATIVA
**Create:**
- `apps/web/features/exports/exports-api.ts`
- `use-exports.ts`
- `export-dialog.tsx`
- os testes de componente

**Modify:** a barra da lista de lançamentos (`features/entries/filters-bar.tsx` ou o cabeçalho de `entries-view.tsx`; escolher o que já tem ações), com o botão "Exportar" só com `export:data`.

**Interfaces:**
```ts
exportsApi(client) = { list(): Promise<ExportListResponse>; create(body: ExportCreateBody): Promise<ExportItem>; link(id): Promise<ExportLinkResponse> }
useExports(ctx, { poll: boolean })  // chave tenantKey(ctx, "exports"); refetchInterval 3000 enquanto algum item queued|generating
useCreateExport(ctx)                // invalida tenantKey(ctx, "exports")
useDownloadExport(ctx)              // link() e window.location.assign(url)
```

**Diálogo:**
- Formato: rádio, XLSX como padrão.
- Conteúdo: rádio, só com `export:full`. O COMPLETO tem a nota "inclui lixeira e histórico".
- Resumo: período em `dd/mm/aaaa` e "N filtros aplicados".
- Filtros: `parseFilters` da URL, sem `sort` e `dir`.
- Chave de tentativa e trava síncrona como na F3c.
- Sucesso: fecha o diálogo e mostra "Exportação na fila. Acompanhe em **Exportações**". O 429 mostra "Você já tem 3 exportações em andamento".

**Testes:**
- O botão não aparece sem `export:data`.
- COMPLETO só com `export:full`.
- O corpo enviado tem os filtros da URL e não tem `sort`.
- Um erro de rede reenvia o mesmo `clientRequestId`.

- [ ] Fazer em TDD, rodar `pnpm --filter @app/web test -- exports` e o typecheck.
- [ ] Sugerir o commit `feat(web): diálogo de exportação na lista`.

### T14: Tela `/exportacoes` e notificador — NATIVA
**Create:**
- `apps/web/features/exports/exports-screen.tsx`
- `export-notifier.tsx`
- os testes

**Modify:**
- `apps/web/app/(app)/exportacoes/page.tsx`: troca `UnderConstruction` pela tela e mantém o `PageGuard`.
- `components/app-shell.tsx`: o notificador, só com `export:data`.

**Tela:**
- Tabela no computador e cartões no celular.
- Colunas: Pedido em (data e hora), Formato, Conteúdo, Período, Linhas, Situação e ação.
- Situação: Na fila, Gerando, Pronta, Falhou, Expirada (quando `ready` e `!available`).
- **Baixar** só aparece quando `available`.
- Estado vazio: "Nenhuma exportação nos últimos 7 dias. Exporte pela lista de Lançamentos." com link.
- Usar o padrão `useIsClient` do dashboard se a tela usar `useSuspenseQuery`.

**Notificador:**
- Guarda num `useRef` os ids pendentes.
- Quando um id passa a `ready` ou `failed`, mostra a faixa `role="status"` com Baixar ou Ver exportações, e um botão "Fechar".
- Não aparece em `/acesso-restrito`, porque o grupo `(app)` só monta com sessão completa.

**Testes:**
- A transição de pendente para pronta mostra a faixa; carregar com algo já pronto não mostra.
- A situação "Expirada" aparece sem botão.
- Sem pendente, a lista não refaz a consulta.

- [ ] Fazer em TDD e rodar os testes do web.
- [ ] Sugerir o commit `feat(web): tela de exportações e aviso de pronta`.

### T15: E2E — NATIVA
**Create:** `apps/web/e2e/exports.spec.ts`, com um worker só (API falsa com estado) e `__reset` no `beforeEach` e no `afterEach`.

**Cenários:**
- O dono abre a lista com filtro, clica em Exportar, escolhe CSV, a faixa "pronta" aparece, e Baixar dispara um `download` com `suggestedFilename` igual a `lancamentos_…csv` e conteúdo que começa com BOM.
- O dono vê COMPLETO; o contador não vê.
- O lançador não vê o botão, e `/exportacoes` mostra "Você não tem acesso".
- `/exportacoes` no Pixel 7, sem rolagem horizontal.
- axe sem violações na tela e no diálogo.
- Falha: `q=falhar` mostra "Falhou".

- [ ] Rodar `pnpm --filter @app/web exec playwright test exports --project="Desktop Chrome"` e depois os dois projetos.
- [ ] Sugerir o commit `test(web): E2E de exportação`.

### T16: Fechamento — NATIVA
- [ ] Rodar `pnpm typecheck && pnpm lint && pnpm test`, `pnpm --filter @app/db test:int`, `pnpm --filter @app/api test:int` e o E2E com `CI=true`. Gatilho: dependência e schema novos.
- [ ] Atualizar a tabela de progresso de `docs/planos/painel.md` (F5 Feita, com a data real) e o `andamento.md`.
- [ ] Atualizar o "Estado atual" do `CLAUDE.md` da raiz.
- [ ] Criar a seção "Exportações (`features/exports`, F5)" em `apps/web/CLAUDE.md`, sobre o notificador, o download e a ausência de `sort`.
- [ ] Propor, sem criar, uma regra `.claude/rules/exportacao.md`: download só pela API, recorte recalculado no worker e fórmula neutralizada.
- [ ] Escrever o roteiro à mão para o Luís em `docs/planos/f5-roteiro.md`:
  1. `pnpm dev` e `pnpm dev:worker`.
  2. Como dono, exportar outubro em XLSX e abrir no Excel. A soma da coluna "Valor bruto" e a contagem de linhas devem ser iguais aos totais da lista (CA01).
  3. Exportar em CSV e abrir no Excel: "Pão de açúcar" correto e cada campo na sua coluna (CA02).
  4. Exportar o COMPLETO em CSV: o zip traz os dois arquivos.
  5. Como gerente sem EXPORTAR_DADOS, o botão não aparece (CA03).
  6. Copiar o link de download e abrir em outra sessão: 404 (CA04).
  7. Esperar 1 h, ou forçar o relógio, e abrir: 403 (CA05).
  8. Conferir `audit_log` no banco.
- [ ] Sugerir o commit `docs: F5 feita`.

## Contagem por classe
- HAIKU: 2 (T1, T12)
- NATIVA: 7 (T2, T4, T8, T13, T14, T15, T16)
- CRÍTICA: 7 (T3, T5, T6, T7, T9, T10, T11)

## Verificação ponta a ponta
- O roteiro da T16.
- `pnpm dev:chat` não muda.
- O teste de paridade da T7 prova o CA01 no banco.
- O E2E da T15 prova o download na tela.
- A matriz da T11 prova as permissões.
