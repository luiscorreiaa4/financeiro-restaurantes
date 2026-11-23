# F4 (dashboard): como testar

> Roteiro de teste da F4 (RF27, DD-41). Desenho em `docs/superpowers/specs/2026-11-17-f4-dashboard-design.md` e plano em `docs/superpowers/plans/2026-11-17-f4-dashboard.md`. Criado em 17/11/2026.

## 1. Antes de tudo

1. **Docker Desktop aberto.** Os testes de integração sobem o Postgres pelo Testcontainers. Com o Docker fechado, todos os arquivos falham com `Could not find a working container runtime strategy`, sem nenhum teste rodar.
2. **Sem migration nova.** A F4 só lê: não há `db:migrate` a rodar.
3. **Dependência nova.** `@axe-core/playwright` 4.14.0 (só desenvolvimento, DD-41). Depois de trocar de branch, rode `pnpm install` na raiz.
4. **Pare o `pnpm dev` antes do E2E.** O `next dev` do Playwright precisa da pasta `apps/web/.next`.

## 2. Testes automáticos

| O que | Comando | Esperado (17/11/2026) |
|---|---|---|
| Tudo, menos integração e E2E | `pnpm typecheck && pnpm lint && pnpm test` | verde (lint com 3 avisos antigos em `panel-edit.ts`); core 1001, api 500, web 454 |
| Integração (Docker) | `pnpm test:int` | db 21 arquivos (448 testes), api 17 arquivos (569 testes) |
| Contas dos indicadores (razão, ticket, ponto de equilíbrio, variação) | `pnpm --filter @app/core exec vitest run src/reports` | 28 |
| Contrato, recorte e períodos de comparação | `pnpm --filter @app/core exec vitest run src/contracts/reports.test.ts src/permissions/report-scope.test.ts src/contracts/period.test.ts` | verde |
| Leitor de relatórios (reconciliação com SQL independente, balde `restricted`) | `pnpm --filter @app/db exec vitest run report-reader` | verde |
| Rotas `/api/reports/*` (unitário e ponta a ponta) | `pnpm --filter @app/api exec vitest run src/http/reports` e `pnpm --filter @app/api exec vitest run reports.int` | 22 e 21 |
| Matriz papel × rota (inclui as três rotas novas) | `pnpm --filter @app/api exec vitest run entries-panel` | verde |
| Telas do dashboard, API falsa e `formatPermille` | `pnpm --filter @app/web exec vitest run features/dashboard lib/format` | verde |
| Chart do shadcn com o recharts 3.10 | `pnpm --filter @app/web exec vitest run lib/charts` | 2 |
| E2E do dashboard (valores exatos, folha, estado vazio, 360 px, axe) | `CI=true pnpm --filter @app/web exec playwright test e2e/dashboard.spec.ts` | 8 por projeto (16) |
| E2E das rotas por estado de sessão (`/` agora redireciona) | `CI=true pnpm --filter @app/web exec playwright test e2e/routes.spec.ts` | 181 passam, 1 pulado de propósito |
| E2E completo | `CI=true pnpm --filter @app/web test:e2e` | verde, com alguns pulados de propósito |

Atenção: `pnpm --filter <pacote> test:int <nome>` **roda todos os arquivos**, porque o script já passa `int.test.ts` como filtro. Para um arquivo só, use `exec vitest run <nome>`. Detalhe em `.claude/rules/testes-integracao-ambiente.md`.

## 3. Roteiro à mão

### Subir

Em três terminais, na raiz:

```
pnpm db:seed:dev
pnpm dev
pnpm dev:worker
```

Abra o painel em `http://localhost:3000` (use `localhost`, não `127.0.0.1`).

### Contas do seed

| Persona | E-mail | Como entrar |
|---|---|---|
| Dono | `dono@demo.dev` | senha `demo12345` ou código |
| Gerente | `gerente@demo.dev` | código (lido na pasta `DEV_MAIL_DIR`) |
| Lançador | `atendente@demo.dev` | código |
| Contadora | `contadora@demo.dev` | código |

### Criar dados

Como dono, em `/lancamentos/novo`:

1. **Receita** de R$ 100,00, com **4 pedidos**, com canal de venda.
2. **Despesa** de aluguel (categoria fixa) de R$ 50,00.
3. **Despesa** de folha (salário), por exemplo R$ 30,00, para o teste do gerente.

### Como dono: o que conferir em `/dashboard`

