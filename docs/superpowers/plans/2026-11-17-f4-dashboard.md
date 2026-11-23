# F4 Dashboard: plano de tarefas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o dashboard do RF27 com os números calculados no servidor e reconciliados com o banco.

**Architecture:**
- Três rotas de agregação (`/api/reports/summary`, `/monthly` e `/breakdown`) sobre um `reportReader` com SQL `FILTER` e `GROUP BY`.
- As contas de razão, variação, ticket e ponto de equilíbrio ficam em `packages/core/src/reports`.
- O contrato Zod `.strict()` fica em `@app/core/contracts`.
- No web, um bloco por consulta, com `useSuspenseQuery` e o chart do shadcn.

**Tech Stack:** Fastify, Zod 4, Drizzle (SQL cru com `sql`), Postgres com RLS, Next 16 e React 19, TanStack Query 5, recharts 3.10, shadcn (`base-nova`), Vitest, Testcontainers, Playwright e `@axe-core/playwright` (novo, devDependency).

**Spec:** `docs/superpowers/specs/2026-11-17-f4-dashboard-design.md`.

## Global Constraints

- Dinheiro é inteiro em centavos. Percentual é inteiro em décimos de ponto percentual. Nada de float na resposta. O arredondamento é meio para longe do zero, com `BigInt` nas contas intermediárias (RNF13, DD-38).
- Período por `occurred_on` (RF12.R21), com até 24 meses (`MAX_PERIOD_MONTHS`). Padrão: mês corrente até hoje (RF27.R1).
- Sem receita, margem, CMV, folha e ticket são `null` (RF27.R4, CA04). Ponto de equilíbrio com bruta 0 ou bruta − variáveis ≤ 0 também é `null` (R8).
- `payrollRatio` só é enviado se `canSeePayroll` (R5, CA02). `estimatedTax` nunca é enviado na F4 (CA08).
- Investimento fica fora do resultado (R3, CA03).
- A lixeira não entra. A unidade fora do acesso dá 403. O lançador dá 403 em todas as rotas `/api/reports/*`.
- Rótulos fixos: "Não informada" para forma de pagamento nula, "Não informado" para canal nulo, "Pessoal (restrito)", "Taxas e comissões", "Sem categoria" e "Outros".
- Estado vazio: "Ainda não há lançamentos neste período", com link `wa.me`.
- Celular de 360 px sem rolagem horizontal (CA05).
- Erros só `{ code }`. Nenhum valor ou nome no log.

## Review Focus (cada linha vira teste na tarefa dona)

1. Despesa com `category_id` de categoria que a junção não traz conta como operacional, e para quem não vê sensíveis cai no balde `restricted` (T7).
2. Período de comparação sobre 29/02 e sobre a virada de ano: `previous_year` de 2028-02-29 dá 2027-02-28, e `previous_period` de 01/01 a 10/01 dá 22/12 a 31/12 (T3).
3. Resultado negativo: a margem é negativa e arredonda para longe do zero (−12,35% → −124). A variação com anterior negativo usa `|anterior|` (T4).
4. Gerente com acesso a só uma unidade e `unitIds` vazio com o seletor em "todas": o recorte é só a unidade dele, e a outra unidade não soma (T8).
5. A resposta de quem não vê sensíveis não tem a **chave** `payrollRatio` nem nenhum `label` com nome de categoria sensível, inclusive no breakdown (T8).

## Desvios do desenho aprovado

Nenhum.

## Tarefas

### T1: Documentação da regra nova (DD-41, requisitos 1.19, plano) — HAIKU

**Arquivos (Modify):**
- `docs/decisoes.md`: DD-41 depois do DD-40.
- `docs/requisitos.md`: versão 1.19 com data 17/11/2026 no topo e uma linha no histórico, se houver.
- `docs/planos/painel.md`: seção F4 (linhas 367 a 383) e linhas 31, 39 e 51.
- `docs/planos/pendencias.md`: só se houver linha da F4.
- `.claude/rules/sensivel-falha-fechado.md`: item 4.

**Conteúdo exato**
- **DD-41 (17/11/2026), "Dashboard: composição dos indicadores e folha agregada".**
  - Fixa as nove "chamadas minhas" da Parte A e as cinco da seção "Respostas à conferência".
  - Registra as três decisões do Luís (imposto só com lugar reservado na F4, total com folha e detalhe sem, axe como devDependency).
  - Motivo: RF28.CA01 (o resultado é o mesmo para todos) e RF28.Obs4.
