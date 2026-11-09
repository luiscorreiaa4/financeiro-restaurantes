# E11: trocar unidade, trocar empresa e empresa citada no texto (desenho)

Data: 09/11/2026. Decisão registrada em `docs/decisoes.md` (DE-25). As regras estão em `docs/requisitos.md`: RF19 (comandos e CA03), RF11.R5 e R7, RF15 (pergunta pendente). Este documento cita, não copia.

## Intenção

Fechar o que a DE-17 adiou: quem tem acesso a mais de uma unidade ou empresa precisa escolher para onde vão os próximos lançamentos, e a mensagem deve ir para o lugar certo quando o texto o cita. Também rodar os evals contra o baseline, agora que a chave da Anthropic foi corrigida.

## Fora do escopo

- Contador criado só por e-mail (DD-20), que depende da F1a.
- Troca de empresa a partir de áudio ou foto.
- Telas do painel.

## Abordagens consideradas

**Onde guardar a escolha.**
- *No vínculo* (escolhida): `default_unit_id` já existe; `preferred_at` é uma coluna nova em `memberships`. Sem tabela, sem RLS especial, sem grant novo. Custo: o colaborador sobrescreve a unidade padrão do dono.
- *Tabela `conversation_preferences`*: separa a preferência do WhatsApp, mas exige RLS por usuário e grant novo para `app_ingest`.

**Empresa citada.**
- *Casamento sem IA antes de atribuir a mensagem* (escolhida): barato, previsível, e a mensagem já é gravada na empresa certa.
- *IA devolve `company_hint`*: entende mais variações, mas obriga a reatribuir a mensagem e a refazer a extração com o catálogo da outra empresa.
- *Perguntar na dúvida*: não escolhida agora; fica como evolução se houver falso positivo no piloto.

## Desenho

**Dados.** `memberships.preferred_at timestamptz null`. `pending_questions.kind` (`clarify` | `choice`), com `draft` validado por Zod para `choice` (`target`, `options`).

**Domínio (`packages/core/src/conversation`).**
- Comandos `switch_unit` e `switch_tenant`, na mesma normalização dos demais.
- `resolveSender` ordena por `preferredAt` e depois pelo vínculo mais antigo; `defaultUnitId` só devolve unidade acessível.
- `cited-place.ts`: função pura que casa o texto com empresa e unidades acessíveis (palavra inteira, sem acento). Troca de empresa só com exatamente um casamento diferente da padrão.
- `choice.ts`: monta a lista numerada e interpreta a resposta.
- `unit_hint` na extração, resolvido por `findUnit` no catálogo, limitado às unidades acessíveis. Precedência: unidade do casamento, depois `unit_hint`, depois a padrão.

**API.** O casamento roda antes do `assignSender`. O `sender-directory` traz `preferredAt`, apelidos das unidades e nome das empresas. As respostas `choice` são tratadas sem IA, antes do caminho que chama a IA (RF11.R7 (e)). A gravação da escolha usa `withTenant` da empresa escolhida.

**Correção junto.** O lançamento não cai mais na primeira unidade do restaurante quando não há padrão: usa só unidades de acesso.

## Limitações aceitas

Áudio e foto ficam na empresa padrão. `trocar unidade` sobrescreve o padrão do dono. Apelido genérico pode dar falso positivo.

## Critérios de pronto

- RF19.CA03 e RF11.R5 cobertos por teste.
- Teste de isolamento para as colunas novas.
- `pnpm typecheck && pnpm lint && pnpm test` e suítes de integração verdes.
- Evals sem queda em relação ao baseline.
- Documentos atualizados: `canal-whatsapp.md`, `andamento.md`, `escopo-por-fase.md`, `arquitetura.md`, `CLAUDE.md`.
