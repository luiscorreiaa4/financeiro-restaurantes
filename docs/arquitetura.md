# Arquitetura

> **Papel deste documento:** diz **como** o sistema é construído (parte técnica). O que o produto faz e as regras de negócio estão em [`requisitos.md`](requisitos.md); o porquê das escolhas, em [`decisoes.md`](decisoes.md). Em conflito, valem os requisitos. A seção "Divergências entre o modelo de dados atual e os requisitos" lista o que o código ainda não reflete.

## Decisões e porquês

### Backend em TypeScript (Node), não em outra linguagem

- **Uma linguagem só** no monorepo: tipos compartilhados entre API, painel, schemas de extração da IA e banco. Um schema Zod define o formato do lançamento uma vez e serve para validar a saída do LLM, a API e os formulários do painel.
- O trabalho do backend é **I/O**: webhooks, chamadas a APIs de IA, banco, filas. Node é excelente nisso.
- SDKs oficiais de Anthropic, OpenAI e da Meta são de primeira linha em TypeScript.
- Python só faria sentido para treino de modelos ou análise de dados pesada, que não é o caso: usamos modelos via API e o Postgres faz as agregações.
- Go ou Rust trariam desempenho que não precisamos, ao custo de duplicar tipos e velocidade de desenvolvimento.

### Fastify para a API

Maduro, rápido, ótimo suporte a Zod (`fastify-type-provider-zod`) e plugins para tudo (rate limit, CORS, multipart). Hono é alternativa válida se um dia formos para edge, mas o webhook e os workers rodam melhor num processo Node tradicional.

### Next.js para o painel, sem React Native no MVP

- O lançamento diário é pelo WhatsApp; o painel é consulta e edição. Uma web app responsiva instalável (PWA) atende desktop e celular com um código só.
- Next.js (App Router) dá roteamento, SSR para carregamento rápido em celular fraco e um ecossistema enorme (shadcn/ui, Recharts).
- O painel **consome a API** (`apps/api`), não acessa o banco direto. Isso mantém regras de permissão num lugar só e deixa a porta aberta para um app Expo no futuro reaproveitando a mesma API e `packages/core`.

### Drizzle ORM (não Prisma, não SQL puro)

- Escrito em TypeScript, tipos inferidos do schema, sem etapa de geração de client.
- Fica perto do SQL: relatórios com `GROUP BY`, janelas e CTEs são naturais, e caímos para SQL cru quando precisar sem perder tipagem.
- Funciona bem com RLS (`SET LOCAL` por transação) e com Postgres puro.
- Migrations em SQL legível e versionado, revisáveis em PR.

### Fila no próprio Postgres (pg-boss)

Áudio, foto e chamadas de IA levam segundos; o webhook não pode esperar. pg-boss dá retries, agendamento (resumo semanal, recorrentes) e jobs únicos sem adicionar Redis. Se o volume crescer muito, migrar para BullMQ/Redis é localizado.

### Multi-tenant com Row Level Security

Todas as tabelas de cliente têm `tenant_id`. Políticas RLS garantem no banco que uma conta nunca vê dados de outra, mesmo com bug na aplicação. A aplicação conecta com um papel sem `BYPASSRLS` e define `app.tenant_id` por transação. Migrations e jobs administrativos usam papel separado.

### IA: extração estruturada, cálculo no banco

- O LLM recebe a mensagem (texto ou transcrição), o contexto do tenant (categorias, fornecedores frequentes, unidades, formas de pagamento, data de hoje) e responde com **saída estruturada** (`output_config.format`, decisão D1) validada pelo schema Zod de lançamentos. Nada de parsing de texto livre. Tool use fica para consultas e relatórios (RF20, RF30).
- Saída validada; se inválida, uma nova tentativa com o erro; se persistir, pergunta ao usuário (RF12.R18).
- Roteamento: Haiku por padrão; Sonnet só por **sinais objetivos** (saída inválida, mensagem longa, foto difícil), nunca pela "confiança" declarada pelo modelo (RNF08.R3).
- Camada de provedor em `packages/ai` para trocar modelos sem tocar no domínio.
- **Evals:** conjunto versionado de mensagens reais anonimizadas com o resultado esperado. Rodam em CI quando `packages/ai` muda.

### Foto de nota: QR Code primeiro

1. Detectar QR Code na imagem; se for NFC-e, consultar a página da SEFAZ e extrair itens e totais (dados oficiais).
2. Sem QR: modelo multimodal lê a imagem e extrai para o mesmo schema.
3. A imagem original fica guardada como origem do lançamento.

## Fluxo de uma mensagem

