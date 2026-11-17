---
paths:
  - "packages/db/src/**"
  - "packages/core/src/**"
  - "apps/api/src/http/**"
  - "apps/web/features/**"
---

# Categoria sensível: falha fechado

Regra de negócio por trás: categorias sensíveis (folha) só para dono, contador e gerente com VER_FOLHA (RF06.R3, RF22.Obs7, RF25.Obs1). Nasceu na F3a: três revisões acharam caminhos em que "não sei se é sensível" virava "não é" (registro em `docs/planos/f3a-execucao.md`).

1. **Na dúvida, é sensível.** Lançamento sem categoria (`category_id` nulo) não é sensível. Categoria preenchida que a consulta não trouxe (junção vazia, cadastro de outra empresa, id fora do mapa de nomes, retrato de versão ilegível ou sem `categoryId`) conta como sensível.
2. **Uma expressão só no SQL.** Use `sensitiveExpression(<apelido do lançamento>, <apelido da categoria>)` de `packages/db/src/entry-reader.ts`, que dá `(e.category_id is not null and c.is_sensitive is not false)` e nunca é nula. Não escreva `c.is_sensitive is not true` nem `coalesce(c.is_sensitive, false)`: com a junção vazia, os dois liberam a linha.
3. **No domínio e na rota**, para versões do histórico: `diffVersion` e `parseVersionSnapshot` (`packages/core/src/entry/version-diff.ts`) já falham fechado; a rota só decide `restricted = sensitive && !includeSensitive` (`toVersion` e `hasSensitiveVersion` em `apps/api/src/http/entries/entries-routes.ts`).
4. **O sensível vaza por qualquer caminho que leve o dado**, não só pela lista: totais, aviso de restritos, detalhe por id, histórico (antes e depois), texto e transcrição da mensagem de origem (inclusive de um lançamento que já esteve na folha e foi reclassificado), opções de filtro, exportação, relatório e resumo. Sinais calculados contra outros lançamentos (duplicidade, `possible_duplicate`) também levam dado: o candidato da comparação respeita o recorte do ator (`entryReader.recent`: sem sensível invisível, sem outra unidade, sem lixeira). Rota nova que mostre lançamento ou parte dele ganha teste com gerente sem VER_FOLHA e com lançador. Exceção (DD-41): totais agregados do dashboard incluem a folha; o detalhe por categoria vira "Pessoal (restrito)" e o indicador de folha não é enviado.
5. **Restrito não leva conteúdo.** O contrato (`@app/core/contracts`) recusa versão `restricted` com campos e origem `restricted` com texto, transcrição ou chave. Não contorne o `parse` do contrato na saída da rota.
