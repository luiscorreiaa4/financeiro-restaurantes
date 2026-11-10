# Dicionário de testes

Lido pelo agente `verificador` antes de rodar qualquer coisa. Mapeia **assunto → pacote → comando**, para ele escolher o menor conjunto que cobre a mudança. Manter atualizado: a regra `.claude/rules/dicionario-testes.md` manda atualizar quando um assunto de teste novo aparece.

Comandos sempre a partir da raiz do repo. Nunca `npx`, `vitest` ou `tsc` avulsos.

## Comandos gerais

| O que | Comando | Observação |
|---|---|---|
| Lint + formatação (Biome) | `pnpm lint` | Repo inteiro, é rápido. Correção automática é `pnpm format` (só quando pedido). |
| Tipos de tudo | `pnpm typecheck` | Turbo, com cache. |
| Tipos de um pacote | `pnpm --filter @app/<pacote> typecheck` | |
| Unitários de tudo | `pnpm test` | Não inclui `*.int.test.ts`. |
| Unitários de um pacote | `pnpm --filter @app/<pacote> test` | |
| Um arquivo unitário | `pnpm --filter @app/<pacote> test <trecho-do-caminho>` | Ex.: `pnpm --filter @app/core test money`. |
| Integração de tudo | `pnpm test:int` | Precisa de Docker rodando (Testcontainers). Lento. |
| Integração de um pacote | `pnpm --filter @app/<pacote> test:int` | Só `@app/api` e `@app/db` têm. |
| Um arquivo de integração | `pnpm --filter @app/<pacote> test:int <trecho>` | Ex.: `pnpm --filter @app/db test:int isolation`. |
| Evals de IA | `pnpm --filter @app/ai eval` | **Gasta crédito de verdade** (cerca de US$ 0,015 por rodada) e precisa de `ANTHROPIC_API_KEY` no `.env`. Não rode sem o usuário pedir. Flags: `--only=f01,m02`, `--verbose`, `--max-usd=0.3`, `--update-baseline`. |
| Frases direto na IA | `pnpm --filter @app/ai extract ["frase"]` | Também gasta crédito; só quando pedido. |

## Assunto → onde está → o que rodar

### Domínio puro (`@app/core`, sem banco)

