---
paths:
  - "**/*.test.ts"
  - "**/test/**"
---

# Testes

- Unitários (`*.test.ts`) ficam **ao lado** do arquivo testado, em `src/`. Integração (`*.int.test.ts`, Postgres real via Testcontainers) e fixtures ficam em `test/` na raiz do pacote.
- Nomes em português, descrevendo comportamento de negócio. Sem mock de banco; relógio e IA injetados; nada de rede.
- Os IDs são gerados pela aplicação (UUID v7, sem default no banco). Em testes que inserem linhas por SQL direto, gere o `id` com `uuidv7()` de `@app/db`; sem isso o insert falha com `null value in column "id"`.
- Fixtures de webhook entram em `packages/whatsapp/test/fixtures/` antes do código que as usa.
