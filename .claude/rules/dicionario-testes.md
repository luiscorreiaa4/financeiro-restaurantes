---
paths:
  - "**/*.test.ts"
  - "**/test/**"
---

# Dicionário de testes

O agente `verificador` lê `.claude/dicionario-testes.md` para saber o que rodar. Ao criar um teste de **assunto novo**, atualize o dicionário na mesma mudança:

- Arquivo de teste novo (ou pasta nova de testes): adicione uma linha na tabela do pacote, com assunto, caminho e comando que roda só esse arquivo.
- Pacote que ganhou o primeiro teste, script novo (`test:int`, `eval`, e2e) ou tabela nova: ajuste "Comandos gerais" e "Qual conjunto rodar, por tipo de mudança".
- Armadilha nova que custou tempo (erro de ambiente, fixture obrigatória): acrescente em "Armadilhas conhecidas".
- Teste renomeado, movido ou removido: corrija ou apague a linha. Entrada velha faz o verificador rodar comando que não existe.

Teste novo para assunto que já tem linha (mais um caso no mesmo arquivo) não precisa mexer no dicionário.
