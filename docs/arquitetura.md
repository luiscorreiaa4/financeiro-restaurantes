# Arquitetura

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

- O LLM recebe a mensagem (texto ou transcrição), o contexto do tenant (categorias, fornecedores frequentes, unidades, data de hoje) e responde **chamando uma ferramenta** cujo input é o schema Zod de lançamentos. Nada de parsing de texto livre.
- Saída validada; se inválida, uma nova tentativa com o erro; se persistir, pergunta ao usuário.
- Roteamento: Haiku por padrão; Sonnet para fotos difíceis, mensagens longas ou baixa confiança.
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
- Folha de pagamento: categorias do grupo Pessoal ficam marcadas como sensíveis; a API filtra por permissão.

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
