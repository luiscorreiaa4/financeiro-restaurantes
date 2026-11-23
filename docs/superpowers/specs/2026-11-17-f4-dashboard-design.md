# F4 Dashboard: desenho

> Etapa F4 do painel (RF27). Plano de tarefas: `docs/superpowers/plans/2026-11-17-f4-dashboard.md`. Desenho aprovado em 17/11/2026.

## Contexto e por quê

O RF27 pede uma tela inicial que mostre ao dono, em poucos segundos e no celular, como está o restaurante no período. Hoje `/dashboard` é só um `UnderConstruction` atrás de `PageGuard action="report:view"`, e `/` também é um `UnderConstruction`.

A F3 já entregou:
- leitura com recorte (`entryScopeFor`, `sensitiveExpression`);
- dinheiro como `number` inteiro no contrato (DD-36);
- filtros de período na URL.

O banco também já guarda, por lançamento, a taxa (`fee_cents`), o líquido (`net_cents`) e os pedidos (`orders`). As categorias guardam `kind` (revenue, expense, investment, deduction), `nature` e `dre_group`.

Falta o seguinte:
- as agregações;
- o contrato de relatório;
- a tela com gráficos.

**Requisitos:** RF27 (R1 a R9, Obs1 a Obs5, CA01 a CA08). Também valem o RF28.Obs4 e o RF28.CA01 (o resultado do DRE é igual ao do dashboard), o RF06 (matriz: dashboard para dono, gerente nas suas unidades e contador; lançador não) e o RF07.R3 a R5 (tipo, natureza e grupo do DRE). Decisões: DD-13 (fecha P09), DD-05 (imposto opcional), DD-36, DD-38 e DD-39.

## Metas, não metas e antimetas

**Metas**
- Mostrar os indicadores do RF27, com variação contra "Comparar com".
- Mostrar os quatro gráficos, cada um com tabela alternativa.
- Ter seletor de período, unidade e comparação na URL.
- Os blocos carregam de forma independente.
- Ter estado vazio útil, com o WhatsApp do produto.
- Reconciliação: cada indicador é idêntico a uma consulta SQL independente sobre o seed de referência (CA01).

**Não metas**
- O cálculo e o cartão do imposto estimado ficam para a F12. A F4 só reserva o campo opcional no contrato e garante o CA08.
- A tela de DRE fica para a F12.
- Não há drill-down do gráfico para a lista.
- Não há cache de agregação nem visão materializada.
- Não há índice novo. O RNF de 2 s com 100 mil lançamentos é conferido no fechamento. Se falhar, vira pendência da F8.

**Antimetas** (seriam falha mesmo funcionando)
- A tela somar, subtrair, dividir ou arredondar dinheiro ou percentual (RF27.Obs1, `apps/web/CLAUDE.md`).
- O nome de categoria sensível ou o lançamento de folha chegar a quem não vê sensíveis.
- O indicador de folha ser só escondido na tela, e não omitido da resposta (CA02).
- Usar `use cache` com dado de tenant.

## Abordagens consideradas

1. **Endpoints de agregação por bloco, com SQL `GROUP BY` e as contas no core (escolhida).** São três rotas, `summary`, `monthly` e `breakdown`. Cada bloco da tela tem a sua consulta, e isso cumpre o Obs3: um bloco lento não trava os outros. O banco soma e o `packages/core` faz as razões, com teste sem mocks. Segue o que a arquitetura já prevê ("o Postgres faz as agregações", `docs/arquitetura.md`).
2. **Um endpoint só, com tudo junto.** É mais simples no front, mas um bloco lento trava todos (contraria o Obs3) e a resposta fica grande.
3. **Tabelas ou visões pré-agregadas.** Seriam rápidas, mas exigem invalidação a cada edição, desfazer e restauração. Hoje é exagero, porque os índices `(tenant, unit, occurred_on)` da 0018 bastam para o volume do MVP.

## Decisões do Luís nesta sessão