```
WhatsApp ──► POST /webhooks/whatsapp
              ├─ valida assinatura (X-Hub-Signature-256)
              ├─ grava inbound_messages (status=received), idempotente por wa_message_id
              ├─ enfileira job "process-inbound"
              └─ 200 OK  (< 1 s)

worker process-inbound
  ├─ identifica usuário pelo telefone → tenant, papéis, unidade padrão
  ├─ é resposta a uma confirmação? → fluxo de correção
  ├─ é comando ("desfazer", "ajuda")? → trata direto
  ├─ áudio → baixa mídia → S3 → transcreve
  ├─ imagem → baixa mídia → S3 → QR NFC-e ou leitura multimodal
  ├─ LLM extrai lançamentos (schema Zod)
  ├─ falta informação essencial? → pergunta e guarda estado pendente
  ├─ grava entries + entry_versions (transação, RLS)
  ├─ registra ai_usage
  └─ envia confirmação (guarda wa_message_id da resposta para permitir correção por reply)
```

## Desenvolvimento sem WhatsApp (chat de terminal)

Durante o desenvolvimento, o canal é testado por um **chat de terminal** (`pnpm dev:chat`), só para teste e sem interface visual. Ele monta payloads no formato real da Cloud API, assina e envia ao webhook local; a resposta sai por um `DevMessageSender` e aparece no próprio terminal. Por isso tudo (webhook, fila, IA, banco) roda de verdade, sem precisar da Meta, do CNPJ nem de número. O WhatsApp real é configurado **no fim do desenvolvimento**, trocando só os adaptadores na composição (`CHANNEL_MODE=whatsapp`). Detalhe, comandos, salvaguardas e checklist em `docs/plano-dev-canal-whatsapp.md`, seção 3.6.

## Modelo de dados (rascunho)

> Este desenho é o da E2. Os requisitos v1.0 acrescentam campos e tabelas: veja a seção "Divergências entre o modelo de dados atual e os requisitos", logo depois.

```
tenants              id, name, plan, created_at
units                id, tenant_id, name, timezone
users                id, name, email, phone_e164, created_at
memberships          id, tenant_id, user_id, unit_id (null = todas), role, permissions jsonb
categories           id, tenant_id (null = padrão do sistema), parent_id, name, kind (revenue|expense|investment|deduction), nature (fixed|variable), dre_group
suppliers            id, tenant_id, name, document (cnpj/cpf), aliases text[]
payment_methods      id, tenant_id, name, fee_percent_bp, fee_fixed_cents
sales_channels       id, tenant_id, name, fee_percent_bp
inbound_messages     id, tenant_id, user_id, wa_message_id unique, type (text|audio|image), text, media_key, transcription, status, error, received_at
entries              id, tenant_id, unit_id, type (expense|revenue), occurred_on date,
                     description, quantity numeric, quantity_unit, amount_cents bigint,
                     fee_cents bigint, net_cents bigint,
                     category_id, supplier_id, payment_method_id, sales_channel_id,
                     inbound_message_id, confirmation_wa_message_id,
                     ai_confidence, created_by, created_at, updated_at, deleted_at
entry_versions       id, tenant_id, entry_id, version, snapshot jsonb, changed_by, channel (whatsapp|web|import|system), changed_at
recurring_rules      id, tenant_id, unit_id, template jsonb, day_of_month, auto_post boolean, active
pending_questions    id, tenant_id, user_id, inbound_message_id, draft jsonb, question, expires_at
ai_usage             id, tenant_id, inbound_message_id, provider, model, input_tokens, output_tokens, audio_seconds, cost_usd_micros, created_at
audit_log            id, tenant_id, actor_id, action, target, metadata jsonb, created_at
```

Notas:
- `fee_percent_bp` em pontos-base (320 = 3,20%) para evitar decimal.
- `net_cents = amount_cents - fee_cents` calculado no domínio, não pelo LLM.
- Índices principais: `entries (tenant_id, unit_id, occurred_on)`, `entries (tenant_id, category_id, occurred_on)`.
- Folha de pagamento: categorias do grupo Pessoal ficam marcadas como sensíveis; a API filtra por permissão (RF06.R3).

## Divergências entre o modelo de dados atual e os requisitos

Situação conferida contra `packages/db/schema` e `packages/core` em 29/10/2026. **Nenhuma destas divergências foi corrigida nesta rodada** (só documentação). Cada linha diz o que falta, o RF que exige e a etapa que resolve. Etapas E11 a E13 e F9, F10 são novas (ver os planos). Valores marcados `[PROVISÓRIO – Pxx]` em `requisitos.md` ficam em configuração ou constante única.

### Papéis e permissões (`packages/core`)

