# F1a: login por código e senha (Better Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um usuário já cadastrado entra no painel por código de e-mail ou por senha, a API recusa chamada sem sessão e o `apps/web` redireciona quem não tem cookie.

**Architecture:** Better Auth roda dentro da API Fastify (`/api/auth/*`) sobre a nossa tabela `users`, com um papel de banco próprio (`app_auth`) que acessa as tabelas de autenticação sem `app.tenant_id`. Regras de bloqueio e de limite de envio são funções puras no `packages/core` (relógio injetado). O e-mail sai pela porta `EmailSender` com implementação de desenvolvimento. O web lê a sessão num único módulo (`lib/auth/session.ts`) e tem `proxy.ts` mais a tela de acesso.

**Tech Stack:** Better Auth (`better-auth`, plugin `emailOTP`), Fastify 5, Drizzle + drizzle-kit, Postgres 16 (Testcontainers), Next.js (App Router), Vitest, Playwright, Zod.

**Spec:** `docs/superpowers/specs/2026-11-07-f1-autenticacao-design.md` (esta é a parte **F1a**; F1b e F1c têm plano próprio depois). Requisitos: RF02.R1 a R8, RF02.CA01 a CA04, CA07, CA08, RNF01, RNF04.R4 em `docs/requisitos.md`.

## Global Constraints

- Código de acesso: 6 dígitos, vale 5 minutos, 3 tentativas, reenvio após 60 s, no máximo 5 envios por hora por e-mail e 20 por hora por IP; pedir código novo invalida o anterior (RF02.R4).
- Senha: 8 a 64 caracteres, letras e números, diferente do e-mail, só como hash forte com sal. 5 erros seguidos bloqueiam **o acesso por senha** por 15 minutos; o acesso por código continua (RF02.R7).
- Sessão: cookie `httpOnly`, `secure`, `sameSite=lax`; 12 h de inatividade, ou 30 dias renovando a cada uso com "manter conectado" (RF02.R5).
- Só entra quem existe **e** tem pelo menos um vínculo ativo; e-mail desconhecido ou sem vínculo ativo recebe a mesma resposta e **nenhum e-mail é enviado** (RF02.R1, CA02).
- A tela de acesso abre no modo CODIGO e oferece "Entrar com senha" (RF02.R2).
- `plugin emailOTP` com `disableSignUp: true`: o login nunca cria usuário.
- IDs UUID v7 (`uuidv7()` de `@app/db`). Dinheiro não aparece nesta etapa.
- Nunca logar e-mail, código, senha, IP ou celular; auditoria guarda e-mail só como hash SHA-256 do e-mail em minúsculas (CLAUDE.md, regra 9).
- Textos para o usuário em português do Brasil; código e identificadores em inglês.
- Toda regra nova em `packages/core` vem com teste, sem mocks. Tabela nova segue o padrão de RLS e entra no meta-teste de isolamento (CLAUDE.md, regra 2).
- Migration gerada pelo drizzle-kit e **revisada**; a parte que o drizzle-kit não gera (FORCE RLS, GRANT) vai no mesmo arquivo, no padrão da `0010_tax_estimate.sql`.
- Verificação antes de concluir: `pnpm typecheck && pnpm lint && pnpm test`, mais `pnpm test:int` nos pacotes tocados. Não commitar sem pedido; cada tarefa termina com a **mensagem de commit sugerida**.

Fatos do Better Auth conferidos na documentação em 07/11/2026 (`better-auth.com/docs`): `emailOTP({ sendVerificationOTP({ email, otp, type }), otpLength (6), expiresIn (300 s), allowedAttempts (3), disableSignUp })`, `type` é `"sign-in" | "email-verification" | "forget-password"`; endpoints `POST /email-otp/send-verification-otp` e `POST /sign-in/email-otp`; `user.modelName`, `user.fields` e `user.additionalFields` mapeiam a tabela existente; `advanced.database.generateId` aceita função; integração com Fastify é um `route` curinga `/api/auth/*` que converte para `Request` e chama `auth.handler`. O que a documentação **não** fecha (adaptador Drizzle, rate limit de envio, hooks de login) é a pauta da Task 1.

## Review Focus

Entradas que o requisito implica e nenhuma tarefa exercitaria sozinha; cada linha tem o teste na tarefa dona:

