# F1b Autocadastro do dono: plano de implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`. Os passos usam caixas (`- [ ]`).

**Objetivo:** o dono cria a própria conta em `/cadastro` (e-mail e código primeiro, depois formulário único), sai logado em `/bem-vindo`, e quem já está logado pode criar outra empresa.

**Arquitetura:** rotas próprias na API (`/api/signup/code`, `/api/signup/verify`, `/api/signup`, `/api/companies`), fora do Better Auth. O código e o comprovante ficam numa tabela própria. A gravação é uma transação com o papel `app_auth`, que ganha só INSERT. A sessão abre pelo contexto interno do Better Auth (plano B: levar a `/login`).

**Tecnologias:** TypeScript, Fastify, Zod, Drizzle (migration SQL revisada), Postgres com RLS, Better Auth, Next.js 16, Vitest + Testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-f1b-autocadastro-design.md`. Regras: `docs/requisitos.md`, RF01 (CA01 a CA10) e RF02.R1/R4. Desenho-mãe: `docs/superpowers/specs/2026-11-07-f1-autenticacao-design.md`.

## Restrições globais

- Código de e-mail: 6 dígitos, vale 5 min, 3 tentativas, reenvio após 60 s, no máximo 5 envios por hora por e-mail e 20 por hora por IP. Reaproveitar `decideOtpSend` e as constantes de `packages/core/src/auth/auth-policy.ts`.
- Comprovante de e-mail verificado: opaco, uso único, vale 30 min, guardado só com hash.
- Tamanhos: nome fantasia 2 a 100; razão social até 150; nome da unidade 2 a 60; nome do dono 3 a 120 (letras, espaços, apóstrofo e hífen); senha opcional de 8 a 64 (`validatePassword`).
- Conta nova: `plan = "trial"` (TESTE), situação `active`, teste de 14 dias `[PROVISÓRIO – P03]`; padrões de pagamento e canais `[PROVISÓRIO – P07]`, ambos em constante única com o ID no comentário.
- Dinheiro em centavos; celular em E.164 por `normalizeBrazilianPhone`; CNPJ guardado só com dígitos, e **vazio vira `null`**.
- Nunca logar e-mail, celular, CNPJ, código ou senha (regra 9). Auditoria guarda e-mail só em hash (`hashEmail`).
- Resposta de `/api/signup/code` é sempre `{ success: true }`, igual para e-mail novo, já cadastrado ou bloqueado por limite (RF02.R1).
- Tabela ou coluna nova: seguir `.claude/rules/tabela-nova.md` (FORCE RLS, GRANT/REVOKE à mão, `TABLES` e `insertsFor` em `packages/db/test/fixtures.ts`, contagem em `packages/db/src/schema.test.ts`, hoje "25 tabelas").
- Textos para o usuário em pt-BR; código e identificadores em inglês.
- **Não commitar sem pedido do Luís** (`CLAUDE.md`). Cada tarefa termina num ponto de verificação com mensagem de commit sugerida (Conventional Commits).

## Foco da revisão (o que o spec não diz e pode quebrar)

1. E-mail com maiúsculas, espaços nas pontas ou repetido com caixa diferente tem de cair no mesmo usuário (aviso de conta existente, nunca segunda conta). Teste na Tarefa 4.
2. CNPJ em branco no formulário (`""`) tem de gravar `null`; se gravar texto vazio, o segundo cadastro sem CNPJ viola a unicidade. Teste na Tarefa 1 e na 5.
3. O mesmo comprovante usado em duas requisições simultâneas cria uma conta só. Teste na Tarefa 5.
4. Comprovante de um e-mail apresentado com outro e-mail no corpo é recusado. Teste na Tarefa 5.
5. Verificar o código de um e-mail que já tem conta responde igual ao de um e-mail novo com código errado (mesmo erro, mesma contagem de tentativas), senão a tela revela quem tem conta. Teste na Tarefa 4.

---

## Tarefa 1: Regras do cadastro no `core`

**Arquivos:**
- Criar: `packages/core/src/signup/signup-rules.ts`, `signup-defaults.ts`, `signup-rules.test.ts`, `signup-defaults.test.ts`
- Alterar: `packages/core/src/index.ts` (exportar), `packages/core/src/registry/unit.ts` (só se `isValidCnpj` aceitar sequência repetida)

**Interfaces:**
- Produz:
  - `validateSignupInput(raw: unknown, mode: "new_user" | "existing_user"): Result<SignupInput, SignupFieldErrors>`. `SignupInput` traz `owner {name, phoneE164, password | null}`, `company {tradeName, legalName | null, cnpj | null, segment, taxRegime | null, revenueRange | null}`, `unit {name, city, uf, timezone}` e `terms {accepted: true}`. Em `existing_user` o campo `owner` só tem `phone` opcional (a Tarefa 6 decide se o usuário já tem celular).
  - `SignupFieldErrors = Partial<Record<fieldPath, ErrorCode>>`, com códigos estáveis (`cnpj_invalid`, `phone_invalid`, `password_weak`, `terms_required`, ...).
  - `timezoneForUf(uf): string` (RF01.R8; `America/Sao_Paulo` quando não houver mapeamento).
  - `SIGNUP_DEFAULTS` com `paymentMethods` e `salesChannels` (taxa zero; "Não informada" e "Não informado" mantidos; cartão padrão = Crédito; canal padrão da receita = Salão) e `defaultSalesChannelName`.
  - `TRIAL_DAYS = 14`, `LEGAL_VERSIONS = { terms, privacy, dpa }` e `SEGMENTS`, `REVENUE_RANGES` (RF01.R4 e R6, valores em inglês conforme as notas de mapeamento de `requisitos.md`).

- [ ] **Passo 1: testes que falham** em `signup-rules.test.ts`, com estes casos e valores:
  - `rejects cnpj 11.222.333/0001-00` → `cnpj_invalid` (CA01); `rejects 00.000.000/0000-00` (sequência repetida); `empty cnpj becomes null`; `accepts formatted cnpj and stores digits only`.
  - `normalizes 82 9658-5647 to +5582996585647` (CA09).
  - `rejects password 12345678` e `rejects password equal to email` (CA10); `accepts missing password`.
  - `requires accepted terms` (CA06).
  - `trims trade name and enforces 2..100`; `owner name allows apostrophe and hyphen, rejects digits`.
  - `existing_user mode ignores owner name and password`.
- [ ] **Passo 2:** rodar `pnpm --filter @app/core test signup` e ver falhar (módulo inexistente).
- [ ] **Passo 3:** implementar as funções acima reaproveitando `isValidCnpj`, `normalizeBrazilianPhone`, `validatePassword` e `normalizeEmail`. Se `isValidCnpj` aceitar sequência repetida, corrigir em `unit.ts` com teste no `unit.test.ts`.
- [ ] **Passo 4:** `signup-defaults.test.ts`: `payment methods have zero fees`, `exactly one default card (Crédito)`, `default sales channel exists in the list`, `names are unique`. Implementar `signup-defaults.ts` com o comentário `[PROVISÓRIO – P07]` e a nota de que "Não informada/Não informado" não estão em RF08.Obs2/RF09.Obs2 (conflito a levar ao Matheus).
- [ ] **Passo 5:** `pnpm --filter @app/core test` e `pnpm typecheck` verdes.

**Ponto de verificação:** `feat(core): regras de validação e padrões do autocadastro (RF01)`.

---

## Tarefa 2: Migration e papel `app_auth` (banco)

**Arquivos:**
- Alterar: `packages/db/schema/tenant-base.ts` (colunas novas de `tenants`), `packages/db/schema/auth.ts` (nova tabela `signup_verifications`, evento novos em `AUTH_EVENTS`), `packages/db/src/auth-store.ts` (o tipo `AuthEvent`), `packages/db/test/fixtures.ts`, `packages/db/src/schema.test.ts` (25 → 26 tabelas)
- Criar: migration `packages/db/migrations/0014_signup.sql` (nome pelo drizzle-kit, número conforme o próximo livre) e `packages/db/test/signup-migration.int.test.ts`

**Interfaces:**
- Produz:
  - `tenants`: `legal_name`, `cnpj`, `segment`, `revenue_range`, `status` (padrão `active`), `trial_started_at`, `trial_ends_at`, `terms_accepted_at`, `terms_version`, `privacy_version`, `dpa_version`, `terms_accepted_by` (FK `users.id`). `ACCOUNT_STATUSES` em `@app/core` (`active`, `read_only`, `canceled`, `closed`, conforme `requisitos.md`).
  - Índice único parcial `tenants_cnpj_open_unique` em `cnpj` onde `cnpj is not null and status <> 'closed'`; CHECK `cnpj ~ '^[0-9]{14}$'`.
  - `signup_verifications` (global, só `app_auth`): `id`, `email`, `kind` (`code` | `notice`), `code_hash` (nulo em `notice`), `attempts`, `ip`, `expires_at`, `receipt_hash`, `receipt_expires_at`, `consumed_at`, `created_at`; índice em `(email, created_at)` e em `(ip, created_at)`.
  - Eventos de auditoria `signup_code_sent`, `signup_verified`, `signup_completed`, `company_created` no CHECK de `auth_audit_event_check`.
  - Grants e políticas para `app_auth`: `INSERT` com `WITH CHECK (true)` em `tenants`, `users`, `units`, `memberships`, `membership_units`, `payment_methods`, `sales_channels` e `tax_settings`; `ALL` em `signup_verifications`; nada de SELECT novo. `REVOKE ALL ON signup_verifications FROM app, app_ingest`. `FORCE ROW LEVEL SECURITY` na tabela nova.

- [ ] **Passo 1: testes que falham** em `signup-migration.int.test.ts` (padrão de `auth-migration.int.test.ts`, conexão `db.urls.auth`):
  - `app_auth can insert tenant, unit, user, membership, channels, payment methods and tax_settings in one transaction`.
  - `app_auth cannot select from tenants, units, payment_methods, sales_channels` (permission denied).
  - `app and app_ingest cannot touch signup_verifications`.
  - `second tenant with same cnpj fails with 23505 on tenants_cnpj_open_unique`; `same cnpj allowed when the first tenant is closed`; `two tenants with null cnpj are allowed`.
  - `insert into units with default_sales_channel_id succeeds when channels are inserted first` (confirma que a checagem das chaves estrangeiras compostas passa sem SELECT para o papel).
  - `membership_units/units insert with RLS forced works without RETURNING`.
- [ ] **Passo 2:** editar o schema, rodar `pnpm db:generate -- --name signup` (ver `.claude/rules/tabela-nova.md`), **revisar o SQL** e acrescentar à mão `FORCE RLS`, `REVOKE` e `GRANT` no padrão da `0011_auth.sql`.
- [ ] **Passo 3:** atualizar `fixtures.ts` e `schema.test.ts`; `pnpm --filter @app/db test:int` verde, incluindo o meta-teste de isolamento.
- [ ] **Passo 4:** se o passo "tabela sem SELECT" falhar por causa das chaves compostas, registrar o erro no spec (seção Riscos) e dar `SELECT` mínimo só nas colunas de chave; não conceder leitura ampla.

**Ponto de verificação:** `feat(db): campos do autocadastro em tenants e INSERT do app_auth (RF01)`.

---

## Tarefa 3: Armazenamento de código e comprovante

**Arquivos:**
- Criar: `packages/db/src/signup-store.ts`, `packages/db/test/signup-store.int.test.ts`
- Alterar: `packages/db/src/index.ts` (exportar)

**Interfaces:**
- Consome: tabelas da Tarefa 2; `hashEmail` e `decideOtpSend`.
- Produz `createSignupStore(db, clock): SignupStore` com:
  - `reserveSend(input: {email; ip; kind: "code" | "notice"; codeHash: string | null; expiresAt: Date; decide: (byEmail: {sentAt: Date}[], byIp: {sentAt: Date}[]) => boolean}): Promise<boolean>`: lê o histórico de `signup_verifications` (e-mail e IP, última hora) sob `pg_advisory_xact_lock` do e-mail, chama `decide`, grava a linha se permitido.
  - `verifyCode(input: {email; codeHash: string; now: Date; makeReceipt: () => {receiptHash: string; expiresAt: Date}}): Promise<"ok" | "invalid" | "too_many_attempts">`: age sobre a linha mais recente do e-mail (qualquer `kind`); `notice` e linha vencida contam como `invalid` e incrementam tentativas; 3 erros viram `too_many_attempts`.
  - `consumeReceipt(input: {email: string; receiptHash: string; now: Date}): Promise<boolean>`: `UPDATE ... WHERE consumed_at IS NULL AND receipt_expires_at > now` e devolve se alterou uma linha.

- [ ] **Passo 1: testes que falham** (`signup-store.int.test.ts`, relógio injetado):
  - `reserveSend refuses a second send within 60 s and the 6th in an hour` e `refuses the 21st per ip`.
  - `verifyCode ok with the right code, invalid with wrong, too_many_attempts on the 4th try (CA03 inclui código vencido após 5 min)`.
  - `verifyCode on a notice row behaves like a wrong code and counts attempts`.
  - `consumeReceipt works once; second call false; false after 30 min; false for another email`.
  - `two concurrent consumeReceipt calls: exactly one returns true`.
- [ ] **Passo 2:** ver falhar, implementar com SQL e `UPDATE` com guarda no estado de origem, rodar e ver passar.

**Ponto de verificação:** `feat(db): armazenamento de código e comprovante do cadastro`.

---

## Tarefa 4: Rotas de código e verificação (API)

**Arquivos:**
- Alterar: `packages/core/src/ports/ports.ts` (`AccessCodePurpose` ganha `"account-exists"`), `apps/api/src/infra/email/file-email-sender.ts`, `memory-email-sender.ts` (e seus testes), `apps/api/src/composition.ts` (ligar o store e as rotas)
- Criar: `apps/api/src/modules/signup/request-signup-code.ts`, `verify-signup-code.ts`, `apps/api/src/http/signup/signup-routes.ts`, `signup-messages.ts`, `apps/api/test/signup-code.int.test.ts`

**Interfaces:**
- Consome: `SignupStore` (Tarefa 3), `EmailSender`, `BackgroundTasks`, `AuthStore.findUserByEmail`, relógio.
- Produz:
  - `POST /api/signup/code` com `{ email }` → sempre `200 { success: true }` (e-mail inválido → `400` de formato). Em segundo plano: e-mail sem usuário → `reserveSend(kind "code")` e `sendAccessCode({purpose: "email-verification"})`; e-mail com usuário (qualquer vínculo) → `reserveSend(kind "notice")` e `sendAccessCode({purpose: "account-exists"})`. O código é gerado com `crypto.randomInt` e guardado só com hash.
  - `POST /api/signup/verify` com `{ email, code }` → `200 { receipt }` ou `400 { code: "INVALID_CODE" }` / `429 { code: "TOO_MANY_ATTEMPTS" }`.
  - Mensagens em pt-BR em `signup-messages.ts`, no padrão de `auth-messages.ts`.

- [ ] **Passo 1: testes que falham** em `signup-code.int.test.ts` (padrão de `auth-login.int.test.ts`: `startTestDatabase`, `createMemoryEmailSender`, `buildApp`, relógio falso):
  - `new email receives a 6-digit code; response is {success:true}`.
  - `existing email gets an account-exists notice and the HTTP response is byte-identical to the new-email response` (CA da anti-enumeração).
  - `verify with the right code returns a receipt (CA02: sem recibo não há cadastro, coberto na Tarefa 5)`; `wrong code → INVALID_CODE`; `code after 5 min → INVALID_CODE (CA03)`; `4th attempt → TOO_MANY_ATTEMPTS`.
  - **Foco 5:** `verify for an existing email with any code returns INVALID_CODE and counts attempts exactly like a new email with a wrong code`, e `after 3 tries both return TOO_MANY_ATTEMPTS`.
  - **Foco 1:** `"  Ana@Exemplo.COM " and "ana@exemplo.com" are the same email` para envio, limites e usuário existente.
  - `second request within 60 s sends no second email but answers the same`; `6th request in an hour and 21st from one ip send nothing`.
  - `signup code is not accepted by /api/auth/sign-in/email-otp, and a login code is not accepted by /api/signup/verify`.
- [ ] **Passo 2:** ver falhar; implementar os casos de uso (um arquivo por rota em `modules/signup`) e as rotas; mensagens do e-mail de aviso: "Você já tem conta. Entre em `<PUBLIC_URL>/login`. Para abrir outra empresa, entre e use 'Criar outra empresa'. Se não conseguir entrar, fale com o suporte." (o link vem da configuração existente de URL pública; nunca do corpo da requisição).
- [ ] **Passo 3:** `pnpm --filter @app/api test:int` verde.

**Ponto de verificação:** `feat(api): código e verificação de e-mail do autocadastro (RF01.R10)`.

---

## Tarefa 5: Gravação da conta e abertura da sessão (API)

**Arquivos:**
- Criar: `packages/db/src/signup-repo.ts` (transação), `apps/api/src/modules/signup/create-account.ts`, `apps/api/test/signup-create.int.test.ts`
- Alterar: `apps/api/src/infra/auth/create-auth.ts` (`AuthGateway.openSession`), `apps/api/src/modules/auth/check-session.ts` (interface `AuthGateway`), `apps/api/src/http/signup/signup-routes.ts`, `composition.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Produz:
  - `createSignupRepo(db): SignupRepo` com `createAccount(input: NewAccount): Promise<Result<{tenantId: string; userId: string}, "cnpj_taken" | "phone_taken" | "email_taken">>`. `NewAccount` = `SignupInput` + `email`, `passwordHash | null`, `ids` (UUID v7 gerados fora), `now`, `legal` (versões), `ip`, `userAgent`. Uma transação, nesta ordem: `tenants`, `users` (e `accounts` com a senha, se houver), `sales_channels`, `payment_methods`, `units` (com `default_sales_channel_id`), `memberships` (`owner`, `all_units = true`, `panel_access = true`, `status active`, `default_unit_id`), `tax_settings` (só se regime ≠ `not_sure`; `enabled = false`, `valid_from` = data do cadastro em `America/Sao_Paulo`), evento `signup_completed` em `auth_audit`. Erro `23505` é mapeado pelo nome da restrição; qualquer outro erro desfaz tudo.
  - `AuthGateway.openSession(input: {userId: string; ip?: string; userAgent?: string}): Promise<string[]>` devolve os `Set-Cookie` (sem "manter conectado").
  - `POST /api/signup` com `{ receipt, email, ...SignupInput }`: consome o comprovante (`consumeReceipt`), valida, grava, abre a sessão e responde `201 { tenantId }` com os cookies. Erros: `400` com `SignupFieldErrors`; `409 { code: "CNPJ_TAKEN" }`; `409 { code: "PHONE_TAKEN" }` (texto manda falar com o suporte, sem citar conta, CA05); `409 { code: "SIGNUP_FAILED" }` para e-mail repetido (genérico).
