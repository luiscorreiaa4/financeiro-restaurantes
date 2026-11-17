---
paths:
  - "apps/api/src/http/reports/**"
  - "packages/core/src/reports/**"
  - "packages/core/src/contracts/reports.ts"
  - "packages/core/src/permissions/report-scope.ts"
  - "packages/db/src/report-reader.ts"
---

# Rota de relatório (dashboard)

Regra de negócio por trás: RF27 e DD-41 (totais incluem a folha para todos que veem o dashboard; o detalhe por categoria e o indicador de folha são restritos). Vale também a `rota-de-tenant.md` e a `sensivel-falha-fechado.md` (exceção do item 4).

1. **Guard `requirePermission("report:view")`, não `requireEntryAction`.** Relatório não é lançamento: o lançador recebe 403 `forbidden` em todas as rotas `/api/reports/*`, mesmo com query inválida (o guard roda antes do parse). Ordem: `requirePanelContext`, `requireTenantRoute`, `requirePermission`.
2. **O recorte sai de `reportScopeFor`** (`@app/core`), com um único `withTenant` por requisição. Unidade fora do acesso derruba o pedido (403); ator sem nenhuma unidade é negado, e lista vazia nunca vira "sem filtro" (no banco, `{}` não casa nada).
3. **`payrollRatio` só existe para quem tem `canSeePayroll`, e a CHAVE some da resposta** (nunca `undefined` nem `null`): monte o objeto com spread condicional e teste com `"payrollRatio" in indicators` e no corpo cru. `estimatedTax` nunca é enviado na F4 (F12).
4. **Toda resposta passa por `schema.parse` do contrato `.strict()` antes de sair.** Não contorne.
5. **Breakdown por categoria, para quem não vê folha** (`!canSeePayroll`): investimento fora; `kind = 'deduction'` vira `deducoes`; categoria sensível (`sensitiveExpression`) **ou** `dre_group = 'pessoal'` vira `restricted` ("Pessoal (restrito)"); o resto vai pelo grupo do DRE. Nenhum nome de categoria sai na resposta (`name` sempre nulo) e o rótulo é fixo.
6. **As contas ficam no core** (`packages/core/src/reports`, BigInt, meio para longe do zero); o banco só soma e a tela só formata. Dinheiro em centavos inteiros e percentual em décimos de ponto percentual.
7. **`sql.raw` só com texto constante do código.** Nome de coluna ou tabela escolhido por `by` sai de uma lista fixa já validada pelo Zod; data e unidades vão como parâmetro.
8. **Teste obrigatório numa rota nova de relatório:** linha na `ROUTE_MATRIX`, duas empresas, reconciliação com SQL independente (conexão admin, `tenant_id` explícito) contra `expected` feito à mão, e gerente sem VER_FOLHA conferindo a chave e os rótulos.