1. E-mail com maiúsculas ou espaços nas pontas é a mesma conta e a mesma resposta (Task 6).
2. Usuário com vínculo desativado pede código: mesma resposta, sem e-mail, e sessão antiga cai na próxima requisição (Task 6, RF02.CA07).
3. Código reaproveitado depois do sucesso, ou digitado em duas requisições simultâneas, vale uma vez só (Task 6).
4. Cookie adulterado ou expirado, corpo vazio ou JSON malformado: 401 ou 400, nunca 500 (Task 6).
5. Senha de 65 caracteres, igual ao e-mail ou escolhida por quem nunca definiu senha: recusada com mensagem que não revela se o e-mail existe (Task 6).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `docs/superpowers/specs/2026-11-07-f1a-prova-de-conceito.md` | Achados da prova de conceito (único artefato que sai do spike) |
| `docker/postgres/init.sql`, `.env.example`, `packages/config/src/env.ts` | Papel `app_auth` e `DATABASE_AUTH_URL`, `AUTH_SECRET`, `DEV_MAIL_DIR` |
| `packages/db/schema/auth.ts` | `sessions`, `accounts`, `verifications`, `auth_audit` |
| `packages/db/schema/tenants.ts` | `users`: `phone_e164` opcional e colunas de acesso |
| `packages/db/migrations/0011_auth.sql` | Migration gerada e revisada |
| `packages/db/src/auth-store.ts` | Consultas de acesso do papel `app_auth` (vínculo ativo, auditoria, contagem de envios) |
| `packages/core/src/auth-policy.ts` | Funções puras: bloqueio de senha, limite de envio, regras de senha |
| `packages/core/src/ports.ts` (ou o arquivo de portas existente) | Porta `EmailSender` |
| `apps/api/src/infra/auth/create-auth.ts` | Fábrica do Better Auth |
| `apps/api/src/infra/email/*.ts` | `createMemoryEmailSender` e `createFileEmailSender` |
| `apps/api/src/http/auth/*.ts` | Rotas `/api/auth/*`, `/api/me` e o preHandler `requireSession` |
| `apps/web/lib/auth/session.ts`, `apps/web/proxy.ts` | Leitura única da sessão e redirecionamento |
| `apps/web/features/auth/*`, `apps/web/app/(public)/login/page.tsx` | Tela de acesso |

---

### Task 1: Prova de conceito descartável

Spike sem testes e sem plano de qualidade. **Branch `spike/f1a-better-auth`; o código não volta para a `main`.** Só a nota de achados volta.

**Files:**
- Create (na branch do spike): qualquer arquivo necessário em `apps/api/src/spike/`
- Create (volta para a main): `docs/superpowers/specs/2026-11-07-f1a-prova-de-conceito.md`

**Interfaces:**
- Produces: a nota de achados, que as Tasks 3 e 6 citam. Cada pergunta abaixo recebe **resposta, versão do pacote e trecho mínimo de configuração que funcionou**.

- [ ] **Step 1: Criar a branch e instalar `better-auth`** (a única dependência nova da F1a; confirmar a versão estável atual no npm e registrar na nota).

Run: `git switch -c spike/f1a-better-auth && pnpm --filter @app/api add better-auth`

- [ ] **Step 2: Responder, com código que roda contra o Postgres do Compose, às perguntas:**
  1. O `drizzleAdapter` do Better Auth funciona sobre a tabela `users` existente com `user.modelName: "users"`, campos em `snake_case` e `advanced.database.generateId: () => uuidv7()`? Quais `user.fields` e `additionalFields` foram necessários?
  2. Quais colunas o Better Auth exige em `sessions`, `accounts` e `verifications` (gerar com `npx auth@latest generate` e anotar a lista)?
  3. Com uma conexão `app_auth` (papel criado à mão no spike) sem `app.tenant_id`, quais políticas e GRANTs bastam em `users` e nas três tabelas para o login funcionar? O RLS atual de `users` (FORCE) bloqueia o quê?
  4. O cookie de sessão sai com os atributos de RF02.R5 atrás do `rewrites` do Next (`http://localhost:3000/api/auth/...` → API)? Qual `baseURL` e `trustedOrigins` funcionaram?
  5. Como impor "só entra quem tem vínculo ativo" e "e-mail desconhecido recebe a mesma resposta e não envia e-mail" com `emailOTP` + `disableSignUp`? (o `sendVerificationOTP` pode consultar `memberships` e simplesmente não enviar; confirmar o que a API devolve ao cliente nos dois casos.)
  6. Dá para expressar 60 s entre envios, 5 por hora por e-mail e 20 por hora por IP com `rateLimit`/`customRules` do Better Auth? Senão, qual gancho (`hooks.before`) permite uma checagem própria?
  7. Dá para contar 5 erros de senha e bloquear 15 min por um gancho `hooks.after`/`before` em `/sign-in/email`, sem bloquear `/sign-in/email-otp`?
  8. Como configurar sessão de 12 h de inatividade e 30 dias com "manter conectado" (`session.expiresIn`, `updateAge`, `rememberMe`)?
  9. `emailAndPassword` aceita `minPasswordLength: 8` e `maxPasswordLength: 64` e qual algoritmo de hash usa por padrão (scrypt)? Basta para "hash forte com sal"?

