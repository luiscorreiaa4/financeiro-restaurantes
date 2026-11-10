# Documentação

Dois grupos:

- **Aqui na raiz de `docs/`** ficam os documentos de referência, que valem até o fim do projeto e mudam pouco: o que o produto faz, por que decidimos assim e como é construído.
- **Em `docs/planos/`** fica o trabalho em andamento: situação atual, tarefas de cada sócio, planos de etapas, guias de teste. Esses arquivos mudam toda semana e alguns são descartados quando acabam.

## Referência (raiz de `docs/`)

Em conflito, vale a ordem da tabela (do mais forte para o mais fraco).

| Arquivo | O que tem | Para quem |
|---|---|---|
| [`requisitos.md`](requisitos.md) | **O quê**: as regras de negócio (39 RFs, 14 RNFs, matriz de permissões, pendências P01 a P18; versão 1.1 de 05/11/2026). Fonte da verdade. Grande: busque por `### RFnn` | Os dois |
| [`decisoes.md`](decisoes.md) | **Por quê**: uma linha por decisão (D1 a D7, D-F1 a D-F9, DE-01 a DE-21, DN-01 a DN-12, DD-01 a DD-18) | Os dois |
| [`DESCOBERTA.md`](DESCOBERTA.md) | Resultado da reunião de descoberta de 05/11/2026: decisões, pendências abertas, escopo do MVP e o que ficou fora | Os dois |
| [`arquitetura.md`](arquitetura.md) | **Como**: stack, fluxo da mensagem, modelo de dados e o que o código ainda não reflete dos requisitos | Luís |
| [`produto.md`](produto.md) | Visão de produto e de negócio: problema, público, custos, validação, riscos | Os dois (mais o Matheus) |
| [`custos-e-precificacao.md`](custos-e-precificacao.md) | Custo por restaurante (IA e WhatsApp), custo fixo, margem por preço, ponto de equilíbrio e propostas de preço (P03) | Os dois |
| [`escopo-por-fase.md`](escopo-por-fase.md) | O que entra no MVP, na v1.1 e na Fase 2, por RF, com o que já está feito | Os dois |
| [`politica-meta-whatsapp.md`](politica-meta-whatsapp.md) | O que a política da Meta exige de um bot no WhatsApp e como nos enquadramos. Local, fora do git | Os dois |

## Trabalho em andamento (`docs/planos/`)

| Arquivo | O que tem | Para quem |
|---|---|---|
| [`planos/andamento.md`](planos/andamento.md) | **Comece por aqui.** O que já existe, próximos passos, bloqueios e pendências técnicas | Os dois |
| [`planos/pendencias.md`](planos/pendencias.md) | Índice de todas as pendências abertas por etapa, com link para o arquivo que explica cada uma | Os dois |
| [`planos/matheus.md`](planos/matheus.md) | Decisões de negócio (P01 a P11), validação, jurídico, go-to-market. Local, fora do git | **Matheus** |
| [`planos/luis.md`](planos/luis.md) | Contas, Meta, hospedagem e custo de IA (o que não é etapa de código). Local, fora do git | **Luís** |
| [`planos/canal-whatsapp.md`](planos/canal-whatsapp.md) | Etapas E1 a E14 do canal WhatsApp, com a tabela de progresso | Luís |
| [`planos/painel.md`](planos/painel.md) | Etapas F0 a F13 do painel web, com a tabela de progresso | Luís |
| [`planos/contingencia-canal.md`](planos/contingencia-canal.md) | Planos B, C e D se a Meta travar o WhatsApp, com o orçamento do Twilio e os gatilhos para trocar (DD-23) | Os dois |
| [`planos/guia-testes-manuais.md`](planos/guia-testes-manuais.md) | Como testar à mão pelo `pnpm dev:chat`, e pelo celular quando a Meta liberar | Luís (e para demonstrar ao Matheus) |
| `planos/pesquisa-claude-code.md` | Pesquisa sobre o ecossistema do Claude Code; a seção 12 lista o que adotar em cada etapa. Local | Luís |
| `planos/prompts/` | Prompts para abrir uma sessão do Claude Code: executar uma etapa, planejar F0 e F1 do painel. Local | Luís |

## Como manter

- Fluxo de cada etapa: Superpowers (DD-18). Desenhos em `docs/superpowers/specs/` e planos em `docs/superpowers/plans/`; eles referenciam os RF e não substituem `requisitos.md`. O OpenSpec foi abandonado; `openspec/changes/e11-modelo-de-dados/` fica só como registro.

- Regra nova ou mudança de regra: primeiro em `decisoes.md` e `requisitos.md` (subindo a versão no topo), depois nos planos, que só citam o ID.
- Etapa concluída: atualizar a tabela de progresso do plano e o `planos/andamento.md`.
- Documento de trabalho que terminou (um passo a passo cumprido, um subplano vencido): resumir o que importa em `andamento.md` ou no plano e apagar. O histórico fica no git.
- O `.docx` v1.0 dos requisitos é um retrato e não é editado; uma versão nova sai do `.md` com pandoc.