| Assunto | Arquivos | Comando |
|---|---|---|
| Dinheiro em centavos, `formatBRL` | `packages/core/src/money/money.test.ts` | `pnpm --filter @app/core test money` |
| Taxa/fee | `packages/core/src/money/fee.test.ts` | `pnpm --filter @app/core test fee` |
| Lançamento (`entry`) | `packages/core/src/entry/entry.test.ts` | `pnpm --filter @app/core test entry` |
| Interpretação da extração (datas, perguntas, descrição sem CPF) | `packages/core/src/entry/interpret.test.ts` | `pnpm --filter @app/core test interpret` |
| Rascunhos de lançamento (categoria, fornecedor, taxa, duplicidade) | `packages/core/src/entry/build-drafts.test.ts` | `pnpm --filter @app/core test build-drafts` |
| Correção por reply | `packages/core/src/entry/correction.test.ts` | `pnpm --filter @app/core test correction` |
| Itens da nota agrupados por categoria | `packages/core/src/entry/group-receipt.test.ts` | `pnpm --filter @app/core test group-receipt` |
| Chave de acesso da NFC-e, QR, limites de uso | `packages/core/src/media/media.test.ts` | `pnpm --filter @app/core test media` |
| Schema de extração (Zod) | `packages/core/src/entry/extraction.test.ts` | `pnpm --filter @app/core test extraction` |
| Permissões e papéis | `packages/core/src/permissions/permissions.test.ts` | `pnpm --filter @app/core test permissions` |
| Telefone | `packages/core/src/phone/phone.test.ts` | `pnpm --filter @app/core test phone` |
| Acesso do colaborador: unidades de acesso, unidade padrão, Dono ativo, convite do contador | `packages/core/src/access/*.test.ts` | `pnpm --filter @app/core test access` |
| Contexto do painel (RF02.R6, RF37): cookie `fr_ctx`, fallback de empresa e unidade, situação da conta, ações permitidas | `packages/core/src/access/panel-context.test.ts` | `pnpm --filter @app/core test panel-context` |
| Cadastros: unidade (apelidos, CNPJ, UF, última ativa) e subcategoria (herança, dois níveis) | `packages/core/src/registry/*.test.ts` | `pnpm --filter @app/core test registry` |
| Municípios (DD-29): cópia do IBGE com as 27 UFs (ordenada, sem repetido, total plausível), carga por UF, busca sem acento e grafia oficial. Mudou a cópia (`pnpm --filter @app/core municipalities:update`)? Rode este | `packages/core/src/registry/municipalities/municipalities.test.ts` | `pnpm --filter @app/core test municipalities` |
| Imposto estimado por regime, vigência e arredondamento | `packages/core/src/tax/tax.test.ts` | `pnpm --filter @app/core test tax` |
| Campos novos do lançamento: data de pagamento, pedidos, canal padrão, investimento, lixeira | `packages/core/src/entry/entry-e11.test.ts` | `pnpm --filter @app/core test entry-e11` |
| Conversa: comandos, roteamento, remetente | `packages/core/src/conversation/*.test.ts` | `pnpm --filter @app/core test conversation` |
| Acesso ao painel: regras de senha, bloqueio de 15 min e limite de envio de código | `packages/core/src/auth/auth-policy.test.ts` | `pnpm --filter @app/core test auth-policy` |
| Sessão do painel: 12 h sem uso, 30 dias com "manter conectado", renovação a cada 5 min | `packages/core/src/auth/session-policy.test.ts` | `pnpm --filter @app/core test session-policy` |
| Autocadastro (F1b, RF01): validação (obrigatórios, celular, senha fraca, CNPJ, UF, termos), padrões da conta (formas, canais, teste de 14 dias, versões dos termos, situações) e fuso por UF | `packages/core/src/signup/*.test.ts` | `pnpm --filter @app/core test signup` |
| Erros de domínio tipados | `packages/core/src/errors/errors.test.ts` | `pnpm --filter @app/core test errors` |
| Core não importa infra; sem ciclos (ArchUnitTS) | `packages/core/src/architecture.test.ts` | `pnpm --filter @app/core test architecture` |

### Banco (`@app/db`)