- [ ] **Step 3: Escrever a nota** `docs/superpowers/specs/2026-11-07-f1a-prova-de-conceito.md` com as nove respostas e a decisão final: **caminho A confirmado** ou **cair para o B** (se cair, parar e voltar ao Luís: o desenho muda).

- [ ] **Step 4: Voltar à `main` levando só a nota**

Run: `git switch main && git checkout spike/f1a-better-auth -- docs/superpowers/specs/2026-11-07-f1a-prova-de-conceito.md`
Expected: a nota existe na `main`; `git status` não mostra arquivos do spike. Mensagem sugerida: `docs: achados da prova de conceito do Better Auth (F1a)`.

---

### Task 2: Papel `app_auth` e configuração

**Files:**
- Modify: `docker/postgres/init.sql`, `.env.example`, `packages/config/src/env.ts`, `packages/config/src/env.test.ts`, `packages/db/test/database.ts`
- Test: `packages/config/src/env.test.ts`, `packages/db/test/isolation.int.test.ts` (teste dos papéis, linhas 154 a 175)

**Interfaces:**
- Produces: `env.DATABASE_AUTH_URL: string | undefined` (obrigatória em produção), `env.AUTH_SECRET` (já existe, opcional; passa a ser exigida pelo `createAuth`), `env.DEV_MAIL_DIR: string` (padrão `.dev-mail`); `TestDatabase.auth: pg.Pool` e `TestDatabase.urls.auth: string` em `packages/db/test/database.ts`.

- [ ] **Step 1: Escrever os testes que falham**
  - `env.test.ts`: `DATABASE_AUTH_URL` ausente em `NODE_ENV=production` gera issue "obrigatória em produção"; `DEV_MAIL_DIR` vazio vira `.dev-mail`.
  - `isolation.int.test.ts`: o teste "os papéis da aplicação não têm BYPASSRLS nem superusuário" passa a listar `('app', 'app_ingest', 'app_auth')` e espera `["app", "app_auth", "app_ingest"]`; o teste de donos de tabela inclui `app_auth`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/config test` e `pnpm --filter @app/db test:int -- isolation`
Expected: FAIL (variável desconhecida; papel `app_auth` inexistente).

- [ ] **Step 3: Implementar**
  - `init.sql`: criar o papel `app_auth` no mesmo estilo idempotente (`LOGIN PASSWORD 'app_auth' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`), incluir em `GRANT CONNECT` e `GRANT USAGE ON SCHEMA public`. **Sem** `ALTER DEFAULT PRIVILEGES` para ele (permissões mínimas, concedidas na migration).
  - `env.ts`: `DATABASE_AUTH_URL: optionalString`, `DEV_MAIL_DIR`, e `DATABASE_AUTH_URL` na lista `requiredInProduction`.
  - `.env.example`: `DATABASE_AUTH_URL=postgres://app_auth:app_auth@localhost:5434/app` e `DEV_MAIL_DIR=.dev-mail`; gerar `AUTH_SECRET` fica documentado ali (`openssl rand -base64 32`).
  - `database.ts`: criar o pool `auth` com `urlFor("app_auth", "app_auth")`, expô-lo e fechá-lo em `stop()`.

- [ ] **Step 4: Rodar e ver passar** (mesmos comandos). Expected: PASS. Mensagem sugerida: `feat(db,config): papel app_auth e variáveis de autenticação`.

---

### Task 3: Schema e migration de autenticação

**Files:**
- Create: `packages/db/schema/auth.ts`, `packages/db/migrations/0011_auth.sql` (e o snapshot do drizzle-kit), `packages/db/test/auth-migration.int.test.ts`
- Modify: `packages/db/schema/tenants.ts` (`users`), `packages/db/schema/index.ts`, `packages/db/test/fixtures.ts` (`TABLES`, `GLOBAL_TABLES`/nova lista, `insertsFor`, o insert de `users`), `packages/db/test/isolation.int.test.ts`, `packages/db/test/integrity.int.test.ts`