- [ ] Ao abrir `/`, você cai em `/dashboard` (o item "Início" não existe mais no menu).
- [ ] Período padrão: do dia 1 do mês até hoje. A URL ganha `from`, `to` e `compare`.
- [ ] Receita bruta R$ 100,00. O resultado é a receita menos deduções e despesas operacionais (investimento fica fora). Ele sobe quando você lança receita e desce quando você lança despesa.
- [ ] **Ticket médio R$ 25,00**, com o texto "base: 100% da receita" (só a receita com pedidos informados entra na conta; quem lança receita sem pedidos reduz a base).
- [ ] Margem, CMV e folha sobre a receita aparecem em percentual com uma casa (ex.: `30,0%`). Em um mês sem receita, os três e o ticket mostram "—".
- [ ] Os cartões mostram a variação com seta e texto acessível ("aumento de x,y% em relação ao período anterior"). Para margem, CMV e folha a variação é em pontos percentuais.
- [ ] **Comparar com**: "Mesmo período do ano anterior" muda a URL e o texto da variação; "Sem comparação" tira a variação.
- [ ] Os quatro gráficos aparecem: receita × despesa por mês (6 meses que terminam no mês de "Até"), evolução do resultado, despesas por categoria e receita por canal e por forma de pagamento. Cada um tem o alternador **Gráfico | Tabela**, e a tabela mostra os mesmos números.
- [ ] Escolha um período **sem lançamentos** (ex.: um mês antigo): aparece "Ainda não há lançamentos neste período" com o botão do WhatsApp.
- [ ] Período com mais de 24 meses ou invertido na URL (`?from=2026-11-30&to=2026-11-01`): a tela volta ao padrão, sem erro.

### Como gerente (sem VER_FOLHA): o que conferir

- [ ] **Não existe** o cartão "Folha sobre a receita".
- [ ] No DevTools (aba Rede), a resposta de `/api/reports/summary` **não tem a chave `payrollRatio`**.
- [ ] Na aba "Tabela" de "Despesas por categoria" aparece **"Pessoal (restrito)"**; nenhum rótulo "Folha de pagamento" nem nome de categoria sensível, nem na resposta de `/api/reports/breakdown?by=category`.
- [ ] O resultado e os totais são **os mesmos do dono** (DD-41: os totais incluem a folha para todos; só o detalhe e o indicador de folha são restritos).
- [ ] Gerente de uma unidade só: o dashboard soma só a unidade dele. Pôr `&unitIds=<outra unidade>` na URL a API responde 403 e o bloco mostra "Não foi possível carregar", nunca número da outra unidade.

### Como contadora

- [ ] Vê o dashboard e o cartão de folha (o contador vê folha, DD-04), sem botão de alteração.

### Como lançador

- [ ] `/` leva a `/lancamentos`, e `/dashboard` mostra "Você não tem acesso a esta página".
- [ ] `GET /api/reports/summary` direto no navegador (logado como lançador) responde 403 `forbidden`.

### No celular (DevTools, largura de 360 px)

- [ ] Sem rolagem horizontal, com os cartões em uma coluna e os gráficos cabendo na tela.

## 4. Limites conhecidos (não são defeito da F4)

- **Imposto estimado:** o contrato reserva `estimatedTax`, mas a rota nunca o envia e não há cartão. Cálculo e cartão ficam na F12 (DD-41, CA08).
- **Proporção de folha (F4-1, decisão dos sócios):** o balde "Pessoal (restrito)" mostra valor e participação, então o gerente sem VER_FOLHA consegue deduzir a proporção de folha que o indicador escondido não mostra. O DD-41 e o RF28.Obs4 aceitam isso.
- **Handler de erro (F4-2):** o `setErrorHandler` de `reports-routes.ts` converte qualquer 4xx lançado em `invalid_request`. Hoje os guards respondem direto e nada sai errado.
- **Dedução sensível:** uma categoria sensível com tipo "dedução" aparece como "Deduções" (nunca com nome) para quem não vê folha, pela precedência do DD-41.
- **Período de comparação:** `previous_period` tem o mesmo número de dias imediatamente antes (um mês cheio compara com os 31 dias anteriores, e não com o mês anterior); `previous_year` anda 12 meses nos dois extremos, e 29/02 vira 28/02.
- **Ponto de equilíbrio:** natureza nula e despesa sem categoria contam como variáveis; sem receita ou com receita menos variáveis menor ou igual a zero, o valor é "—".
- **Desempenho:** com 100 mil lançamentos, o bloco mais lento levou 105 ms (limite de 2 s). Nenhum índice novo foi criado; a medição foi um teste descartável.
- **Avisos do `next dev`:** `Could not validate that a segment ... instant navigation` pode aparecer no modo de desenvolvimento; o build de produção (`CI=true`) não os mostra.