- **Imposto estimado (R9):** só o lugar na F4. O contrato tem `estimatedTax` opcional, e a rota nunca o envia na F4, o que já cumpre o CA08. O cálculo pelo `estimateTax` e o cartão vão para a F12.
- **Folha para quem não vê sensíveis:** o total inclui a folha e o detalhe não. Receita, despesas, resultado e ponto de equilíbrio incluem a folha para todos que têm `report:view`, e o resultado é o mesmo para todos (RF28.CA01). No gráfico por categoria, a folha de quem não vê sensíveis vira o balde "Pessoal (restrito)" (RF28.Obs4), sem nome de categoria. O indicador "Folha sobre a receita" sai da resposta (R5, CA02). Isso vira regra nova: DD-41 e requisitos 1.19.
- **Acessibilidade:** entra `@axe-core/playwright` só como devDependency, com checagem no E2E do dashboard.

## Definições de cálculo (ficam no DD-41; o requisito continua sendo a fonte)

Todos os valores são somados no banco, com `occurred_on` no período (RF12.R21: competência). Ficam fora a lixeira (`deleted_at is null`) e as unidades fora do recorte.

| Soma (`PeriodSums`) | SQL |
|---|---|
| `grossRevenueCents` | `amount_cents` das receitas |
| `revenueWithOrdersCents`, `ordersCount` | receitas com `orders` não nulo: soma do bruto e soma de `orders` |
| `feesCents` | `fee_cents` das receitas (taxas da forma de pagamento e comissões do canal, RF08.R3 e RF09.R4) |
| `deductionExpensesCents` | despesas com categoria `kind = 'deduction'` |
| `investmentsCents` | despesas com categoria `kind = 'investment'` |
| `operatingExpensesCents` | as demais despesas, inclusive sem categoria ou com categoria que a junção não trouxe |
| `cmvCents` | despesas operacionais com `dre_group = 'cmv'` |
| `payrollCents` | despesas operacionais com `dre_group = 'pessoal'` |
| `fixedCostsCents` | despesas operacionais com `nature = 'fixed'` e grupo diferente de `cmv` |
| `entryCount` | quantidade de lançamentos |

Os indicadores são calculados no core:
- Deduções = `feesCents + deductionExpensesCents` (R3).
- Receita líquida = bruta − deduções.
- Resultado = bruta − deduções − operacionais (R3, CA03).
- Margem, CMV sobre a receita e folha sobre a receita = razão sobre a receita bruta (R4).
- Ticket médio = `revenueWithOrders ÷ orders` (R7, CA06), com cobertura = `revenueWithOrders ÷ bruta`.
- Ponto de equilíbrio = `fixos × bruta ÷ (bruta − variáveis)` (R8, CA07). Variáveis = (operacionais − fixos) + deduções. Por isso natureza nula ou sem categoria conta como variável.
- Sem denominador, ou com bruta − variáveis ≤ 0, o valor é `null` e a tela mostra "—".

**Unidades e arredondamento**
- Dinheiro em centavos inteiros.
- Percentuais em **décimos de ponto percentual** (`permille`, inteiro: 123 é 12,3%), arredondados meio para longe do zero. As contas intermediárias usam `BigInt`. A tela só formata, com uma casa (R4).

**Comparação (R2)**
- `previous_period` (padrão) é o mesmo número de dias, imediatamente antes.
- `previous_year` é o mesmo intervalo um ano antes. 29/02 vira 28/02.
- `none` desliga a comparação.

**Variação**
- Indicador de dinheiro: `(atual − anterior) ÷ |anterior|`, em permille. Com anterior 0 ou nulo, é `null`.
- Indicador percentual: diferença em décimos de ponto percentual.
- A direção (`up`, `down` ou `flat`) sai do sinal de atual − anterior. Se a variação for boa ou ruim, quem decide é a tela, por um mapa fixo (despesa subir é ruim). Isso não é conta.

## Desenho

### API (`apps/api`, rotas novas em `src/http/reports/reports-routes.ts`)

Os guards seguem `.claude/rules/rota-de-tenant.md`: `requirePanelContext`, `requireTenantRoute` e `requirePermission("report:view")`. O lançador recebe 403 `forbidden` (RF06, RF27.Obs5). O recorte sai de `reportScopeFor` (core). A unidade é o filtro `unitIds`, com o seletor do topo como padrão, como na lista. Unidade fora do acesso derruba o pedido.