| Onde | O que falta | RF | Etapa |
|---|---|---|---|
| `ROLES = ["owner", "manager", "staff"]` | Quarto papel `accountant` (CONTADOR, Fase 2); registrar `staff` = LANCADOR. | RF06, RF36 | Mapeamento: já em `decisoes.md` (DN-04). Papel novo: E11 / Fase 2 |
| `can()` e `categoryIsSensitive` (só `owner` age sobre folha) | Permissões adicionais VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL, CONSULTAR_RELATORIOS_WHATSAPP; gerente e contador com VER_FOLHA veem folha. | RF05.R7, RF06.R3 | E11 |
| Testes de permissão | A matriz da seção 2.3 de `requisitos.md` como teste (todas as ações × papéis). | RF06.CA06 | E11 |

### Conta, unidade e colaborador

| Tabela | O que falta | RF | Etapa |
|---|---|---|---|
| `tenants` (só `name`, `plan` default `trial`) | Razão social; CNPJ (único se situação ≠ ENCERRADA); segmento; regime tributário; faixa de faturamento; código de indicação; plano TESTE/ESSENCIAL/PROFISSIONAL/FUNDADOR; início e fim do teste; situação ATIVA/SOMENTE_LEITURA/CANCELADA/ENCERRADA; aceite dos termos (data e versões). | RF01, RF37 | F1 (autocadastro), F9 (assinatura) |
| `users` (`email` opcional, sem senha) | Senha (hash forte com sal), e-mail verificado, bloqueio por tentativas, sessões ativas. | RF01.R10 a R12, RF02 | F1 |
| Autenticação | Códigos de uso único, tentativas de senha, sessões e limites de envio; endpoint próprio de autocadastro (o Better Auth não cria usuário no login comum). | RF01 a RF03, RNF01 | F1 |
| `units` (nome, fuso) | Apelidos (até 5, únicos na empresa); CNPJ da unidade; município e UF; status ATIVA/INATIVA; regra "não inativar a última ativa". | RF04 | F6 (tela), E11 (dados) |
| `memberships` (`unit_id` nulo = todas; `permissions jsonb`) | Lista de unidades de acesso (tabela colaborador × unidade, mantendo "TODAS"); unidade padrão; situação CONVIDADO/ATIVO/DESATIVADO (hoje só `deactivated_at`); `invited_by`, data do convite; acesso ao painel; as 4 permissões adicionais validadas por enum. Pendência P13. | RF05.R5 a R8 | E11 |
| `whatsapp_opt_ins` | Revogação do consentimento (`parar`) e novo opt-in (`voltar`); hoje só acrescenta. Pendência P14. | RF05.R9, RF19 | E10 |

### Cadastros de apoio

| Tabela | O que falta | RF | Etapa |
|---|---|---|---|
| `categories` (tem `kind` com investment/deduction, `nature`, `dre_group`, `is_sensitive`) | Exige Quantidade; palavras de apoio (até 30); status ATIVA/INATIVA; origem SISTEMA/EMPRESA (hoje `tenant_id` nulo); herança de tipo, grupo e sensível pela subcategoria; no máximo dois níveis; categoria própria sempre filha de uma padrão. A lista do seed é provisória (P01, P02, P05). | RF07 | E6 (palavras de apoio e Exige Quantidade para a IA), F6 (edição) |
| `payment_methods` | Tipo (DINHEIRO, PIX, DEBITO, CREDITO, VOUCHER, BOLETO, TRANSFERENCIA, OUTRO); apelidos (até 10); status; "forma de cartão padrão" da empresa (usada por "cartão" sem especificar); forma "Não informada". | RF08, RF12.R8 | E6 (padrão e apelidos), F6 |
| `sales_channels` | Tipo (SALAO, DELIVERY_PROPRIO, APLICATIVO, RETIRADA, OUTRO); apelidos; status; regra: canal APLICATIVO com comissão substitui a taxa da forma de pagamento (P06); canal "Não informado". | RF09 | E7 (cálculo), F6 |
| `suppliers` (tem `aliases`) | Categoria habitual; origem MENSAGEM/NOTA_FISCAL/PAINEL/IMPORTACAO; status; CPF mascarado; mesclagem; unicidade do documento na empresa. | RF10 | E7 (criação automática), F6 (mesclagem) |

### Lançamento e histórico