**Interfaces:**
- Consumes: a nota de achados da Task 1 (colunas exigidas pelo Better Auth e o mapeamento final).
- Produces:
  - `users` ganha `phoneE164: text` **opcional** (continua `unique`), `emailVerified: boolean` (padrão `false`), `lastLoginAt`, `failedPasswordAttempts: integer` (padrão 0), `passwordLockedUntil: timestamptz` nulo.
  - Tabelas globais `sessions`, `accounts`, `verifications` (colunas conforme a nota) e `auth_audit` (`id`, `userId` nulo, `emailHash` text nulo, `event` text, `ip` text nulo, `userAgent` text nulo, `createdAt`), com `event in ('otp_sent','login','login_failed','password_locked','logout')`.
  - Papel `app_auth`: `SELECT, INSERT, UPDATE` em `users`; `SELECT, INSERT, UPDATE, DELETE` em `sessions`, `accounts`, `verifications`; `SELECT, INSERT` em `auth_audit` e `SELECT` em `memberships`; políticas `to app_auth using (true)` em cada uma. O papel `app` **não** recebe acesso a `sessions`, `accounts`, `verifications` nem `auth_audit` (`REVOKE ALL ... FROM app` depois da migration, pois o `ALTER DEFAULT PRIVILEGES` do `init.sql` concede por padrão).
  - Uma lista nova `AUTH_TABLES = ["sessions","accounts","verifications","auth_audit"]` em `fixtures.ts`.