| Assunto | Arquivos | Comando |
|---|---|---|
| Schema, cliente, UUID v7, categorias de sistema (unitário) | `packages/db/src/*.test.ts` | `pnpm --filter @app/db test` |
| **Isolamento RLS por tenant** (obrigatório em tabela nova) | `packages/db/test/isolation.int.test.ts` | `pnpm --filter @app/db test:int isolation` |
| Integridade (constraints, FKs) | `packages/db/test/integrity.int.test.ts` | `pnpm --filter @app/db test:int integrity` |
| Lançamentos, versões, pergunta pendente, nota fiscal, uso de IA (`EntryStore`) | `packages/db/test/entry-store.int.test.ts` | `pnpm --filter @app/db test:int entry-store` |
| Ingestão de mensagem bruta | `packages/db/test/inbound-ingest.int.test.ts` | `pnpm --filter @app/db test:int inbound-ingest` |
| Processamento de mensagem (idempotência) | `packages/db/test/inbound-processing.int.test.ts` | `pnpm --filter @app/db test:int inbound-processing` |
| Conversa (estado/roteamento no banco) | `packages/db/test/conversation.int.test.ts` | `pnpm --filter @app/db test:int conversation` |
| Seed de desenvolvimento | `packages/db/test/dev-seed.int.test.ts` | `pnpm --filter @app/db test:int dev-seed` |
| Migração das unidades de acesso (`unit_id` → lista, sem perder acesso) | `packages/db/test/membership-access-migration.int.test.ts` | `pnpm --filter @app/db test:int membership-access` |
| Migração das unidades e cadastros de apoio (tipos, cartão padrão, "Não informado") | `packages/db/test/catalog-migration.int.test.ts` | `pnpm --filter @app/db test:int catalog-migration` |
| Migração dos campos do lançamento (`paid_on`, canal da receita, lixeira) | `packages/db/test/entry-fields-migration.int.test.ts` | `pnpm --filter @app/db test:int entry-fields` |
| Convite do contador e aceite do aviso de folha | `packages/db/test/access-repo.int.test.ts` | `pnpm --filter @app/db test:int access-repo` |
| Tabelas de login (`sessions` com `keep_connected`, `users.email` normalizado, `accounts`, `verifications`, `auth_audit`), `phone_e164` opcional e menor privilégio do papel `app_auth` | `packages/db/test/auth-migration.int.test.ts` | `pnpm --filter @app/db test:int auth-migration` |
| Autocadastro no banco (F1b, RF01): colunas novas de `tenants`, CNPJ único entre contas não encerradas, `signup_verifications`, `app_auth` só com INSERT (sem SELECT nem RETURNING, chaves compostas incluídas) | `packages/db/test/signup-migration.int.test.ts` | `pnpm --filter @app/db test:int signup-migration` |
| Código e comprovante do autocadastro (`signup-store`): limites por e-mail e IP, 3 erros, aviso como código errado, comprovante de uso único e corridas | `packages/db/test/signup-store.int.test.ts` | `pnpm --filter @app/db test:int signup-store` |
| Consultas de conta do `auth-store` (F1c): hash de senha, sessões ativas, revogar outras sessões, nome, busca por id (`findUserById`) e eventos de auditoria novos | `packages/db/test/auth-store.int.test.ts` | `pnpm --filter @app/db test:int auth-store` |
| Contexto do painel no banco (F2, DD-31): GRANT por coluna do `app_auth` em `tenants` e `units` (migration 0017), `listPanelMemberships` (vínculos ativos com painel, unidades ativas, só do usuário), `hasActiveMembership` igual a `resolvePanelContext` em todas as personas e `listActiveUnits` sob `withTenant` | `packages/db/test/panel-access-store.int.test.ts` | `pnpm --filter @app/db exec vitest run panel-access-store` |
| Imposto estimado: configuração, auditoria e regras (`TaxRepo`) | `packages/db/test/tax-repo.int.test.ts` | `pnpm --filter @app/db test:int tax-repo` |
| Sem ciclos entre arquivos (ArchUnitTS, unitário) | `packages/db/src/architecture.test.ts` | `pnpm --filter @app/db test architecture` |

### API, webhook e workers (`@app/api`)