- ⚠️ **Spike antes do código:** conferir na documentação atual do Better Auth (`internalAdapter.createSession` pelo `auth.$context` e `setSessionCookie`) como criar a sessão e o cookie fora de uma rota do Better Auth. Registrar o resultado no spec. Se não fechar em um passo, **plano B:** `openSession` não existe; a rota responde `201` sem cookie e o painel leva a `/login?email=...`.

- [ ] **Passo 1: testes que falham** em `signup-create.int.test.ts`:
  - **CA07:** `after signup the tenant, one unit, an owner membership with all_units, the default payment methods and channels exist; plan trial and status active; trial_ends_at is 14 days after`.
  - **CA02:** `without a receipt nothing is written (401/400)`.
  - **CA04:** `two simultaneous signups with the same cnpj create exactly one tenant; the other gets CNPJ_TAKEN` (padrão de `auth-login.int.test.ts:292`).
  - **CA05:** `phone already used → PHONE_TAKEN and nothing is written; the message does not mention the other account`.
  - **CA06:** `terms not accepted → 400 terms_required; accepted rows store accepted_at and the three versions`.
  - **CA08:** `failure injected after the unit insert leaves no tenant, user, unit or channel`.
  - **CA09:** `phone 82 9658-5647 is stored as +5582996585647`.
  - **CA10:** `no column in any table contains the plain password; password 12345678 and password equal to email are refused`.
  - **Foco 2:** `two signups without cnpj both succeed and store null`.
  - **Foco 3:** `same receipt in two parallel requests creates exactly one account`.
  - **Foco 4:** `receipt of email A with email B in the body is refused`.
  - `tax regime simples_nacional creates a disabled tax_settings row; regime not_sure creates none`.
  - `response carries a session cookie and GET /api/me with it returns the new owner` (ou, no plano B, `201` sem cookie).
