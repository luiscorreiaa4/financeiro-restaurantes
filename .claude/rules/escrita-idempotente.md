---
paths:
  - "apps/api/src/http/**"
  - "packages/db/src/**"
  - "packages/db/schema/**"
---

# Escrita disparada pelo navegador: idempotência por tentativa

Regra de negócio por trás: RF26.R3 (duplo clique e reenvio por rede ruim gravam uma vez só) e RNF05. Nasceu na F3c (`POST /api/entries`, migration 0019). Referência: `packages/db/src/panel-entry-writer.ts` e a rota em `apps/api/src/http/entries/entries-routes.ts`.

1. **Chave por tentativa, gerada pela tela.** `clientRequestId` (UUID v4) vai no corpo; a tela só troca a chave depois de um envio que deu certo (erro de rede, 5xx e 409 reenviam a mesma).
2. **A chave nunca é a chave primária.** Coluna própria (`client_request_id`) e índice único **parcial** `(tenant_id, <autor>, client_request_id) WHERE client_request_id IS NOT NULL`. Chave de outro usuário ou de outra empresa não colide nem revela nada.
3. **Origens exclusivas.** CHECK que impede a chave junto com a origem de outro canal (`inbound_message_id`).
4. **Um `withTenant` só** para a rota inteira. Passo 1 é ler pela chave; se existe, responde 200 com o mesmo dado.
5. **23505 desfaz a transação inteira** (inclusive cadastros criados na mesma transação, como fornecedor novo). Capture o erro **fora** do `withTenant`, só quando `isUniqueViolation(error, "<nome do índice>")`; qualquer outro 23505 propaga. Uma transação nova relê pela chave: 200, ou 409 `already_submitted` sem dado se o registro já não está no recorte do ator.
6. **A repetição passa pelo mesmo `find` com recorte** (`sensivel-falha-fechado.md`) e pelo `parse` do contrato; nunca devolva o corpo antigo nem o dado gravado sem recorte. A repetição com corpo diferente devolve o primeiro registro.
7. **Teste da corrida precisa provar o ramo.** Duas requisições em paralelo podem não colidir; faça um teste determinístico (linha sem commit numa conexão admin) e confira por mutação: troque o `catch` por `throw error` e o teste tem que falhar.