| Assunto | Arquivos | Comando |
|---|---|---|
| App Fastify | `apps/api/src/app.test.ts` | `pnpm --filter @app/api test app` |
| Camadas: modules não dependem de http/dev, http não depende de infra/dev, sem ciclos (ArchUnitTS) | `apps/api/src/architecture.test.ts` | `pnpm --filter @app/api test architecture` |
| Webhook do WhatsApp (unitário) | `apps/api/src/http/webhooks/whatsapp.test.ts` | `pnpm --filter @app/api test webhooks` |
| `process-inbound` e `route-inbound` (unitário) | `apps/api/src/modules/inbound/*.test.ts` | `pnpm --filter @app/api test inbound` |
| Chat de desenvolvimento e sender fake | `apps/api/src/dev/chat-session.test.ts`, `apps/api/src/infra/dev-message-sender.test.ts` | `pnpm --filter @app/api test dev` |
| Webhook ponta a ponta (assinatura, 200 rápido, fila) | `apps/api/test/whatsapp-webhook.int.test.ts` | `pnpm --filter @app/api test:int whatsapp-webhook` |
| Worker pg-boss (retry, DLQ) | `apps/api/test/process-inbound-worker.int.test.ts` | `pnpm --filter @app/api test:int process-inbound-worker` |
| Roteamento de mensagem com banco | `apps/api/test/route-inbound.int.test.ts` | `pnpm --filter @app/api test:int route-inbound` |
| Fluxo completo: texto, pergunta, desfazer, correção, áudio, foto, limites, lida/digitando | `apps/api/test/entries-flow.int.test.ts` | `pnpm --filter @app/api test:int entries-flow` |
| Envio de e-mail do código de acesso e do aviso de conta existente (adaptadores de memória e de arquivo) | `apps/api/src/infra/email/email-sender.test.ts` | `pnpm --filter @app/api test email-sender` |
| Mensagens de erro do login em pt-BR (`authError`) | `apps/api/src/http/auth/auth-messages.test.ts` | `pnpm --filter @app/api test auth-messages` |
| Tarefas em segundo plano (envio do código fora da requisição) | `apps/api/src/infra/auth/background-tasks.test.ts` | `pnpm --filter @app/api test background-tasks` |
| Composição: recusa o e-mail em arquivo com `NODE_ENV=production` | `apps/api/src/composition.test.ts` | `pnpm --filter @app/api test composition` |
| Login do painel ponta a ponta (Better Auth): código, senha, bloqueio, limites de envio, sessão de 12 h/30 dias, vínculo desativado (também em `/api/auth/*`), corridas em paralelo, cookie `Secure`, `/api/me`, auditoria e logs sem e-mail | `apps/api/test/auth-login.int.test.ts` | `pnpm --filter @app/api test:int auth-login` |
| Lista fechada de rotas `/api/auth/*` (404 fora das quatro permitidas, inclusive os pedidos de recuperação, com e sem sessão, variações de barras e caixa) | `apps/api/test/auth-allowlist.int.test.ts` | `pnpm --filter @app/api test:int auth-allowlist` |
| Operações do `AuthGateway` de recuperação de senha: pedir o link (vínculo e limites em segundo plano), espiar o link sem consumir, redefinir com o link (cria a conta `credential`), link vencido, `verifyPassword` | `apps/api/test/auth-gateway.int.test.ts` | `pnpm --filter @app/api test:int auth-gateway` |
| Recuperação de senha (F1c, RF03): ordem das etapas do caso de uso pelo link (espiar, usuário, política, mesma senha, revogar, gravar, revogar, auditar) e pedido do link, com fakes | `apps/api/src/modules/recovery/recover-password.test.ts` | `pnpm --filter @app/api test recover-password` |
| Auditoria que falha depois da troca não vira erro (DD-30, F1c-2) | `apps/api/src/modules/auth/record-audit-safely.test.ts` | `pnpm --filter @app/api test record-audit-safely` |
| Perfil (F1c, RF02): serviço com fakes (ordem das etapas, e-mail normalizado, nome, NO_PASSWORD) | `apps/api/src/modules/profile/profile-service.test.ts` | `pnpm --filter @app/api test profile-service` |
| Perfil ponta a ponta (`/api/profile*`): 401 sem sessão e sem vínculo, sessões sem token/id, nome, troca de senha com a atual e pedido/conclusão do link (`/password/link`, DD-27), regra de senha, IP da conexão, revogar outras sessões, auditoria, 500 genérico | `apps/api/test/profile.int.test.ts` | `pnpm --filter @app/api test:int profile` |
| Recuperação de senha ponta a ponta (`POST /api/recovery/request` e `/reset`, link de uso único, DD-27): anti-enumeração, SAME_PASSWORD, regra de senha, vencimento em 30 min, link usado, dois links válidos, sessões revogadas, aviso, auditoria, IP do servidor, 500 genérico | `apps/api/test/auth-recovery.int.test.ts` | `pnpm --filter @app/api test:int auth-recovery` |
| Autocadastro: código e verificação de e-mail (`/api/signup/code` e `/verify`): resposta idêntica para e-mail novo, cadastrado ou limitado, aviso de conta existente, 3 tentativas, 5 min, limites por e-mail e IP, e-mail com caixa e espaços, código de login e de cadastro não se misturam, comprovante só com hash | `apps/api/test/signup-code.int.test.ts` | `pnpm --filter @app/api test:int signup-code` |
| Autocadastro: gravação da conta (`POST /api/signup`, `signup-repo`): conta completa (CA07), sem comprovante (CA02), CNPJ simultâneo (CA04), celular em uso (CA05), termos (CA06), falha injetada desfaz tudo (CA08), celular E.164 (CA09), senha só em hash (CA10), CNPJ vazio vira null, comprovante paralelo e de outro e-mail, imposto desligado, sessão aberta e aceita por `/api/me` | `apps/api/test/signup-create.int.test.ts` | `pnpm --filter @app/api test:int signup-create` |
| Autocadastro: "Criar outra empresa" (`POST /api/companies`, `signupRepo.createCompany`): sem sessão 401, empresa e vínculo de Dono para o usuário atual sem usuário novo, contador sem celular (`phone_required` e gravação), celular de outro (PHONE_TAKEN), celular existente mantido, `preferred_at` e empresa ativa do canal, CNPJ em uso, vínculo desativado em outra empresa | `apps/api/test/company-create.int.test.ts` | `pnpm --filter @app/api test:int company-create` |
| Guards do painel (F2, RF02.R6, RF06.R2): `requirePanelContext`, `requireTenantRoute` (403 `context_invalid`, 409 `context_changed`), `requirePermission`, `requireWritable`, cookie `fr_ctx`, matriz 4 papéis x 18 ações contra `can()` | `apps/api/src/http/panel/panel-context.test.ts` | `pnpm --filter @app/api test panel-context` |
| Rotas do painel ponta a ponta (F2): `/api/me` com contexto e `startUnitId`, `POST /api/context`, `/api/units` (RLS, gerente limitado), 409 de duas abas, `invalid_cookie`, contador e conta cancelada, expirar `fr_ctx` no login e no sair, log sem cookie | `apps/api/test/panel-context.int.test.ts` | `pnpm --filter @app/api test:int panel-context` |
| Mensagens de erro do autocadastro em pt-BR (`signupError`) | `apps/api/src/http/signup/signup-messages.test.ts` | `pnpm --filter @app/api test signup-messages` |
| Município fora da lista oficial da UF no autocadastro e em "Criar outra empresa" (`citiesForForm`, `city_invalid`, nada gravado) | `apps/api/src/modules/signup/cities-for-form.test.ts` | `pnpm --filter @app/api test cities-for-form` |
| Relógio, mídia (disco, downloader de dev, conversor ffmpeg, leitor de QR) | `apps/api/src/infra/clock.test.ts`, `apps/api/src/infra/media/media-infra.test.ts` | `pnpm --filter @app/api test infra` |