- **requisitos.md**, como notas `- **Obs6:**` e `- **Obs7:**` ao fim das observações do RF27 (sem reescrever R1 a R9):
  - Obs6: os totais e o ponto de equilíbrio incluem as categorias sensíveis para todos que veem o dashboard. Só o detalhe e o indicador de folha são restritos ("Pessoal (restrito)" no gráfico, DD-41).
  - Obs7: as definições de deduções, natureza nula, unidade dos percentuais e variação seguem o DD-41.
- **painel.md, seção F4:**
  - Trocar a frase "Ticket médio e ponto de equilíbrio dependem de dados ainda não coletados (P09)" por "Ticket médio e ponto de equilíbrio entram (DD-13, P09 fechada)".
  - Critérios: "RF27.CA01 a CA08".
  - Imposto estimado: "só o lugar no contrato; cálculo e cartão na F12 (DD-41)".
  - Acessibilidade: "axe no E2E (DD-41)".
  - Na linha 39 (F12), acrescentar "recebe o cálculo e o cartão do imposto estimado no dashboard (DD-41)".
- **sensivel-falha-fechado.md, item 4:** acrescentar "Exceção (DD-41): totais agregados do dashboard incluem a folha; o detalhe por categoria vira 'Pessoal (restrito)' e o indicador de folha não é enviado."

**Teste:** `grep -n "DD-41" docs/decisoes.md docs/requisitos.md docs/planos/painel.md` mostra as três ocorrências e `grep -n "1.19" docs/requisitos.md` mostra o topo.

- [ ] Editar os arquivos.
- [ ] Sugerir commit `docs: DD-41 e requisitos 1.19, composição do dashboard (F4)`.

### T2: ⚠️ Confirmar o chart do shadcn com recharts 3.10 e base-nova — NATIVA

**Premissa:** `pnpm dlx shadcn@latest add chart card` (dentro de `apps/web`, sem `--overwrite`) cria `components/ui/chart.tsx` e `card.tsx`, compatíveis com recharts `^3.10.1` e React 19, sem trocar a versão do recharts.

**Arquivos:**
- Create: `apps/web/components/ui/chart.tsx` e `card.tsx` (gerados).
- Test: `apps/web/lib/charts/recharts-compat.test.tsx`, ampliando a prova de conceito existente.

**Teste:** `ChartContainer` com um `BarChart` renderiza `svg.recharts-surface` sem `console.error` nem `console.warn`.

**Passos**
- [ ] Rodar o add.
- [ ] Conferir `git diff apps/web/package.json`: nenhuma versão muda e nenhuma dependência nova entra. Se o CLI tentar trocar a versão do recharts, desfazer.
- [ ] `pnpm --filter @app/web exec vitest run lib/charts`. Esperado: verde.
- [ ] **Plano B** (se o chart gerado não compilar com recharts 3 ou pedir dependência): escrever `components/ui/chart.tsx` mínimo, com `ChartContainer` (div com `aspect-video` e `ResponsiveContainer`), `ChartTooltipContent` simples e cores por `var(--chart-1..5)` de `globals.css`. Registrar o desvio no plano.
- [ ] Sugerir commit `chore(web): componentes chart e card do shadcn (F4)`.

### T3: Períodos de comparação e janela de meses (core) — NATIVA

**Arquivos:**
- Modify: `packages/core/src/contracts/period.ts`.
- Test: `packages/core/src/contracts/period.test.ts`.

**Interfaces (Produces)**
```ts
export const COMPARISON_KINDS = ["previous_period", "previous_year", "none"] as const;
export type ComparisonKind = (typeof COMPARISON_KINDS)[number];
/** null para "none". previous_period: mesmo nº de dias imediatamente antes; previous_year: -12 meses (29/02 → 28/02). */
export function comparisonPeriod(period: Period, kind: ComparisonKind): Period | null;
/** Janela de `count` meses que termina no mês de `to`: from = dia 1 do primeiro mês, to = `to`. */
export function monthsWindow(to: BusinessDate, count: number): Period;
/** Meses "AAAA-MM" da janela, em ordem crescente. */
export function monthsOf(to: BusinessDate, count: number): readonly string[];
```

**Testes**
- `comparisonPeriod({from:"2026-10-01",to:"2026-10-17"},"previous_period")` dá `{from:"2026-09-14",to:"2026-09-30"}`.
- `previous_period` de 2027-01-01 a 2027-01-10 dá 2026-12-22 a 2026-12-31.
- `previous_year` de 2028-02-01 a 2028-02-29 dá 2027-02-01 a 2027-02-28.
- `none` dá `null`.
- `monthsWindow("2026-11-17",6)` dá `{from:"2026-06-01",to:"2026-11-17"}`.
- `monthsOf("2026-02-10",6)` dá `["2025-09",…,"2026-02"]`.