- [ ] **Passo 2:** ver falhar; implementar repo, caso de uso e rota (hash de senha pelo mesmo mecanismo do login, gravando em `accounts` com `providerId: "credential"`); rodar e ver passar.

**Ponto de verificação:** `feat(api,db): gravação atômica do autocadastro e sessão ao concluir (RF01.Obs2)`.

---

## Tarefa 6: Criar outra empresa (usuário logado)

**Arquivos:**
- Criar: `apps/api/src/modules/signup/create-company.ts`, `apps/api/test/company-create.int.test.ts`
- Alterar: `packages/db/src/signup-repo.ts` (`createCompany`), `apps/api/src/http/signup/signup-routes.ts`

**Interfaces:**
- Consome: `validateSignupInput(raw, "existing_user")`, a leitura de sessão que as outras rotas protegidas usam (`check-session.ts`).
- Produz: `signupRepo.createCompany(input: NewCompany)` com a mesma transação da Tarefa 5, sem criar `users` nem `accounts`, que grava o vínculo `owner` com `preferred_at = now`, atualiza `users.phone_e164` quando o usuário não tem celular e o formulário trouxe um, e grava `company_created`. `POST /api/companies` exige sessão e devolve `201 { tenantId }`.

- [ ] **Passo 1: testes que falham:**
  - `without a session → 401 and nothing written`.
  - `with a session creates tenant, unit, defaults and an owner membership for the current user; no new user row`.
  - `user without phone (accountant) must send a phone; it is saved; without it → 400 phone_required`.
  - `new membership has preferred_at set and /api/me (ou a regra de empresa ativa do canal) picks the new company` (conferir como o `/api/me` escolhe a empresa hoje; se ele ignora `preferred_at`, registrar como pendência da F2 em vez de mudar o `/api/me`).
  - `same cnpj as another open tenant → CNPJ_TAKEN`; `a user with an inactive membership elsewhere can still create a company`.
