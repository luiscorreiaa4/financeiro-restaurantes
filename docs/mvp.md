# Escopo do MVP

Objetivo da v1: **lançamento pelo WhatsApp 100% funcional** e um **painel web** com lançamentos editáveis e gráficos simples. Tudo o que não está aqui fica para depois.

Cada fase termina com algo testável de ponta a ponta.

## Fase 0 — Fundação

- [ ] Monorepo pnpm + Turborepo (`apps/api`, `apps/web`, `packages/{db,core,ai,whatsapp,config}`)
- [ ] TypeScript strict, Biome, Vitest configurados na raiz
- [ ] `packages/config/env`: validação de variáveis de ambiente com Zod
- [ ] Docker Compose com Postgres 16 para desenvolvimento
- [ ] CI no GitHub Actions: lint, typecheck, testes
- [ ] `.env.example` completo

## Fase 1 — Domínio e banco

- [ ] Schema Drizzle: tenants, units, users, memberships, categories, suppliers, payment_methods, sales_channels, inbound_messages, entries, entry_versions, pending_questions, ai_usage, audit_log
- [ ] Políticas RLS em todas as tabelas de cliente + helper `withTenant(tenantId, fn)`
- [ ] Teste de isolamento entre tenants
- [ ] Seed com plano de categorias padrão (provisório até o contador validar)
- [ ] `packages/core`: tipo `Money` em centavos, `formatBRL`, cálculo de taxa e líquido, regras de permissão por papel, criação e edição de lançamento com versão

## Fase 2 — WhatsApp: recebimento e texto

- [ ] Webhook: verificação (GET), recebimento (POST), validação de assinatura, gravação idempotente, enfileiramento
- [ ] pg-boss configurado no `apps/api` com worker separado
- [ ] Identificação do usuário pelo telefone; resposta educada para número desconhecido
- [ ] Extração de lançamentos por texto com Claude (tool use + schema Zod), vários por mensagem
- [ ] Presunções: data de hoje, unidade padrão, categoria e forma de pagamento sugeridas
- [ ] Pergunta de volta quando faltar valor ou unidade ambígua (`pending_questions`)
- [ ] Mensagem de confirmação no formato padrão
- [ ] Comandos: `desfazer`, `ajuda`
- [ ] Correção respondendo (reply) à confirmação
- [ ] Registro de `ai_usage`
- [ ] Evals: primeiro conjunto com 30+ mensagens de exemplo e resultado esperado

## Fase 3 — Áudio e foto

- [ ] Download de mídia da Meta e upload para S3
- [ ] Transcrição de áudio (limite de ~3 min) e reaproveitamento do fluxo de texto
- [ ] Foto: leitura de QR Code da NFC-e e consulta à SEFAZ (começar pelos estados dos pilotos)
- [ ] Foto sem QR: extração multimodal
- [ ] Rate limit por usuário

## Fase 4 — Painel web

- [ ] Login por código (OTP) via WhatsApp ou e-mail
- [ ] Seleção de conta e unidade
- [ ] Lista de lançamentos com filtros (período, tipo, categoria, unidade), edição e exclusão para lixeira
- [ ] "Ver origem": texto, player de áudio ou imagem da nota
- [ ] Histórico de versões do lançamento
- [ ] Dashboard: receita × despesa, despesas por categoria, evolução mensal, resultado do mês
- [ ] Exportação Excel/CSV
- [ ] Gestão de usuários e papéis (dono convida pelo telefone)
- [ ] Configuração de formas de pagamento e taxas
- [ ] Layout responsivo + manifest PWA

## Fase 5 — Pronto para piloto

- [ ] Onboarding: criar conta, unidade, cadastrar telefones
- [ ] Termos de Uso e Política de Privacidade publicados
- [ ] Sentry e logs estruturados sem PII
- [ ] Backup verificado com teste de restauração
- [ ] Painel interno simples de custo de IA por tenant
- [ ] Deploy em staging e produção

## Depois do MVP (backlog)

- Perguntas em linguagem natural sobre os dados (v1.1)
- Resumo semanal e alertas por exceção
- Fechamento mensal em PDF
- Lançamentos recorrentes automáticos
- Importação de planilhas existentes, extratos OFX/CSV, relatórios de PDV e iFood
- Captura de NF-e por certificado A1, Open Finance, API do iFood
- Perfil Contador multi-cliente
- Precificação sugerida por prato