**Passos**
- [ ] TDD (red, green).
- [ ] `pnpm --filter @app/core exec vitest run src/contracts/period.test.ts`.
- [ ] Sugerir commit `feat(core): período de comparação e janela de meses (F4, RF27.R2)`.

### T4: Contas dos indicadores (core) — CRÍTICA

**Arquivos:**
- Create: `packages/core/src/reports/indicators.ts` e `packages/core/src/reports/index.ts`.
- Modify: export no índice do core.
- Test: `packages/core/src/reports/indicators.test.ts`.

**Interfaces (Produces)**
```ts
export interface PeriodSums {
  grossRevenueCents: number; revenueWithOrdersCents: number; ordersCount: number;
  feesCents: number; deductionExpensesCents: number; operatingExpensesCents: number;
  cmvCents: number; payrollCents: number; fixedCostsCents: number;
  investmentsCents: number; entryCount: number;
}
export interface PeriodIndicators {
  grossRevenueCents: number; deductionsCents: number; netRevenueCents: number;
  operatingExpensesCents: number; resultCents: number; investmentsCents: number;
  marginPermille: number | null; cmvRatioPermille: number | null; payrollRatioPermille: number | null;
  averageTicketCents: number | null; ticketCoveragePermille: number | null; breakEvenCents: number | null;
}
export type Direction = "up" | "down" | "flat";
export interface Change { changePermille: number | null; direction: Direction | null }
/** round_half_away(numerator*1000/denominator); denominator <= 0 → null. BigInt por dentro. */
export function ratioPermille(numerator: number, denominator: number): number | null;
export function averageTicketCents(revenueWithOrdersCents: number, ordersCount: number): number | null;
/** fixed*gross/(gross-variable), meio para cima; gross<=0 ou gross-variable<=0 → null. */
export function breakEvenCents(fixedCents: number, variableCents: number, grossCents: number): number | null;
export function computeIndicators(sums: PeriodSums): PeriodIndicators;
/** "money": ratioPermille(cur-prev, |prev|); "permille": cur-prev. null se algum lado é null ou (money) prev = 0. */
export function changeOf(current: number | null, previous: number | null, unit: "money" | "permille"): Change;
export const DRE_GROUP_LABELS: Readonly<Record<string, string>>; // cmv→"CMV", pessoal→"Pessoal", ocupacao→"Ocupação", utilidades→"Utilidades", marketing→"Marketing", manutencao→"Manutenção", impostos→"Impostos", outras→"Outras despesas", operacionais→"Operacionais", financeiras→"Financeiras"
export function dreGroupLabel(group: string): string; // desconhecido → "Outros"
```

**Testes**
- CA06: `averageTicketCents(600000,200) === 3000` e `ratioPermille(600000,1000000) === 600`.
- CA07: `breakEvenCents(2000000,3000000,10000000) === 2857143`.
- CA04: `computeIndicators` com bruta 0 dá margem, CMV, folha, ticket e PE `null`, sem exceção.
- CA03: investimento de 320000 não muda `resultCents`.
- Deduções = fees + deductionExpenses.
- `ratioPermille(-1235,10000) === -124`.
- `ratioPermille(1,0) === null`.
- `changeOf(110,100,"money")` dá `{100,"up"}`.
- `changeOf(5,-10,"money")` dá `{1500,"up"}`.
- `changeOf(100,0,"money").changePermille === null`.
- `changeOf(123,150,"permille")` dá `{-27,"down"}`.
- `changeOf(50,0,"money")` dá `{null,"up"}`.
- `changeOf(null,100,"money")` dá `{null,null}`.
- Um valor perto de `MAX_ENTRY_CENTS` × 1000 não perde precisão.

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/core exec vitest run src/reports`.
- [ ] Revisão (CRÍTICA: dinheiro).
- [ ] Sugerir commit `feat(core): indicadores do dashboard (F4, RF27.R3-R8)`.

### T5: Contrato de relatórios e recorte (core) — CRÍTICA

**Arquivos:**
- Create: `packages/core/src/contracts/reports.ts` e `packages/core/src/permissions/report-scope.ts`.
- Modify: exports.
- Test: `reports.test.ts` e `report-scope.test.ts`.

**Interfaces (Produces)**
```ts
// contracts/reports.ts
export const indicatorSchema = z.object({ value: z.int().nullable(), previous: z.int().nullable(),
  changePermille: z.int().nullable(), direction: z.enum(["up","down","flat"]).nullable() }).strict();