- [ ] **Passo 2:** ver falhar, implementar, ver passar.

**Ponto de verificação:** `feat(api): criar outra empresa para usuário logado`.

---

## Tarefa 7: Seed de desenvolvimento usa os padrões do `core`

**Arquivos:**
- Alterar: `packages/db/src/dev-seed.ts:135-165`, `packages/db/src/dev-seed.int.test.ts` (nome real do teste do seed)

- [ ] **Passo 1:** manter o teste do seed como está (valores atuais: Débito 150, Crédito 320, iFood 2300) e rodar para ver passar antes de mexer.
- [ ] **Passo 2:** trocar a lista literal por `SIGNUP_DEFAULTS` mais uma tabela local `DEV_FEES` (`{ Débito: 150, Crédito: 320, iFood: 2300 }`) aplicada por cima, com o comentário de que as taxas valem só no desenvolvimento.
- [ ] **Passo 3:** `pnpm --filter @app/db test:int` verde; os ids do seed (`id(base + n)`) não mudam.

**Ponto de verificação:** `refactor(db): seed de desenvolvimento usa os padrões de conta nova`.

---

## Tarefa 8: Telas do cadastro (web)

**Arquivos:**
- Criar: `apps/web/app/(public)/cadastro/page.tsx`, `apps/web/app/(app)/bem-vindo/page.tsx` e `apps/web/app/(app)/nova-empresa/page.tsx` (ou a pasta de rotas autenticadas que a F1a usou), `apps/web/app/(public)/termos/page.tsx`, `privacidade/page.tsx`, `apps/web/features/signup/{signup-api.ts, signup-flow.tsx, company-form.tsx, welcome.tsx}` com testes `*.test.tsx`
- Alterar: `apps/web/features/auth/login-form.tsx` (link "Criar conta"), a casca autenticada (item "Criar outra empresa"), `apps/web/proxy.ts` (liberar `/cadastro`, `/termos`, `/privacidade`), schema de variáveis públicas do web (`NEXT_PUBLIC_WHATSAPP_NUMBER`), `apps/web/CLAUDE.md` (só se surgir regra nova)