### WhatsApp, config, IA, web

| Assunto | Arquivos | Comando |
|---|---|---|
| Parsing de webhook, assinatura, verificação, simulador, download de mídia da Meta | `packages/whatsapp/src/*.test.ts` | `pnpm --filter @app/whatsapp test` |
| Variáveis de ambiente (Zod) | `packages/config/src/env.test.ts` | `pnpm --filter @app/config test` |
| IA: extrator, prompt, custo, transcrição, evals (pontuação e baseline, sem rede) | `packages/ai/src/**/*.test.ts` | `pnpm --filter @app/ai test` |
| Painel: formatação (`formatBRL`, datas de negócio), ambiente do web | `apps/web/lib/format/format.test.ts`, `apps/web/lib/env.test.ts` | `pnpm --filter @app/web test format` |
| Painel: cliente da API (`ApiError`, contrato Zod) e `QueryClient` | `apps/web/lib/api/client.test.ts`, `apps/web/lib/query/get-query-client.test.ts` | `pnpm --filter @app/web test lib/api` |
| Painel: casca (navegação, menu do celular) e compatibilidade do Recharts | `apps/web/components/app-shell.test.tsx`, `apps/web/lib/charts/recharts-compat.test.tsx` | `pnpm --filter @app/web test app-shell` |
| Painel: sessão no servidor (`getSession`, `requireSessionOrRedirect`), `proxy.ts` (cookie, rotas públicas) e tela de acesso (modos código e senha, contagem de 60 s, erros em português) | `apps/web/lib/auth/session.test.ts`, `apps/web/proxy.test.ts`, `apps/web/features/auth/login-form.test.tsx` | `pnpm --filter @app/web test auth` (e `test proxy`) |
| Painel: autocadastro (F1b, RF01): e-mail e código com mensagem igual para qualquer e-mail, código incorreto e bloqueio com contagem, formulário único (nome da unidade pré-preenchido R7, CNPJ inválido CA01, aceite CA06, CNPJ/celular em uso CA04/CA05, comprovante vencido), "Criar outra empresa" (celular só com `phone_required`), município escolhido da lista da UF (DD-29: desabilitado sem UF, busca sem acento, texto solto não vira valor, trocar a UF limpa), boas-vindas (link `wa.me`, QR Code, sem número configurado), cliente `signup-api` e `NEXT_PUBLIC_WHATSAPP_NUMBER` | `apps/web/features/signup/*.test.ts(x)`, `apps/web/lib/env.test.ts` | `pnpm --filter @app/web test signup` |
| Painel: máscaras do cadastro (CNPJ numérico e alfanumérico, celular com +55 e zero de tronco, cursor ao inserir no meio e Backspace sobre a pontuação) | `apps/web/lib/input-masks.test.ts` | `pnpm --filter @app/web test input-masks` |
| Painel ponta a ponta (Playwright: casca, 404, cabeçalhos, rewrite de `/api/*`, login por código e senha, sair; desktop e celular) | `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/login.spec.ts` | `pnpm --filter @app/web test:e2e` (`... test:e2e login`) |
| Autocadastro ponta a ponta (Playwright, API falsa: e-mail, código, formulário, município da lista com a lista aberta, `/bem-vindo`, "Criar outra empresa", sem rolagem horizontal no celular) | `apps/web/e2e/signup.spec.ts` | `pnpm --filter @app/web exec playwright test signup` (o `-- arquivo` do `test:e2e` roda todos) |
| Painel: recuperação de senha por link (F1c, RF03, DD-27): pedido do link com mensagem fixa e reenvio em 60 s, tela `/redefinir-senha` (token no fragmento da URL, confirmação de senha, link inválido), aviso "Senha alterada" no login e link "Esqueci a senha" só no modo senha | `apps/web/features/auth/recover-form.test.tsx`, `apps/web/features/auth/reset-password-form.test.tsx`, `apps/web/features/auth/login-form.test.tsx` | `pnpm --filter @app/web test recover-form` (e `reset-password-form`) |
| Painel: "Meu perfil" (F1c, RF02.R8/Obs3): cliente com contrato Zod, nome, senha (atual ou link por e-mail, inclusive sem senha definida), sessões ativas (selo, texto sem HTML, encerrar as outras) e menu do usuário | `apps/web/features/profile/*.test.ts(x)`, `apps/web/components/user-menu.test.tsx` | `pnpm --filter @app/web test profile` (e `test user-menu`) |
| Recuperação de senha por link e perfil ponta a ponta (Playwright, API falsa com perfil por cookie de sessão e token fixo `link-valido-123`; desktop e Pixel 7, sem rolagem horizontal) | `apps/web/e2e/recovery.spec.ts`, `apps/web/e2e/profile.spec.ts` | `pnpm --filter @app/web exec playwright test recovery profile` (precisa de a porta do `next dev` livre: pare o `pnpm dev`) |