export const dashboardSummarySchema = z.object({
  period: periodSchema, comparison: z.object({ kind: z.enum(["previous_period","previous_year"]), period: periodSchema }).strict().nullable(),
  isEmpty: z.boolean(), ticketCoveragePermille: z.int().nullable(),
  indicators: z.object({ grossRevenue, deductions, netRevenue, operatingExpenses, result, investments,
    margin, cmvRatio, payrollRatio: indicatorSchema.optional(), averageTicket, breakEven }).strict(),
  estimatedTax: z.object({ amountCents: z.int(), revenueSharePermille: z.int().nullable() }).strict().optional(),
}).strict();
export const reportQuerySchema;     // from, to (BusinessDate, from<=to, periodWithinLimit), unitIds (uuid[] repetido, como entryListQuerySchema), compare: ComparisonKind default "previous_period"
export const monthlyQuerySchema;    // to, unitIds
export const monthlyReportSchema = z.object({ months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/),
  revenueCents: z.int(), expenseCents: z.int(), resultCents: z.int() }).strict()).length(6) }).strict();
export const BREAKDOWN_DIMENSIONS = ["category","sales_channel","payment_method"] as const;
export const breakdownQuerySchema;  // from, to, unitIds, by
export const breakdownReportSchema = z.object({ by: z.enum(BREAKDOWN_DIMENSIONS), totalCents: z.int(),
  items: z.array(z.object({ key: z.string(), label: z.string(), amountCents: z.int(), sharePermille: z.int().nullable() }).strict()) }).strict();
export type DashboardSummary, MonthlyReport, BreakdownReport, ReportQuery, MonthlyQuery, BreakdownQuery;
// permissions/report-scope.ts
export interface ReportScope { readonly unitIds: readonly string[] | "all"; readonly canSeePayroll: boolean }
export function reportScopeFor(input: { actor: Actor; activeUnitId: string | "all"; requestedUnitIds?: readonly string[] }): Result<ReportScope, DomainError>;
// mesma resolução de unidades de entryScopeFor, usando can(actor,"report:view",{unitId}); canSeePayroll = can(actor,"entry:view",{categoryIsSensitive:true,isOwnEntry:true})
```

Reutilize a validação de período e de `unitIds` de `entryListQuerySchema` (`contracts/entries.ts`). Se for preciso extrair um helper, faça sem mudar o comportamento.

**Testes**
- `dashboardSummarySchema` recusa chave extra.
- Aceita a resposta sem `payrollRatio`.
- Recusa `value: 1.5`.
- `reportQuerySchema` com período de 25 meses falha.
- Sem `compare`, o padrão é `previous_period`.
- `reportScopeFor`: lançador dá `PermissionDenied`.
- Gerente sem VER_FOLHA dá `canSeePayroll=false`, com VER_FOLHA dá `true`.
- Contador dá `true`.
- Gerente pedindo unidade fora do acesso dá `PermissionDenied`.
- Gerente com o seletor em "all" dá `actor.units`.

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/core exec vitest run src/contracts/reports.test.ts src/permissions/report-scope.test.ts`.
- [ ] `pnpm --filter @app/core typecheck`.
- [ ] Revisão (CRÍTICA: permissão e contrato compartilhado).
- [ ] Sugerir commit `feat(core): contrato de relatórios e recorte do dashboard (F4, RF27.R5)`.

### T6: `reportReader.periodSums` e o seed de referência — CRÍTICA

**Arquivos**
- Create: `packages/db/src/report-reader.ts`.
- Create: `packages/db/test/report-fixtures.ts` (`seedDashboardReference`).
- Test: `packages/db/test/report-reader.int.test.ts`.
- Modify: `packages/db/src/entry-reader.ts`, só para exportar o predicado de unidade e lixeira e a `sensitiveExpression`, sem mudar o comportamento. O teste existente de `entry-reader` continua verde.
- Modify: export no índice do db.

**Interfaces**
```ts
// Consumes: PeriodSums (T4), ReportScope (T5), Period (core), withTenant
export const reportReader: {
  periodSums(tx: Tx, scope: ReportScope, period: Period): Promise<PeriodSums>;
};
// Seed: Produces
export async function seedDashboardReference(admin): Promise<{ tenantA, tenantB, unitA1, unitA2, expected: PeriodSums /* outubro/2026, unidade A1 */ }>;
```