**Interfaces:**
- Consome: `lib/api` (`ApiError`), as rotas das Tarefas 4 a 6.
- Produz: `signup-api.ts` com `requestCode(email)`, `verifyCode(email, code): Promise<{receipt}>`, `submitSignup(payload)`, `submitCompany(payload)`; `buildWhatsappLink(number: string): string` (`https://wa.me/<dígitos>`).

- [ ] **Passo 1: testes de componente que falham** (Testing Library, no padrão de `login-form.test.tsx`):
  - `step 1 shows the same message for any email after sending the code`.
  - `wrong code shows "código incorreto"; 3 failures show the blocked message with the resend countdown`.
  - `step 2 only appears after a valid code; unit name is prefilled with the trade name (R7)`.
  - `invalid cnpj highlights the field and keeps all other values (CA01)`.
  - `terms checkbox starts unchecked and blocks submit (CA06)`.
  - `CNPJ_TAKEN and PHONE_TAKEN show their messages; PHONE_TAKEN points to support without naming an account`.
  - `welcome shows the wa.me link built from the env number, a QR code and a "Ir para o painel" button`.
  - `company form for logged user has no email/password fields and asks for phone only when the session user has none`.
- [ ] **Passo 2:** implementar. Formulário com `useState` como o `login-form.tsx` (decisão do builder; mudar para react-hook-form só se o formulário ficar difícil). QR Code gerado no navegador com uma biblioteca pequena, versão fixa (escolha do builder, registrar no PR). Páginas de termos e privacidade com a faixa "Texto provisório (rascunho)". Celular primeiro: campos empilhados, alvo de toque confortável (RNF09).
- [ ] **Passo 3:** `pnpm --filter @app/web test` e `pnpm typecheck && pnpm lint` verdes.