| Rota | Query | Resposta |
|---|---|---|
| `GET /api/reports/summary` | `from`, `to`, `unitIds[]`, `compare` | indicadores atuais e anteriores, variação, `isEmpty`, cobertura do ticket; `payrollRatio` só se `canSeePayroll`; `estimatedTax` nunca na F4 |
| `GET /api/reports/monthly` | `to`, `unitIds[]` | 6 meses que terminam no mês de `to`, o último cortado em `to`. Cada mês traz receita bruta, despesa (deduções + operacionais) e resultado. Meses sem dados vêm zerados |
| `GET /api/reports/breakdown` | `from`, `to`, `unitIds[]`, `by` = `category`, `sales_channel` ou `payment_method` | itens `{ key, label, amountCents, sharePermille }`, ordenados por valor decrescente, mais `totalCents` |

**Breakdown**
- `category`: despesas operacionais por `dre_group`, mais o balde `deducoes` (despesas de dedução) e o balde `fees` ("Taxas e comissões"). Investimento fica fora. A folha que o ator não vê sensíveis vai para o balde `restricted` ("Pessoal (restrito)"), pela `sensitiveExpression`, que falha fechado. Sem categoria vai para "Sem categoria". Os rótulos dos grupos ficam em `DRE_GROUP_LABELS` no core, e grupo desconhecido vira "Outros".
- `sales_channel` e `payment_method`: receita bruta por canal ou forma de pagamento. O nulo vira "Não informado" ou "Não informada" (R6).

### Core (`packages/core`)

- `contracts/period.ts`: `ComparisonKind`, `comparisonPeriod` e `monthsWindow`.
- `reports/indicators.ts`: `ratioPermille`, `averageTicketCents`, `breakEvenCents`, `computeIndicators`, `changeOf` e `DRE_GROUP_LABELS`.
- `permissions/report-scope.ts`: `reportScopeFor`.
- `contracts/reports.ts`: schemas Zod `.strict()` das três respostas e das queries.

### Banco (`packages/db/src/report-reader.ts`)

- Não tem migration nova.
- Uma consulta por bloco, com `FILTER` e `GROUP BY` sobre `entries e left join categories c`.
- Reaproveita `sensitiveExpression` e as condições de unidade e lixeira da `entry-reader`, que passam a ser exportadas, sem mudar o comportamento.

### Web (`apps/web/features/dashboard`)

- O estado fica na URL (`from`, `to`, `unitIds`, `compare`), com `parseDashboardParams` e `serializeDashboardParams`. O padrão é o mês corrente até hoje, no fuso que o servidor entrega (R1).
- Cada bloco tem a sua consulta: cartões, receita × despesa, evolução do resultado, despesas por categoria, receita por canal e por forma de pagamento. O carregamento usa `useSuspenseQuery`, com `<Suspense>` e uma fronteira de erro própria por bloco (Obs3).
- Os gráficos usam o `chart` do shadcn sobre recharts 3.10 (⚠️ confirmar). Cada gráfico tem uma tabela alternativa (Obs2), e o mapeador do contrato para o gráfico só copia campos.
- O estado vazio aparece quando `isEmpty`: "Ainda não há lançamentos neste período", com link `wa.me` de `NEXT_PUBLIC_WHATSAPP_NUMBER` (Obs4).
- `lib/format`: `formatPermille` (123 → "12,3%", `null` → "—").
- `/` redireciona: com `report:view` vai para `/dashboard`, sem ele vai para `/lancamentos` (a "visão meus lançamentos" do lançador, RF27.Obs5). O item "Início" sai do menu.

```
┌ Dashboard ─────────────────────────────┐
│ [Período ▾] [Unidade ▾] [Comparar ▾]   │
│ Receita bruta  R$ 10.000,00  ▲ 12,0%   │
│ Deduções  · Receita líquida · Despesas │
│ Resultado · Margem · CMV · Folha*      │
│ Investimentos · Ticket (base: 60%) · PE│
├────────────────────────────────────────┤
│ Receita × Despesa (6 meses) [Tabela]   │
│ Evolução do resultado       [Tabela]   │
│ Despesas por grupo          [Tabela]   │
│ Receita por canal | por forma [Tabela] │
└────────────────────────────────────────┘
* só para quem vê sensíveis
```

## O que fica para quem constrói