| Tabela | O que falta | RF | Etapa |
|---|---|---|---|
| `entries` | Sinais de revisão (CATEGORIA_A_REVISAR, POSSIVEL_DUPLICIDADE, DATA_ANTIGA) e ação "marcar como revisado"; canal de origem `EMAIL`; motivo da exclusão, quem excluiu e restaurável até (hoje só `deleted_at`); documento fiscal com chave de acesso (44 dígitos, única por empresa) e itens agrupados por categoria; o id da confirmação enviada já existe (`confirmation_wa_message_id`) e a posição na mensagem de origem também (`position`). | RF12.R12, R13, RF14, RF24 | E7, E9, F3 |
| `entry_versions` (`action`: create, update, delete; `channel`: whatsapp, web, import, system) | Ação `restore` (RESTAURACAO); canal `email`. O documento chama os canais de WHATSAPP, PAINEL, IMPORTACAO, EMAIL, SISTEMA (mapeamento em `requisitos.md`). | RF25.R4 | E7, F3 |
| `entries.ai_confidence` | RNF08.R3 proíbe rotear por "confiança" declarada pelo modelo; a coluna pode ficar só informativa (revisar na E6). | RNF08.R3 | E6 |
| `pending_questions` (tem `expires_at`) | Situação ABERTA/RESPONDIDA/CANCELADA/EXPIRADA; no máximo uma aberta por colaborador; validade de 24 h aplicada; cancelamento por mensagem nova de lançamento. | RF15 | E7 |
| `inbound_messages` (status received, processing, needs_answer, processed, failed; tipo text, audio, image, unsupported) | Já equivale às situações e aos tipos do RF11. Falta retenção de áudio em 90 dias (só a transcrição permanece) e atribuição à empresa citada no texto. | RF11.R5, RF13.R4, RNF03 | E7, E9, E10 |
| `outbound_messages` | Envio idempotente da confirmação por (mensagem de origem, finalidade). Pendência P14. | RF16.Obs1 | E7 |
| `ai_usage` | Tokens de leitura e escrita de cache; limite de custo por empresa e alerta; consulta por empresa e por mensagem no painel interno. | RNF08.R1, RF21.R4, RF38 | E6 (cache), E10, F10 |
| `audit_log` (`tenant_id` obrigatório) | Cobrir login, bloqueios, troca de senha ou e-mail, papel e permissões, exportações, taxas, importações e ações do painel interno; ações sem empresa (login, painel interno) exigem `tenant_id` opcional ou trilha própria. | RNF04.R4, RF38 | F1, F2, F10 |

### Tabelas novas

| Tabela (proposta) | Para quê | RF | Etapa |
|---|---|---|---|
| `recurring_rules` (já no rascunho acima) | Lançamentos recorrentes e valor variável sem lançamento no mês. | RF33 | E13 (v1.1) |
| `imports` e linhas importadas | Importação de planilhas, extratos OFX/CSV e relatórios de vendas, desfazer em 30 dias. | RF35 | E13 (v1.1) |
| `exports` | Pedido de exportação, situação, link assinado de 1 hora, arquivo apagado em 7 dias. | RF29 | F5 |
| `received_invoices` (notas por e-mail) | Endereço exclusivo da empresa, notas recebidas, quarentena, deduplicação pela chave de acesso. | RF31 | E13 (v1.1) |
| `notification_preferences` e histórico de envios | Resumo semanal, alertas por exceção e preferências por colaborador. | RF34 | E13 (v1.1) |
| `subscriptions` e cobranças | Plano, ciclo, situação do pagamento, encerramento e eliminação de dados. | RF37 | F9 |
| `admin_actions` e autorizações temporárias | Ações do painel interno e acesso do suporte limitado a 24 horas. | RF38 | F10 |
| `ask_history` | Histórico de perguntas do usuário em linguagem natural (90 dias). | RF30 | v1.1 |
| Limites e cotas por plano | Mensagens por hora e por dia, cota mensal de consultas, duração de áudio e tamanho de imagem como configuração por plano. | RF21 | E9, E10 |

Toda tabela nova segue a regra `.claude/rules/tabela-nova.md` (`tenant_id`, RLS, política, atualização do `schema.test.ts` e do `fixtures.ts`).

## Infraestrutura

- **Postgres gerenciado** na região São Paulo, com backup diário e point-in-time recovery (Supabase, Neon ou AWS RDS `sa-east-1`).
- **API e workers** como containers (Railway, Render, Fly.io ou AWS ECS), mesma imagem com comando diferente.
- **Web** na Vercel ou no mesmo provedor da API.
- **Armazenamento** S3-compatível com criptografia em repouso e regra de ciclo de vida (áudios expiram em 90 dias).
- **Ambientes:** local (Docker Compose com Postgres), staging, produção. Número de WhatsApp de teste separado do de produção.
- **CI (GitHub Actions):** lint, typecheck, testes, evals quando `packages/ai` muda, migrations checadas.

## Segurança

- Assinatura do webhook validada sempre.
- Rate limit por número de telefone e por IP.
- Sessões com cookie `httpOnly`, `secure`, `sameSite=lax`.
- Segredos em variáveis de ambiente validadas na inicialização.
- Logs sem PII: nunca logar texto de mensagem, transcrição, CPF ou valores de salário.
- Dependências verificadas com `pnpm audit` e Dependabot/Renovate.