**Ponto de verificação:** `feat(web): telas de cadastro, boas-vindas e nova empresa (RF01)`.

---

## Tarefa 9: E2E do cadastro

**Arquivos:**
- Alterar: `apps/web/e2e/fake-api.mjs` (rotas `/api/signup/code`, `/api/signup/verify`, `/api/signup`, `/api/companies`, código fixo `123456`), `apps/web/e2e/login.spec.ts` (só se o link novo afetar)
- Criar: `apps/web/e2e/signup.spec.ts`

- [ ] **Passo 1:** escrever `signup.spec.ts` (projetos desktop e Pixel 7): `owner signs up with email code, fills the form and lands on /bem-vindo with the wa.me link`, `wrong code shows the error and keeps the step`, `invalid CNPJ keeps typed data`, `logged user opens "Criar outra empresa" and finishes on /bem-vindo`.
- [ ] **Passo 2:** estender a API falsa e rodar `pnpm --filter @app/web e2e` (ver falhar, depois passar).

**Ponto de verificação:** `test(web): E2E do autocadastro`.

---

## Tarefa 10: Documentação e fechamento da etapa

**Arquivos:**
- Alterar: `docs/decisoes.md` (nova DD: cadastro com `app_auth` só com INSERT; aviso em vez de código para e-mail existente; "Criar outra empresa"; regime em `tax_settings`; indicação para a F10; use o próximo número livre depois da DD-21), `docs/requisitos.md` (subir de 1.3 para 1.4; nota em RF01.Obs4; nota de "Não informada/Não informado" em RF08.Obs2 e RF09.Obs2, P07), `docs/arquitetura.md` (divergências de `tenants` e tabela `signup_verifications`), `docs/planos/painel.md` (tabela: F1b "Feita"; "Atualizado em"; F10 recebe o código de indicação RF01.R14), `docs/planos/andamento.md` (pendências: consulta pública de CNPJ sem etapa; `trustProxy` para o limite por IP; limpeza de linhas vencidas de `signup_verifications`; texto final dos termos; conflito P07), `CLAUDE.md` (Estado atual), `.env.example` (variável do número do WhatsApp)