- O visual dos cartões, com tokens neutros (D-F8).
- O tipo de gráfico de cada bloco: barras para receita × despesa, linha ou barras para o resultado, barras horizontais para os rankings.
- A forma do cabeçalho do E2E.

## Chamadas minhas (registradas no DD-41 para o Luís conferir)

1. Deduções = taxas e comissões das receitas + despesas de categoria de tipo DEDUCAO.
2. Natureza nula e despesa sem categoria contam como variáveis no ponto de equilíbrio. CMV é sempre variável.
3. "Folha sobre a receita" usa o grupo do DRE `pessoal`.
4. Os percentuais trafegam em décimos de ponto percentual. A variação de um indicador percentual é dada em pontos, não em %.
5. A comparação padrão é `previous_period`.
6. Os gráficos de 6 meses ficam ancorados no mês de `to`, e a "Despesa" do gráfico é deduções + operacionais, de modo que Receita − Despesa = Resultado.
7. O gráfico por categoria inclui o balde "Taxas e comissões", para fechar com o total de deduções + operacionais.
8. `/` redireciona por permissão, e o item "Início" sai do menu.
9. A fronteira de erro por bloco é um componente próprio, sem `react-error-boundary`, porque não há dependência nova.

## Respostas à conferência do construtor

**Já respondido pelo projeto**
- **"Hoje" e fuso:** como na lista da F3, `today` vem do servidor no fuso da unidade (spec F3, linha 116; `timezone` em `/api/entries/options`, F3c-2). A página repassa o `today` do mesmo jeito que `/lancamentos`.
- **Validação do período:** é a mesma do `entryListQuerySchema`. `from > to`, data inválida ou mais de 24 meses dão 400 `invalid_request`, e `to` no futuro é aceito. Na tela, um parâmetro inválido volta ao padrão, como o `parseFilters`.
- **`previous_period`:** o texto do RF27.R2 é "mesmo número de dias imediatamente antes", então um mês cheio compara com os 31 dias anteriores, e não com o "mês anterior".
- **Receita e despesa:** saem de `entries.type`. A categoria só classifica a despesa, pelo `kind` (deduction, investment) e pelo grupo. Uma despesa com categoria de `kind` incoerente (revenue) ou sem junção conta como operacional.
- **A folha e o vazamento pela diferença:** a folha entra nos totais e nos fixos do ponto de equilíbrio para todos, e o valor agregado de "Pessoal" pode ser deduzido. Isso foi aceito pela decisão do Luís, com base no RF28.Obs4. Só o detalhe por categoria e o indicador de folha ficam restritos.
- **Unidades:** a resolução é a mesma do `entryScopeFor`. O `unitIds` pedido prevalece sobre o seletor do topo, que prevalece sobre as unidades do ator. "all" do dono vale para todas, inclusive as criadas depois. Lançamentos de unidade arquivada contam, como na lista.

**Chamadas minhas (entram no DD-41)**
- **`previous_year`:** os dois extremos andam −12 meses com `addMonthsToBusinessDate`. O intervalo pode ficar um dia menor, e isso é aceito. 29/02 a 29/02 vira 28/02 a 28/02.
- **Variação e direção:** se o atual ou o anterior for `null`, `changePermille` e `direction` ficam `null`. Com anterior igual a 0 e atual diferente de 0, `changePermille` é `null` e `direction` segue o sinal. Na tela, para Resultado, Margem e Receita, subir é bom; para Deduções, Despesas, CMV, Folha e Ponto de equilíbrio, subir é ruim. Investimentos e Ticket ficam neutros.
- **`isEmpty`:** `entryCount = 0` só no período atual, contando qualquer tipo de lançamento.
- **Precedência do balde no breakdown por categoria:** investimento fica fora, `kind='deduction'` vai para `deducoes`, sensível que o ator não vê vai para `restricted`, e o resto vai para `dre_group` ou `uncategorized`. O balde restrito sempre se chama "Pessoal (restrito)", porque no produto a folha é a categoria sensível.
- **`sharePermille`:** o denominador é o `totalCents` do próprio breakdown. Com total 0, fica `null`. A soma dos shares pode não dar exatamente 1000 por causa do arredondamento, e isso é aceito, porque o valor só é exibido.