**SQL:** uma consulta com `sum(...) filter (where ...)` conforme a tabela "Definições de cálculo" do desenho, `coalesce(...,0)` e `::bigint`, convertida para número inteiro seguro como faz `entryReader.totals`. O recorte é `deleted_at is null`, `occurred_on between from and to` e a unidade do scope. O `ownerUserId` não entra.

**O seed de referência** (outubro de 2026, tenant A, unidade A1) cobre:
- receitas com e sem `orders`, inclusive o exemplo do CA06 (R$ 6.000,00 com 200 pedidos, mais R$ 4.000,00 sem pedidos);
- `fee_cents` coerente com `net_cents`;
- receita sem forma de pagamento;
- despesa de categoria do tenant com `kind='deduction'`;
- investimento de R$ 3.200,00 (CA03);
- folha (categoria sensível do sistema);
- insumos (CMV);
- aluguel (fixo);
- despesa sem categoria;
- despesa de categoria do tenant com `nature` nula;
- um lançamento na lixeira;
- um lançamento em 30/09;
- um lançamento na unidade A2;
- um lançamento no tenant B, em outubro.

**Testes**
- **CA01 (reconciliação):** para cada campo de `PeriodSums`, uma consulta SQL independente, escrita à mão no teste pela conexão admin com `tenant_id` explícito, dá o mesmo valor que o `periodSums`. O valor também bate com `expected` (números à mão).
- A lixeira, setembro, A2 e o tenant B não entram.
- O scope `["A2"]` soma só A2.

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/db test:int -- report-reader`.
- [ ] Revisão (CRÍTICA).
- [ ] Sugerir commit `feat(db): somas do período para o dashboard e seed de referência (F4, RF27.CA01)`.

### T7: `reportReader.monthlySums` e `breakdown` — CRÍTICA

**Arquivos:** Modify `packages/db/src/report-reader.ts`. Test: o mesmo `report-reader.int.test.ts`.

**Interfaces (Produces)**
```ts
monthlySums(tx, scope: ReportScope, window: Period): Promise<readonly { month: string; grossRevenueCents: number; expenseCents: number /* fees+deduction+operating */ }[]>; // só meses com dados; a rota completa os zeros
breakdown(tx, scope: ReportScope, period: Period, by: BreakdownDimension): Promise<readonly { key: string | null; name: string | null; amountCents: number }[]>;
// by=category: key = 'restricted' quando sensitiveExpression e !scope.canSeePayroll; senão coalesce(c.dre_group,'uncategorized'); mais linha key='deducoes' e key='fees'; investimento fora; name sempre null
// by=sales_channel|payment_method: key = id ou null; name = nome do cadastro ou null
```

**Testes**
- **Monthly:** o seed com dados em setembro e outubro dá duas linhas, e a de outubro dá `gross − expense` igual a `resultCents` do T4 para o mesmo período inteiro.
- **Breakdown de categoria** com `canSeePayroll=false`: tem a chave `restricted` com o valor da folha e não tem `pessoal`.
- Com `true`: tem `pessoal` e não tem `restricted`.
- A soma dos itens é igual a deduções + operacionais.
- **Review Focus 1:** uma despesa com `category_id` de categoria do tenant B (inserida pelo admin) cai em `restricted` para `canSeePayroll=false` e conta em `operatingExpensesCents`.
- **Precedência:** uma categoria sensível do tenant com `kind='deduction'` cai em `deducoes`, nunca com nome.
- **Canal e forma:** a receita sem forma tem `key null`. A soma é igual a `grossRevenueCents`.

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/db test:int -- report-reader`.
- [ ] Revisão (CRÍTICA).
- [ ] Sugerir commit `feat(db): série mensal e quebras do dashboard (F4, RF27 gráficos)`.

### T8: Rotas `/api/reports/*` — CRÍTICA

**Arquivos**
- Create: `apps/api/src/http/reports/reports-routes.ts`.
- Modify: `apps/api/src/app.ts` (registro, como `entriesRoutes`, com deps `{ appDb, ... }` iguais).
- Modify: `apps/api/test/support/route-matrix.ts` (linhas novas).
- Test: `apps/api/src/http/reports/reports-routes.test.ts` (unitário, `fakeDb`).
- Test: `apps/api/test/reports.int.test.ts` (integração, com o seed do T6).

**Interfaces**
- Consumes: `reportScopeFor`, `computeIndicators`, `changeOf`, `comparisonPeriod`, `monthsWindow`, `monthsOf`, `dreGroupLabel`, `ratioPermille`, os schemas do T5 e o `reportReader`.
- Produces: as três rotas. Cada resposta passa por `schema.parse` antes de sair. Um único `withTenant` por requisição (summary: atual e anterior na mesma transação).