- [ ] **Step 1: Escrever os testes que falham** em `auth-migration.int.test.ts` (usa `startTestDatabase()`):
  - `"users aceita phone_e164 nulo e mantém unicidade quando existe"`: dois inserts com `phone_e164` nulo passam; dois com o mesmo número falham com `23505`.
  - `"app_auth lê e grava users sem app.tenant_id"` e `"app_auth lê memberships sem tenant"`.
  - `"app não enxerga nem grava sessions, accounts, verifications e auth_audit"`: `attempt()` com o pool `app` devolve `{ error: "42501" }` (privilégio) para `select`.
  - `"app_auth não apaga auth_audit nem altera/apaga linhas dele"` (histórico só de acréscimo: `update`/`delete` falham).
  - `"event fora da lista é recusado em auth_audit"` (`23514`).
  - Nos meta-testes: `TABLES` inclui as quatro tabelas novas; o teste "a matriz cobre exatamente as tabelas do banco" (linha 41) e o de migrations (integrity, linha 313) passam; `AUTH_TABLES` é excluída das verificações por tenant (como `GLOBAL_TABLES`) e tem teste próprio de "só `app_auth` acessa".

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/db test:int`
Expected: FAIL (tabelas inexistentes).

- [ ] **Step 3: Implementar o schema em `schema/auth.ts` e editar `users`.** Usar `primaryId()`, `createdAt()` e `oneOf()` de `_shared`; declarar `pgRole("app_auth").existing()` em `_shared.ts` como `authRole` e as políticas com `pgPolicy(..., { to: authRole, using: sql\`true\` })`. Chaves estrangeiras de `sessions.userId` e `accounts.userId` para `users.id`. Nomes e tipos de coluna exatamente como a nota da Task 1 listou.

- [ ] **Step 4: Gerar e revisar a migration**

Run: `pnpm db:generate` (com `DATABASE_ADMIN_URL` definida)
Expected: `0011_*.sql` criada. Renomear para `0011_auth` (ajustando o `_journal.json` e o snapshot como nas migrations anteriores), conferir que há `ENABLE ROW LEVEL SECURITY` nas quatro tabelas e **acrescentar à mão**, no padrão da `0010`: `FORCE ROW LEVEL SECURITY` nas quatro, os `GRANT` ao `app_auth` descritos acima, `REVOKE ALL ... FROM app` nas três tabelas de auth e em `auth_audit`, e `REVOKE UPDATE, DELETE ON auth_audit FROM app_auth`. Atualizar `fixtures.ts` (`TABLES` em ordem alfabética, `insertsFor`).

- [ ] **Step 5: Rodar tudo do banco**

Run: `pnpm --filter @app/db typecheck && pnpm --filter @app/db test && pnpm --filter @app/db test:int`
Expected: PASS (inclui "migrations aplicam em banco vazio e podem ser reaplicadas"). Mensagem sugerida: `feat(db): tabelas de autenticação, papel app_auth e phone_e164 opcional`.

---

### Task 4: Regras de acesso puras no `core`

**Files:**
- Create: `packages/core/src/auth-policy.ts`, `packages/core/src/auth-policy.test.ts`
- Modify: `packages/core/src/index.ts` (exportar)

**Interfaces:**
- Produces (todas puras, com `now: Date` injetado):
  - `validatePassword(input: { password: string; email: string }): Result<void, PasswordError>`; `PasswordError` é `"too_short" | "too_long" | "needs_letter_and_digit" | "same_as_email"` (8 a 64, ≥1 letra, ≥1 dígito, `password.toLowerCase() !== email.toLowerCase()`).
  - `decidePasswordAttempt(state: { failedAttempts: number; lockedUntil: Date | null }, outcome: "ok" | "wrong", now: Date): { allowed: boolean; next: { failedAttempts: number; lockedUntil: Date | null } }` com `PASSWORD_MAX_FAILURES = 5` e `PASSWORD_LOCK_MINUTES = 15`. Bloqueado ⇒ `allowed: false` mesmo com senha certa; senha certa zera o contador; o 5º erro grava `lockedUntil = now + 15 min`; passado o prazo o bloqueio some.
  - `decideOtpSend(history: { sentAt: Date }[], byIp: { sentAt: Date }[], now: Date): { allowed: true } | { allowed: false; reason: "too_soon" | "email_hourly" | "ip_hourly"; retryAfterSeconds: number }` com `OTP_RESEND_SECONDS = 60`, `OTP_PER_EMAIL_PER_HOUR = 5`, `OTP_PER_IP_PER_HOUR = 20`.
  - `normalizeEmail(raw: string): string` (trim + minúsculas) e `hashEmail(normalized: string): string` fica no `db`/api (usa `node:crypto`; o `core` não importa infra).
- Consumes: o tipo `Result`/`fail` já existente no `core`.

- [ ] **Step 1: Escrever os testes que falham** (nomes e asserções):
  - `"senha de 7 caracteres: too_short"`, `"senha de 65: too_long"`, `"'12345678': needs_letter_and_digit"`, `"'abc12345' igual ao e-mail 'ABC12345' ignorando caixa: same_as_email"` (usar e-mail `abc12345`), `"senha de 64 com letra e dígito: ok"`.
  - `"4 erros seguidos não bloqueiam; o 5º bloqueia por 15 min"` (`lockedUntil` igual a `now + 15*60*1000`), `"bloqueado: senha certa continua negada"`, `"passados 15 min e 1 ms: libera e zera contador"`, `"senha certa zera o contador"`.
  - `"primeiro envio: allowed"`, `"reenvio 59 s depois: too_soon com retryAfterSeconds 1"`, `"60 s depois: allowed"`, `"6º envio na mesma hora para o e-mail: email_hourly"`, `"21º envio do IP: ip_hourly"`, `"envios de mais de 1 h atrás não contam"`.
  - `"normalizeEmail('  Dono@Ex.com ') === 'dono@ex.com'"`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/core test -- auth-policy`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** as quatro funções e constantes com as assinaturas acima; constantes exportadas e únicas (nada de números soltos).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `pnpm --filter @app/core typecheck`. Expected: PASS. Mensagem sugerida: `feat(core): regras de senha, bloqueio e limite de envio de código`.

---

### Task 5: Porta `EmailSender` e adaptadores de desenvolvimento

**Files:**
- Create: `apps/api/src/infra/email/memory-email-sender.ts`, `apps/api/src/infra/email/file-email-sender.ts`, `apps/api/src/infra/email/email-sender.test.ts`
- Modify: `packages/core/src/ports.ts` (ou o arquivo onde `MessageSender` está declarado; achar com Grep por `interface MessageSender`), `.gitignore` (`.dev-mail/`)

**Interfaces:**
- Produces:
  - `interface EmailSender { sendAccessCode(message: { to: string; code: string; purpose: "sign-in" | "email-verification" | "forget-password" }): Promise<void> }` no `core`.
  - `createMemoryEmailSender(): EmailSender & { sent: ReadonlyArray<{ to: string; code: string; purpose: string }> }` (testes).
  - `createFileEmailSender(dir: string): EmailSender` grava um JSON por e-mail em `dir` (desenvolvimento; é como o dev lê o código). **Nunca escreve no logger.** Recusa subir com `NODE_ENV=production` (na composição, Task 6).

- [ ] **Step 1: Escrever os testes que falham** em `email-sender.test.ts`: `"memory: registra o envio em sent"`; `"file: cria um arquivo .json na pasta com to, code e purpose"` (usar `mkdtemp`); `"file: cria a pasta se não existir"`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- email-sender`
Expected: FAIL.

- [ ] **Step 3: Implementar** a porta e os dois adaptadores (nome do arquivo: `${Date.now()}-${uuidv7()}.json`).

- [ ] **Step 4: Rodar e ver passar**; `pnpm --filter @app/api typecheck && pnpm lint`. Expected: PASS. Mensagem sugerida: `feat(api): porta EmailSender com adaptadores de desenvolvimento`.

---

### Task 6: Better Auth na API (login, sessão, `requireSession`)

**Files:**
- Create: `apps/api/src/infra/auth/create-auth.ts`, `apps/api/src/http/auth/auth-routes.ts`, `apps/api/src/http/auth/require-session.ts`, `packages/db/src/auth-store.ts`, `apps/api/test/auth-login.int.test.ts`
- Modify: `apps/api/src/app.ts` (aceitar `deps.auth`), `apps/api/src/composition.ts` (criar pool `app_auth`, EmailSender, Better Auth), `packages/db/src/index.ts`, `packages/db/src/dev-seed.ts` (usuários de exemplo com e-mail, vínculo ativo e uma senha conhecida só de desenvolvimento), `apps/api/src/architecture.test.ts` se a regra de camadas pedir

**Interfaces:**
- Consumes: `decidePasswordAttempt`, `decideOtpSend`, `validatePassword`, `normalizeEmail` (Task 4); `EmailSender` (Task 5); tabelas e pool `app_auth` (Tasks 2 e 3); nota da Task 1.
- Produces:
  - `createAuthStore(db: Database): AuthStore` com `hasActiveMembership(userId: string): Promise<boolean>`, `findUserByEmail(email: string): Promise<{ id: string; passwordLockedUntil: Date | null; failedPasswordAttempts: number } | null>`, `recordAudit(event: { event: AuthEvent; userId?: string; emailHash?: string; ip?: string; userAgent?: string }): Promise<void>`, `recentOtpSends(emailHash: string, ip: string | undefined, since: Date): Promise<{ byEmail: { sentAt: Date }[]; byIp: { sentAt: Date }[] }>`, `updatePasswordState(userId: string, state: { failedAttempts: number; lockedUntil: Date | null }): Promise<void>`.
  - `createAuth(deps: { pool: pg.Pool; store: AuthStore; email: EmailSender; clock: Clock; secret: string; baseUrl: string; trustedOrigins: string[] })` devolve o objeto `auth` do Better Auth.
  - `authRoutes: FastifyPluginAsync<{ auth: Auth }>` registra `/api/auth/*` (GET e POST).
  - `requireSession(auth: Auth, store: AuthStore)`: preHandler que devolve **401** sem sessão válida **ou** quando `hasActiveMembership` é falso (RF02.CA07), e põe `request.session = { userId }`.
  - Rota `GET /api/me` → `{ userId, name, email }` (sem celular).
  - `AppDeps.auth?: { auth: Auth; store: AuthStore }`.

- [ ] **Step 1: Escrever os testes de integração que falham** em `auth-login.int.test.ts` (Testcontainers; relógio `createFixedClock`; `createMemoryEmailSender`; app montado com `buildApp` e `app.inject`). Um cadastro de apoio cria tenant + usuário dono com e-mail verificado e vínculo ativo via `createTenant` ajustado ou SQL admin. Casos:
  - `"código: pede, recebe 6 dígitos e entra; cookie com httpOnly, SameSite=Lax"` (RF02.CA01); `GET /api/me` com o cookie devolve 200.
  - `"e-mail desconhecido: mesma resposta (status e corpo) que um conhecido e nenhum e-mail enviado"` (RF02.CA02).
  - `"e-mail com maiúsculas e espaços é a mesma conta"` (Review Focus 1).
  - `"vínculo desativado: pedir código dá a mesma resposta, sem e-mail"` e `"sessão aberta antes da desativação recebe 401 na próxima chamada"` (RF02.CA07, Review Focus 2).
  - `"código errado 3 vezes: a 4ª tentativa é recusada mesmo com o código certo"` (RF02.CA03).
  - `"código usado uma vez não entra de novo; duas verificações simultâneas, só uma passa"` (Review Focus 3).
  - `"código expira em 5 min"` (avançar o relógio 5 min e 1 s); `"pedir novo código invalida o anterior"`.
  - `"reenvio em menos de 60 s é recusado; 6º envio na hora é recusado; 21º do mesmo IP é recusado"`.
  - `"senha: entra com a senha correta; 'Entrar com senha' de quem não tem senha recebe a mesma mensagem genérica de senha incorreta"` (Review Focus 5).
  - `"5 senhas erradas: a 6ª é negada, mesmo certa, por 15 min; o código continua funcionando"` (RF02.CA04).
  - `"senha de 65 caracteres e senha igual ao e-mail: recusadas ao definir"`.
  - `"sem cookie: GET /api/me é 401; cookie adulterado é 401; corpo vazio e JSON malformado em /api/auth/*: 4xx, nunca 500"` (RF02.CA08, Review Focus 4).
  - `"logout encerra a sessão: /api/me volta a 401"`.
  - `"auditoria: login, login_failed, otp_sent e password_locked gravam em auth_audit sem e-mail em texto puro"` (consulta com o pool admin).
  - `"logs do app não contêm o e-mail, o código nem a senha"` (usa `logStream` do `buildApp`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api test:int -- auth-login`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `createAuthStore`** em `packages/db/src/auth-store.ts` com as assinaturas acima (Drizzle sobre o pool `app_auth`; `hasActiveMembership` = existe `memberships` do usuário com `status = 'active'`, `deactivated_at is null`, `panel_access = true` ou papel `owner`/`manager`/`accountant`). Exportar em `index.ts`.

- [ ] **Step 4: Implementar `createAuth`** com a configuração que a nota da Task 1 provou: `drizzleAdapter` sobre `users`/`sessions`/`accounts`/`verifications`, `advanced.database.generateId: () => uuidv7()`, `emailAndPassword` com `minPasswordLength: 8`, `maxPasswordLength: 64` e `disableSignUp: true`, plugin `emailOTP({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, disableSignUp: true, sendVerificationOTP })`. O `sendVerificationOTP` **não é aguardado** pelo Better Auth (doc), então: normaliza o e-mail, consulta `findUserByEmail` + `hasActiveMembership`, aplica `decideOtpSend` com `recentOtpSends`, grava `otp_sent` e só então chama `email.sendAccessCode`; nos outros casos não faz nada e a resposta ao cliente permanece idêntica. Ganchos de senha: antes do `/sign-in/email`, ler o estado do usuário e aplicar `decidePasswordAttempt`; depois, gravar o resultado e auditar. Sessão: `expiresIn` de 30 dias com "manter conectado" e 12 h sem ele, conforme a nota. Cookies: `httpOnly`, `secure` fora de `development`, `sameSite: "lax"`.

- [ ] **Step 5: Implementar `authRoutes` e `requireSession`**: rota curinga conforme o padrão da documentação (converter a requisição Fastify em `Request`, devolver status, cabeçalhos e corpo); corpo ausente ou JSON inválido ⇒ 400. `/api/me` com `requireSession`. Registrar em `app.ts` quando `deps.auth` existir. **Nunca** logar corpo, cabeçalhos de cookie nem e-mail.

- [ ] **Step 6: Compor em `composition.ts`**: `createPool(env.DATABASE_AUTH_URL)` (erro claro se ausente e a autenticação estiver ligada), `AUTH_SECRET` obrigatório, `NODE_ENV=production` ⇒ recusar `createFileEmailSender` com mensagem "sem serviço de e-mail configurado (F8)". `baseUrl = env.APP_URL`, `trustedOrigins = [env.APP_URL]`. Fechar o pool em `close()`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @app/api test:int -- auth-login && pnpm --filter @app/api test && pnpm --filter @app/api typecheck && pnpm lint`
Expected: PASS em tudo, inclusive os testes de arquitetura (camadas `http` e `modules`). Mensagem sugerida: `feat(api,db): login por código e senha com Better Auth`.

---

### Task 7: Painel: sessão, `proxy.ts` e tela de acesso

**Files:**
- Create: `apps/web/lib/auth/session.ts`, `apps/web/lib/auth/session.test.ts`, `apps/web/proxy.ts`, `apps/web/proxy.test.ts`, `apps/web/features/auth/login-form.tsx`, `apps/web/features/auth/login-form.test.tsx`, `apps/web/features/auth/auth-client.ts`, `apps/web/e2e/login.spec.ts`
- Modify: `apps/web/app/(public)/login/page.tsx` (hoje só `.gitkeep`), `apps/web/components/app-shell.tsx` (botão "Sair"), `apps/web/e2e/fake-api.mjs` (rotas de autenticação falsas), `apps/web/package.json` (`better-auth` já vem do workspace? usar só o cliente `better-auth/react` se a nota da Task 1 recomendar; senão `fetch` com `lib/api`)

**Interfaces:**
- Consumes: `/api/auth/*` e `/api/me` (Task 6), `ApiError` e o cliente de `lib/api/client.ts`.
- Produces:
  - `getSession(): Promise<{ userId: string; name: string; email: string } | null>` em `lib/auth/session.ts`: **único** lugar que lê a sessão no servidor (chama `/api/me` repassando o cookie); `requireSessionOrRedirect(): Promise<Session>` redireciona para `/login`.
  - `proxy.ts`: redireciona para `/login?next=<rota>` quando não há cookie de sessão, deixa passar `/login`, `/_next`, arquivos estáticos e `/api`. É conforto; a API continua a autoridade.
  - `LoginForm`: abre no modo código (campo de e-mail → botão "Enviar código" → campo de 6 dígitos), link "Entrar com senha" alterna para e-mail + senha, caixa "Manter conectado". Mensagens em português para código errado, expirado, excesso de tentativas, reenvio em N segundos, senha bloqueada; **a mesma mensagem** para e-mail desconhecido ("Se o e-mail estiver cadastrado, você receberá o código.").

- [ ] **Step 1: Escrever os testes que falham**
  - `session.test.ts`: `"sem cookie: null"`, `"API devolve 401: null"`, `"API devolve a sessão: objeto com userId, name e email"`, `"requireSessionOrRedirect sem sessão chama redirect('/login')"` (injetar o fetch).
  - `proxy.test.ts`: `"sem cookie em /lancamentos: redireciona para /login?next=%2Flancamentos"`, `"com cookie: segue"`, `"/login e /_next passam sem cookie"`.
  - `login-form.test.tsx` (Testing Library): abre no modo código; "Enviar código" mostra a mensagem genérica e o campo de 6 dígitos; "Entrar com senha" troca os campos; erro "código inválido" aparece sem revelar o e-mail; botão desabilitado e contagem de 60 s após o envio.
  - `e2e/login.spec.ts` (Playwright, API falsa): visitar `/lancamentos` sem sessão leva a `/login`; pedir código e digitar o código fixo da API falsa entra e mostra a casca; "Sair" volta ao `/login`; roda em desktop e Pixel 7.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/web test` e `pnpm --filter @app/web test:e2e -- login`
Expected: FAIL.

- [ ] **Step 3: Implementar** `session.ts`, `proxy.ts` e a página `(public)/login` com `LoginForm`, estados de carregando e erro conforme RNF09 (reaproveitar `loading.tsx` e `error.tsx`); `components/ui` ganha só o que faltar via `shadcn add` (input, label) sem trocar a base. Seguir `apps/web/CLAUDE.md` (cache: nada de sessão em `use cache`; páginas autenticadas dinâmicas). Estender `fake-api.mjs` com `POST /api/auth/email-otp/send-verification-otp`, `POST /api/auth/sign-in/email-otp`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out` e `GET /api/me`, usando cookie e código fixos.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web test && pnpm --filter @app/web test:e2e && pnpm lint`
Expected: PASS. Mensagem sugerida: `feat(web): tela de acesso, leitura única da sessão e proxy`.

---

### Task 8: Fechamento da F1a

**Files:**
- Modify: `docs/planos/painel.md` (tabela: F1a feita, F1b e F1c a fazer; "Atualizado em"), `docs/planos/andamento.md` (seções 3, 5 e 6: tirar a pendência de `phone_e164`, marcar F1a), `docs/arquitetura.md` (tabelas `sessions`, `accounts`, `verifications`, `auth_audit`, papel `app_auth`, `users` com `phone_e164` opcional), `CLAUDE.md` (Estado atual: painel F1a feita), `docs/decisoes.md` (nova decisão curta: Better Auth sobre `users` com papel `app_auth`, confirmada pela prova de conceito; envio de e-mail falso até a F8)

- [ ] **Step 1: Rodar a verificação completa**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int && pnpm --filter @app/web test:e2e`
Expected: tudo verde. Se algo falhar, diagnosticar a causa real; não enfraquecer teste.

- [ ] **Step 2: Rodar o fluxo à mão** com `pnpm db:seed:dev`, `pnpm dev` e abrir `http://localhost:3000/login`: pedir código para um usuário de exemplo, ler o JSON em `.dev-mail/`, entrar, ver a casca, sair. Anotar o resultado em uma linha no `andamento.md`.

- [ ] **Step 3: Atualizar os cinco documentos** acima (subir a data "Atualizado em" para a do dia).

- [ ] **Step 4: Fechamento de etapa do plano do painel.** Responder, em uma mensagem ao Luís, a pergunta do passo 3 do "Fechamento de etapa" (o que repetiu e vale virar regra, skill, hook ou `CLAUDE.md` de módulo): **propor e esperar aprovação, sem criar**. Sugerir a mensagem de commit em Conventional Commits; não commitar sem pedido.

---

## Self-review

- **Cobertura do desenho (F1a):** prova de conceito (Task 1); papel `app_auth` e RLS (2, 3); `phone_e164` opcional (3); login por código e senha com as regras de RF02.R1, R4, R5, R7 (4, 6); porta de e-mail com envio falso (5); `lib/auth/session.ts`, `proxy.ts`, tela e logout (7); auditoria básica (3, 6); API recusa sem sessão (6, CA08); CA07 (6); atualização de documentos (8). Fica de fora, como o desenho manda: autocadastro (F1b), recuperação, perfil e lista de sessões (F1c), serviço real de e-mail (F8), seletor de empresa (F2).
- **Consistência de nomes:** `decidePasswordAttempt`, `decideOtpSend`, `validatePassword`, `normalizeEmail` (Task 4) são os mesmos usados na Task 6; `AuthStore` (Task 6) lista os métodos usados pelos ganchos; `EmailSender.sendAccessCode` (Task 5) é o que `createAuth` chama; `TestDatabase.auth` (Task 2) é o pool usado nos testes das Tasks 3 e 6.
- **Dependências entre tarefas:** 1 → 3 e 6 (a nota decide colunas e configuração); 2 → 3 → 6; 4 e 5 antes de 6; 7 depende da 6 só no contrato HTTP (usa API falsa); 8 por último.
- **Risco aberto:** se a nota da Task 1 reprovar o caminho A, o plano para na Task 1 e o desenho é revisto com o Luís antes de qualquer outra tarefa.