- [ ] **Passo 1:** rodar `pnpm typecheck && pnpm lint && pnpm test`, `pnpm test:int` em `db` e `api`, e o E2E. Colar o resultado na conversa.
- [ ] **Passo 2:** fluxo à mão (o Luís roda): `pnpm dev`, abrir `http://localhost:3000/cadastro`, ler o código na pasta `DEV_MAIL_DIR`, concluir e entrar no painel. Não ler nem editar o `.env` (memória do projeto); entregar os comandos para o Luís.
- [ ] **Passo 3:** atualizar os documentos acima, seguindo "Fechamento de etapa" de `painel.md`: propor (sem criar) regra, skill ou hook para o que repetiu na etapa e esperar aprovação.
- [ ] **Passo 4:** sugerir a mensagem de commit final; não commitar sem pedido.

---

## Revisão do plano contra o spec

- Cobertura: fluxo e-mail primeiro (T4, T5, T8), gravação atômica e CA02 a CA10 (T1, T2, T5), WhatsApp e `/bem-vindo` (T8), campos opcionais e regime (T1, T5), aviso de conta existente (T4), criar outra empresa (T6, T8), documentos (T10). Fora de escopo respeitado: indicação (F10), consulta de CNPJ, assistente inicial.
- Risco com plano B declarado: abertura de sessão (T5). Risco de RLS com chaves compostas tratado no Passo 1 da T2.
- Nomes usados em várias tarefas: `SignupInput`, `SignupFieldErrors`, `SIGNUP_DEFAULTS`, `SignupStore`, `SignupRepo`, `openSession`, `createAccount`, `createCompany`, `consumeReceipt`.