**Comportamento**
- `summary`:
  - Indicadores: `{ value, previous, ...changeOf }`. Com `compare=none`, `previous` é null e `change` é null.
  - `isEmpty = entryCount === 0`.
  - `payrollRatio` só com `canSeePayroll`.
  - `estimatedTax` nunca.
- `monthly`: completa os 6 meses com zero. `resultCents = revenue − expense`.
- `breakdown`:
  - Rótulos: `restricted` vira "Pessoal (restrito)", `fees` vira "Taxas e comissões", `deducoes` vira "Deduções", `uncategorized` vira "Sem categoria", e os grupos passam por `dreGroupLabel`. No canal, nulo vira "Não informado"; na forma de pagamento, "Não informada".
  - `key` nulo vira `"none"`.
  - `sharePermille = ratioPermille(amount, total)`.
  - Ordenação por valor decrescente, com a `key` como desempate.
- Erros seguem o padrão do `setErrorHandler` de `entries-routes.ts`.

**Testes de integração**
- **Matriz** (`ROUTE_MATRIX`, as três rotas): dono 200, gerente 200, gerente sem VER_FOLHA 200, lançador 403, lançador sem painel 403, contador 200, sessão restrita conforme as outras rotas de leitura da matriz e conta somente leitura 200.
- **Duas empresas:** o summary do tenant A não muda com os dados do B.
- **CA01:** o summary de outubro bate, campo a campo, com `computeIndicators(expected)`.
- **CA02 e Review Focus 5:** gerente sem VER_FOLHA fica sem a chave `payrollRatio`, sem `label` "Folha de pagamento" e com "Pessoal (restrito)" no breakdown de categoria.
- **CA08:** nenhuma resposta tem `estimatedTax`, mesmo com `tax_settings.enabled=true` gravado para o tenant.
- **CA04:** o período sem receita dá `margin.value` null e status 200.
- **CA03:** o investimento aparece em `investments` e o resultado não muda.
- **Review Focus 4:** gerente de uma unidade com o seletor em "all" não soma A2.
- Unidade fora do acesso em `unitIds` dá 403.
- Período invertido dá 400 `invalid_request`.

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/api exec vitest run src/http/reports`.
- [ ] `pnpm --filter @app/api test:int -- reports`.
- [ ] Revisão (CRÍTICA: permissão e sensível).
- [ ] Sugerir commit `feat(api): rotas de relatório do dashboard (F4, RF27)`.

### T9: Formatação, estado na URL e cliente da API (web) — NATIVA

**Arquivos**
- Modify: `apps/web/lib/format/index.ts` (`formatPermille`).
- Create: `apps/web/features/dashboard/url-state.ts`, `reports-api.ts` e `use-reports.ts`.
- Tests: ao lado de cada arquivo.

**Interfaces (Produces)**
```ts
export function formatPermille(value: number | null): string; // 123→"12,3%", -124→"-12,4%", 0→"0,0%", null→"—"
export interface DashboardParams { from: BusinessDate; to: BusinessDate; unitIds: readonly string[]; compare: ComparisonKind }
export function parseDashboardParams(params: URLSearchParams, today: BusinessDate): DashboardParams; // padrão: dia 1 do mês de today até today; compare "previous_period"; inválido → padrão (como parseFilters)
export function serializeDashboardParams(p: DashboardParams): string;
export function reportsApi(client: ApiClient): { summary(p): Promise<DashboardSummary>; monthly(p): Promise<MonthlyReport>; breakdown(p, by): Promise<BreakdownReport> };
export function useSummary(p), useMonthly(p), useBreakdown(p, by); // useSuspenseQuery, chave tenantKey(ctx,"reports",<bloco>,serialize)
```

**Testes**
- Os casos de `formatPermille`.
- `parseDashboardParams` vazio em `today=2026-11-17` dá `from 2026-11-01`.
- `compare` inválido vira `previous_period`.
- Ida e volta `parse(serialize(x)) == x`.
- `reportsApi` chama a URL certa e valida com o schema (resposta com chave extra rejeita).

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/web exec vitest run features/dashboard lib/format`.
- [ ] Sugerir commit `feat(web): estado e cliente do dashboard (F4)`.

### T10: API falsa do E2E para relatórios — HAIKU

**Arquivos**
- Create: `apps/web/e2e/fake-reports.mjs`.
- Modify: `apps/web/e2e/fake-api.mjs` (rotas `GET /api/reports/summary|monthly|breakdown`).