## Qual conjunto rodar, por tipo de mudança

| Mudou | Rode |
|---|---|
| `packages/core/**` | `@app/core test` (inclui architecture) + `pnpm typecheck` + `pnpm lint` |
| `packages/db/src/schema/**` ou migration | `@app/db test` + `@app/db test:int` (isolation e integrity no mínimo) + `pnpm typecheck` |
| `packages/whatsapp/**` | `@app/whatsapp test` + `@app/api test:int whatsapp-webhook` |
| `apps/api/src/**` | `@app/api test` + `typecheck`; `test:int` do arquivo afetado se tocar fila, webhook ou banco |
| `packages/ai/**` (prompt ou schema de extração) | `@app/ai test` + `@app/core test extraction` + `@app/ai eval` (**só com o OK do usuário**, gasta crédito; compara com `baseline.json`) |
| `apps/web/**` | `@app/web typecheck` + `@app/web test` + `@app/web test:e2e` (+ `API_URL=http://localhost:4010 pnpm --filter @app/web exec next build` se mudou rota/config) |
| Só docs/regras do Claude | nada |
| Mudança ampla ou fechamento de etapa | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int` |

## Armadilhas conhecidas

- Testes de arquitetura (ArchUnitTS) usam `check()` e exigem `globals: true` no `vitest.config.ts` do pacote (já ligado em core, db e api); lentos (10 s+) por analisar o projeto. Pacote novo com `architecture.test.ts` precisa do mesmo config.
- Integração precisa do Docker ligado. Se falhar com erro de conexão ao Docker/Testcontainers, reporte como **ambiente**, não como falha de código.
- Insert direto por SQL em teste precisa de `id` gerado com `uuidv7()` de `@app/db`; sem isso: `null value in column "id"`.
- `pnpm test` não roda `*.int.test.ts`; passar no unitário não prova isolamento nem fila.
- O `eval`, o `extract` e qualquer teste "ao vivo" chamam a API real e custam dinheiro. Os testes automáticos nunca chamam: IA, transcrição e mídia são roteirizadas (`createFake*` em `@app/ai`).
- O E2E do web (`test:e2e`) sobe o web na porta 3100 e uma API falsa na 4010 (`apps/web/e2e/fake-api.mjs`, que também finge o login: cookie `better-auth.session_token=sessao-falsa`, código `123456`, senha `demo12345`; as páginas do painel exigem esse cookie, então o `smoke.spec.ts` o injeta); com `CI=true` roda `next build` + `next start`, sem `CI` usa `next dev`. Precisa do Chromium (`pnpm --filter @app/web exec playwright install chromium`). Na API falsa o perfil é guardado pelo valor do cookie de sessão (`sessao-falsa-<id>`), então cada teste de perfil usa o seu; no Next 16 a tela anterior fica oculta no DOM depois de uma navegação do cliente e `getByLabel` a encontra: filtre por `{ visible: true }`. `*.spec.ts` é do Playwright e o Vitest os ignora (`exclude: e2e/**`).
- Se `.next/types` apontar para página removida e o `typecheck` do web acusar `Cannot find module '../../app/...'`, apague `apps/web/.next` (saída de build, ignorada pelo git).
- No `auth-login.int.test.ts` o Better Auth usa `Date` para vencer código e sessão: o teste falsifica só `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`) e anda o tempo com `vi.setSystemTime`; falsificar timers trava o pg e o `inject`. O envio do código roda em segundo plano: use `requestCode` (que chama `tasks.drain()`) antes de conferir `email.sent`.
- Python e `sed` no Windows gravam CRLF: depois de editar arquivo por script, rode `pnpm exec biome check --write <arquivo>` (o hook só formata o que passa pelo Write/Edit).