**Comportamento**
- O lançador recebe 403 `{code:"forbidden"}`.
- Para o dono, a resposta é fixa e válida pelo schema do T5:
  - `grossRevenue.value 1000000`;
  - `deductions 35000`;
  - `operatingExpenses 700000`;
  - `result 265000`;
  - `investments 320000`;
  - `margin 265`;
  - `averageTicket 3000`, com `ticketCoveragePermille 600`;
  - `breakEven 2857143`;
  - `previous` com `grossRevenue 900000`, que dá `changePermille 111`.
- Gerente sem VER_FOLHA: a mesma resposta sem `payrollRatio`, e o breakdown traz "Pessoal (restrito)".
- Os 6 meses terminam em 2026-11.
- `?from=2026-01-01&to=2026-01-31` devolve `isEmpty: true` com zeros.
- Use a persona de gerente sem VER_FOLHA que já existe. Se não houver, crie uma seguindo o padrão das personas.

**Teste:** um teste Vitest que importa as respostas da API falsa e passa cada uma pelos schemas do T5 (no padrão dos testes já existentes da API falsa, se houver). Se não houver padrão, o teste fica em `apps/web/e2e/fake-reports.test.ts` incluído no Vitest.

**Passos**
- [ ] Implementar.
- [ ] Rodar o teste.
- [ ] Sugerir commit `test(web): API falsa de relatórios (F4)`.

### T11: Tela, cartões, filtros, estado vazio e redirecionamento de `/` — NATIVA

**Arquivos**
- Create: `apps/web/features/dashboard/dashboard-screen.tsx`, `dashboard-filters.tsx`, `indicator-cards.tsx`, `empty-state.tsx` e `block-boundary.tsx` (fronteira de erro e `Suspense` por bloco, componente de classe próprio).
- Modify: `apps/web/app/(app)/dashboard/page.tsx` (mantém o `PageGuard action="report:view"` e passa `today`, como a lista faz).
- Modify: `apps/web/app/(app)/page.tsx` (redireciona por `can` sobre o `allowedActions` do contexto: `report:view` vai para `/dashboard`, os demais para `/lancamentos`).
- Modify: `apps/web/lib/navigation.ts` (tira "Início").
- Modify: os testes de menu afetados (`e2e/context.spec.ts` e `lib/navigation.test.ts`, se houver), além de `e2e/routes.ts` e `warm.ts`, se `/` deixar de renderizar.
- Tests: `indicator-cards.test.tsx`, `empty-state.test.tsx` e `block-boundary.test.tsx`.

**Comportamento**
- Cada cartão mostra o valor formatado (`formatCents` ou `formatPermille`), a variação com seta e um texto acessível ("aumento de 11,1% em relação ao período anterior").
- A cor de bom ou ruim sai do mapa fixo por indicador.
- O ticket mostra "base: 60% da receita".
- O cartão "Folha sobre a receita" só existe se `indicators.payrollRatio` vier.
- Com `isEmpty`, o estado vazio aparece no lugar dos blocos, com o link `wa.me`.
- O filtro de período reaproveita os atalhos de `PERIOD_PRESETS`. O de unidade usa as unidades de `/api/entries/options` ou do `me`, como a lista. O de comparação tem três opções.

**Testes**
- Com a resposta sem `payrollRatio`, nenhum cartão "Folha" aparece.
- `averageTicket null` mostra "—".
- O estado vazio tem o link `https://wa.me/5582999990000`.
- Um bloco que lança erro mostra a falha só nele, e o vizinho renderiza.

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/web exec vitest run features/dashboard lib/navigation`.
- [ ] Sugerir commit `feat(web): cartões e filtros do dashboard (F4, RF27)`.

### T12: Gráficos com tabela alternativa — NATIVA

**Arquivos**
- Create: `apps/web/features/dashboard/chart-mappers.ts`, `monthly-chart.tsx` (receita × despesa e evolução do resultado, dois blocos sobre `useMonthly`), `breakdown-chart.tsx` (categoria, canal e forma) e `chart-table.tsx`.
- Tests: `chart-mappers.test.ts`, `monthly-chart.test.tsx` e `breakdown-chart.test.tsx`.

**Interfaces (Produces)**
```ts
export function toMonthlySeries(r: MonthlyReport): { month: string; label: string /* "nov/26" */; revenue: number; expense: number; result: number }[]; // só copia e rotula
export function toBreakdownSeries(r: BreakdownReport): { key: string; label: string; amount: number; share: number | null }[];
```

**Comportamento**
- Cada bloco tem um alternador "Gráfico | Tabela" (Tabs). A tabela usa `components/ui/table`, com valores de `formatCents` e `formatPermille`.
- O gráfico tem `aria-label` com o título do bloco.
- O eixo usa um formatador compacto só de rótulo.
- Os mapeadores não fazem contas.

**Testes**
- Os mapeadores preservam a ordem e os valores, e o rótulo de mês fica em pt-BR.
- A tabela de categoria mostra "Pessoal (restrito)" e "R$ 3.000,00".
- A tabela de canal mostra "Não informado".

**Passos**
- [ ] TDD.
- [ ] `pnpm --filter @app/web exec vitest run features/dashboard`.
- [ ] Sugerir commit `feat(web): gráficos do dashboard com tabela alternativa (F4, RF27.Obs2)`.

### T13: E2E do dashboard e axe — NATIVA

**Arquivos**
- Modify: `apps/web/package.json` (devDependency `@axe-core/playwright` com versão exata, aprovada no DD-41).
- Create: `apps/web/e2e/dashboard.spec.ts`.

**Testes** (nos dois projetos)
- O dono vê "R$ 10.000,00", "R$ 2.650,00", "26,5%", "R$ 30,00", "base: 60% da receita" e "R$ 28.571,43".
- O gerente sem VER_FOLHA não vê o cartão "Folha" e vê "Pessoal (restrito)" na tabela de categoria.
- O lançador em `/` vai para `/lancamentos`, e `/dashboard` é negado (o comportamento do `PageGuard`).
- O período de janeiro mostra "Ainda não há lançamentos neste período".
- Pixel 7 com viewport de 360 px: `scrollWidth <= clientWidth`.
- O axe não acha violações `serious` nem `critical`.
- Trocar "Comparar com" muda a URL e o texto da variação.

**Passos**
- [ ] `pnpm install`.
- [ ] Rodar só a spec nova: `pnpm --filter @app/web exec playwright test e2e/dashboard.spec.ts`.
- [ ] Rodar com `CI=true` nos dois projetos.
- [ ] Sugerir commit `test(web): E2E do dashboard com axe (F4, RF27.CA05)`.

### T14: Fechamento da etapa — NATIVA

- [ ] Rodar `pnpm typecheck && pnpm lint && pnpm test` inteiros (o contrato é compartilhado e há dependência nova).
- [ ] Rodar `pnpm --filter @app/db test:int` e `pnpm --filter @app/api test:int`.
- [ ] Rodar o E2E completo com `CI=true`.
- [ ] Desempenho (RNF, 2 s com 100 mil lançamentos): script de integração descartável com 100 mil linhas num tenant, medindo `summary` + `monthly` + `breakdown`. Se passar de 2 s, abrir pendência F4-1 em `andamento.md` (índice para a F8) e não criar migration agora.
- [ ] Atualizar a tabela de progresso de `docs/planos/painel.md` (F4 feita, com data e links do spec e do plano), o "Estado atual" do `CLAUDE.md` e `docs/planos/andamento.md`. Tirar do `pendencias.md` a linha que tiver fechado.
- [ ] Revisar o contexto do Claude: propor (sem criar) regra ou skill, por exemplo uma regra "rota de relatório" (`report:view` e `reportScopeFor` no lugar de `requireEntryAction`).
- [ ] Roteiro de teste à mão para o Luís:
  1. `pnpm dev` e `pnpm dev:worker`; entrar como dono do seed dev.
  2. Lançar pelo `/lancamentos/novo` uma receita de R$ 100,00 com 4 pedidos e uma despesa de aluguel de R$ 50,00. Conferir que o resultado sobe e desce e que o ticket mostra R$ 25,00.
  3. Trocar o período para um mês sem dados e ver o estado vazio.
  4. Entrar como gerente sem VER_FOLHA, conferir que o cartão de folha não aparece e, no DevTools, que a resposta de `/api/reports/summary` não tem `payrollRatio`.
  5. Abrir no celular (ou com o DevTools em 360 px) e conferir que não há rolagem lateral.
- [ ] Sugerir commit `docs: F4 feita` e o PR.

## Contagem por classe

HAIKU 2 (T1, T10) · NATIVA 7 (T2, T3, T9, T11, T12, T13, T14) · CRÍTICA 5 (T4, T5, T6, T7, T8).

## Verificação ponta a ponta

- Reconciliação no banco (T6 e T8): SQL independente igual ao reader e à rota.
- E2E com valores exatos e axe (T13).
- Roteiro à mão (T14).
