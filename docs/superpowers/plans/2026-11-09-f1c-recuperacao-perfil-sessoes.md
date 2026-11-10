# F1c: Recuperação de senha, perfil e sessões — plano de implementação

> **Revisão de 09/11/2026 (DD-27):** a recuperação de senha passou de código de 6 dígitos para **link temporário** (uso único, 30 minutos), também no "Meu perfil". Onde este documento fala em código de recuperação, rotas `/password/code` e `/with-code` ou `email-otp/request-password-reset`, vale a DD-27 em `docs/decisoes.md` e o RF03 do `requisitos.md` v1.6. O login por código (RF02) não mudou.

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`. Os passos usam caixas `- [ ]`. **Não commitar sem o Luís pedir** (regra do `painel.md`): em cada tarefa o último passo só sugere a mensagem de commit (Conventional Commits).

**Objetivo:** fechar a F1 do painel: recuperar a senha pelo e-mail, e uma tela "Meu perfil" com nome, senha e sessões abertas.

**Arquitetura:** a recuperação e o perfil passam por rotas próprias da API (`/api/recovery/reset`, `/api/profile/*`), que chamam o Better Auth só no servidor e fazem a revogação de sessões, a auditoria e o aviso por e-mail. O resto de `/api/auth/*` passa a ter uma lista de rotas permitidas. O envio do código continua pelo caminho nativo do `emailOTP`.

**Stack:** Fastify + Zod, Better Auth 1.7.18 (`emailOTP`), Drizzle/Postgres (papel `app_auth`), Next.js 16, Vitest + Testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-f1c-recuperacao-perfil-sessoes-design.md` (cita RF02, RF03, RNF01, RNF04; em conflito vale `docs/requisitos.md`).

## Desvios do desenho aprovado (para o Luís conferir)

1. **A recuperação também ganha rota própria** (`POST /api/recovery/reset`), em vez de usar `/email-otp/reset-password` do Better Auth. Motivo: um só caminho (recuperação e perfil) com auditoria, aviso e revogação de sessões feitos por nós, sem depender de uma opção do Better Auth que não consegui confirmar (`revokeSessionsOnPasswordReset`), e sem hook que derrubaria a sessão atual no perfil. O comportamento para o usuário é o mesmo do desenho. O envio do código segue nativo.
2. **`GET /api/profile` não devolve id de sessão** (só há "encerrar as outras", não precisa de id).
3. **Troca de senha com a atual** usa verificação e gravação próprias (`verifyPassword` + `setPasswordHash`), não `auth.api.changePassword`.
4. **A tela `/perfil` lê o perfil pelo navegador** (TanStack Query): ainda não existe leitura autenticada no servidor além de `lib/auth/session.ts`; ela nasce na F2.
5. **Recuperação concluída zera o bloqueio da senha** (`failed_password_attempts = 0`, `password_locked_until = null`): quem recuperou pelo e-mail não pode ficar 15 min sem entrar com a senha nova.

## Global Constraints

- Código de acesso: 6 dígitos, vale 5 min, 3 tentativas, reenvio após 60 s, 5 envios/h por e-mail e 20/h por IP (RF02.R4). Já implementado; não mudar.
- Senha: 8 a 64 caracteres, com letra e número, diferente do e-mail (`validatePassword` do core); nova senha na recuperação não pode ser igual à atual (RF03.R3).
- Sessão: 12 h de inatividade, ou 30 dias com "manter conectado" (RF02.R5).
- Resposta de pedido de código idêntica para e-mail desconhecido, sem vínculo ou conhecido; nenhum e-mail enviado nesses casos (RF02.R1, RF03.R1).
- Nunca logar nem gravar em claro senha, código ou e-mail em auditoria: só `email_hash` (`hashEmail` de `infra/auth/create-auth.ts`). Logs nunca com corpo de requisição (regra 9).
- Textos para o usuário em pt-BR; identificadores em inglês. Data/hora do aviso em `America/Sao_Paulo`.
- Migration só com `app_auth` sem permissões novas: os GRANTs da 0011 já cobrem `sessions` (DELETE), `accounts` (UPDATE) e `users` (UPDATE).
- Sem `use cache` em dado de usuário (web). Seletores de teste por papel e texto acessível. Toda tela nova testada no celular (Pixel 7, sem rolagem horizontal).
- Rodar antes de concluir cada tarefa: `pnpm typecheck && pnpm lint` no pacote tocado, e os testes citados.

## Review Focus

Cada linha tem o teste dono na tarefa indicada.

1. **Oráculo da senha atual:** pedir a recuperação com código errado e senha nova igual à atual deve responder `INVALID_OTP`, nunca `SAME_PASSWORD` (senão burla o bloqueio de tentativas do login). Tarefa 7.
2. **Código reaproveitado:** o mesmo código não conclui duas recuperações (uso único). Tarefa 7.
3. **Quem nunca definiu senha usando a rota da senha atual:** `POST /api/profile/password` responde 400 `NO_PASSWORD`, nunca 500. Tarefa 8.
4. **E-mail sem vínculo ativo ou desconhecido em `/api/recovery/reset`:** mesmo erro de código inválido, nenhum e-mail, nenhuma auditoria `password_reset`. Tarefa 7.
5. **Nome em branco ou enorme:** `PATCH /api/profile/name` recusa vazio/espaços e mais de 120 caracteres; grava aparado. Tarefa 8.

---

### Tarefa 1: Decisão e requisito primeiro (DD-26, requisitos v1.5)

**Files:**
- Modify: `docs/decisoes.md` (nova linha DD-26 ao fim da tabela, no formato das anteriores)
- Modify: `docs/requisitos.md` (cabeçalho `Versão`, RF02.R8)

**Interfaces:** Produces: DD-26 citada pelos demais documentos.

- [ ] **Passo 1:** em `docs/requisitos.md`, RF02.R8, trocar "Desativar o usuário (RF05) ou trocar a senha encerra todas as sessões dele" por texto que diga: desativar o usuário encerra todas as sessões; trocar a senha pelo "Meu perfil" encerra as **outras** e mantém a atual; concluir a recuperação de acesso (RF03) encerra todas. Subir `Versão` para 1.5 (09/11/2026) com uma frase da mudança. O RF02.CA09 já diz "outras" e não muda.
- [ ] **Passo 2:** em `docs/decisoes.md`, acrescentar **DD-26 (09/11/2026)** com: (1) troca do próprio e-mail (RF02.Obs3) adiada da F1c; (2) recuperação e perfil por rotas próprias (`/api/recovery/reset`, `/api/profile/*`) e lista de rotas permitidas em `/api/auth/*`; (3) fim da recuperação volta ao login, sem sessão automática; (4) sessões: só "encerrar as outras"; (5) RF02.R8 alinhado ao CA09; (6) a recuperação zera o bloqueio da senha. Coluna "Onde vale": RF02, RF03, F1c. Situação: Vigente.
- [ ] **Passo 3:** sugerir commit `docs: DD-26 e requisitos 1.5 (F1c)`.

### Tarefa 2: Core — rótulo do aparelho e porta de aviso de segurança

**Files:**
- Create: `packages/core/src/auth/describe-device.ts`, `packages/core/src/auth/describe-device.test.ts`
- Modify: `packages/core/src/ports/ports.ts`, `packages/core/src/index.ts` (exportar)

**Interfaces:**
- Produces: `describeDevice(userAgent: string | null | undefined): string`; tipos `SecurityNoticeKind = "password-changed"` e `SecurityNoticeMessage = { to: string; kind: SecurityNoticeKind; at: Date }`; método `EmailSender.sendSecurityNotice(message: SecurityNoticeMessage): Promise<void>`.

- [ ] **Passo 1: testes que falham** em `describe-device.test.ts` (user agents reais, abreviados): Chrome/Android → `"Chrome no Android"`; iPhone/Safari → `"Safari no iPhone"`; Edge/Windows (`Edg/`) → `"Edge no Windows"`; Firefox/Linux → `"Firefox no Linux"`; Chrome/Mac → `"Chrome no Mac"`; `CriOS` → `"Chrome no iPhone"`; `undefined`, `null` e `""` → `"Navegador desconhecido"`; navegador conhecido sem sistema → só `"Chrome"`; texto aleatório → `"Navegador desconhecido"`.
- [ ] **Passo 2:** rodar `pnpm --filter @app/core exec vitest run src/auth/describe-device.test.ts` → FALHA (função não existe).
- [ ] **Passo 3:** implementar `describeDevice`. Heurística por substrings, sem dependência; ordem: Edge antes de Chrome, Chrome/CriOS antes de Safari. Sistema: Android, iPhone, iPad, Windows, "Mac OS X" → "Mac", Linux. O retorno é só texto (a tela o mostra como texto).
- [ ] **Passo 4:** em `ports.ts`, adicionar os tipos e o método à interface `EmailSender`. Rodar `pnpm --filter @app/core typecheck` e `pnpm typecheck` na raiz: os implementadores de `EmailSender` (tarefa 4) vão acusar erro; é esperado até a tarefa 4.
- [ ] **Passo 5:** rodar o teste do passo 2 → PASSA. Sugerir commit `feat(core): describeDevice e aviso de segurança na porta de e-mail (RF02.R8)`.

### Tarefa 3: Banco — eventos de auditoria e consultas de conta

**Files:**
- Modify: `packages/db/schema/auth.ts` (`AUTH_EVENTS`)
- Create: migration gerada `packages/db/migrations/0015_f1c_auth_events.sql` (+ `meta`)
- Modify: `packages/db/src/auth-store.ts`
- Test: `packages/db/src/auth-store.int.test.ts` (ou o arquivo de integração do store que já existir; procurar com Glob `packages/db/**/auth-store*.test.ts`)

**Interfaces:**
- Produces, em `AuthStore`:
  - `getPasswordHash(userId: string): Promise<string | null>` (conta `provider_id = 'credential'`)
  - `setPasswordHash(userId: string, hash: string): Promise<boolean>` (só atualiza conta `credential` existente; `false` se não houver)
  - `listSessions(userId: string, now: Date): Promise<{ id: string; userAgent: string | null; updatedAt: Date }[]>` (só `expires_at > now`, mais recente primeiro)
  - `deleteSessionsExcept(userId: string, keepSessionId: string | null): Promise<number>` (`null` apaga todas)
  - `updateUserName(userId: string, name: string): Promise<void>`
- Novos eventos: `password_reset`, `password_changed`, `password_set`, `other_sessions_revoked`, `name_changed`.

- [ ] **Passo 1: testes de integração que falham** (padrão do arquivo existente, Testcontainers): `getPasswordHash` devolve o hash do usuário com senha e `null` do sem conta; `setPasswordHash` troca o hash e devolve `false` sem conta; `listSessions` ignora sessões vencidas e de outros usuários e ordena por `updatedAt` desc; `deleteSessionsExcept(user, keep)` apaga as outras e mantém `keep`, `deleteSessionsExcept(user, null)` apaga todas, e nenhuma delas toca sessões de outro usuário; `recordAudit` aceita os cinco eventos novos.
- [ ] **Passo 2:** rodar `pnpm --filter @app/db exec vitest run int.test.ts -t "auth-store"` (ajustar ao nome do arquivo) → FALHA.
- [ ] **Passo 3:** acrescentar os cinco eventos a `AUTH_EVENTS`; `pnpm --filter @app/db db:generate -- --name f1c_auth_events`; **revisar o SQL** (a CHECK `auth_audit_event_check` é recriada com os eventos novos; sem tabela nova, então `schema.test.ts` e `fixtures.ts` não mudam — conferir). Implementar os cinco métodos no store.
- [ ] **Passo 4:** aplicar a migration no banco de teste (os testes de integração já aplicam) e rodar `pnpm --filter @app/db test:int` → PASSA. Rodar `pnpm --filter @app/db typecheck`.
- [ ] **Passo 5:** sugerir commit `feat(db): eventos de auditoria da F1c e consultas de conta e sessões (RF02, RF03)`.

### Tarefa 4: E-mail — aviso de troca de senha

**Files:**
- Modify: `apps/api/src/infra/email/email-texts.ts`, `file-email-sender.ts`, `memory-email-sender.ts`, `email-sender.test.ts`
- Modify: qualquer outro implementador de `EmailSender` que o `typecheck` apontar (fakes em testes)

**Interfaces:**
- Consumes: `SecurityNoticeMessage` (tarefa 2).
- Produces: `passwordChangedText(at: Date): string`; `createMemoryEmailSender().sentNotices: ReadonlyArray<SecurityNoticeMessage>`.

- [ ] **Passo 1: testes que falham** em `email-sender.test.ts`: o sender em memória guarda o aviso em `sentNotices` (separado de `sent`, para os testes de código existentes não quebrarem); o sender de arquivo grava um JSON com `kind: "password-changed"` e `text` igual a `passwordChangedText(at)`; `passwordChangedText` contém a data e hora em `America/Sao_Paulo` no formato `dd/MM/yyyy HH:mm` e a orientação de procurar o suporte se não foi a pessoa (RF03.Obs1); o texto não contém senha nem código.
- [ ] **Passo 2:** rodar `pnpm --filter @app/api exec vitest run src/infra/email` → FALHA.
- [ ] **Passo 3:** implementar. O texto é fixo em pt-BR; a data usa `Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })`.
- [ ] **Passo 4:** rodar o passo 2 → PASSA; `pnpm --filter @app/api typecheck` limpo.
- [ ] **Passo 5:** sugerir commit `feat(api): aviso por e-mail de troca de senha (RF03.Obs1)`.

### Tarefa 5: Harness de teste de integração da autenticação

**Files:**
- Read: `apps/api/test/auth-login.int.test.ts` (linhas 1 a 200: setup, `createUser`, `post`, `requestCode`, `lastCode`, `sessionCookie`, `me`, `loginWithCode`, `signInPassword`)
- Create: `apps/api/test/support/auth-harness.ts`
- Modify: `apps/api/test/auth-login.int.test.ts` (passa a importar do harness)

**Interfaces:**
- Produces: `startAuthHarness(): Promise<AuthHarness>` com `app`, `email` (sender em memória), `clock` (relógio congelável com `advance(ms)`), `reset()`, `stop()`, e os helpers acima como métodos. Os tipos exatos saem do que já existe no arquivo; só mover, sem mudar comportamento.

- [ ] **Passo 1:** rodar `pnpm --filter @app/api exec vitest run test/auth-login.int.test.ts` e anotar quantos testes passam (base).
- [ ] **Passo 2:** mover o setup e os helpers para `auth-harness.ts` e reimportar no teste existente. Nenhuma asserção muda.
- [ ] **Passo 3:** rodar o mesmo comando → mesma contagem verde. Sugerir commit `test(api): harness compartilhado dos testes de autenticação`.

### Tarefa 6: Lista de rotas permitidas e novas operações do gateway

**Files:**
- Modify: `apps/api/src/http/auth/auth-routes.ts`, `apps/api/src/http/auth/auth-messages.ts`
- Modify: `apps/api/src/modules/auth/check-session.ts` (interface `AuthGateway`)
- Modify: `apps/api/src/infra/auth/create-auth.ts` (`createAuthGateway`)
- Modify: `apps/api/test/auth-login.int.test.ts` (testes que usam rotas agora fechadas)
- Create: `apps/api/test/auth-allowlist.int.test.ts`

**Interfaces:**
- Produces, em `AuthGateway`:
  - `verifyPassword(input: { hash: string; password: string }): Promise<boolean>`
  - `requestPasswordCode(input: { email: string; ip?: string; userAgent?: string }): Promise<void>` (faz internamente o `POST /api/auth/email-otp/request-password-reset`, passando pelo gancho de anti-enumeração e limites)
  - `checkResetCode(input: { email: string; otp: string }): Promise<void>` (não consome; conta tentativa errada)
  - `resetPasswordWithCode(input: { email: string; otp: string; password: string }): Promise<void>` (consome o código e grava a senha; cria a conta `credential` se faltar)
- `export class ResetCodeError extends Error { constructor(readonly code: string) }` em `check-session.ts`; os dois métodos acima traduzem `APIError` do Better Auth para ele (códigos desconhecidos viram `"INVALID_OTP"`).
- Rotas permitidas (exatas, após `normalizePath`): `sign-in/email`, `sign-in/email-otp`, `email-otp/send-verification-otp`, `email-otp/request-password-reset`, `sign-out`. Qualquer outra em `/api/auth/*` responde **404** com `authError(404)`.
- ⚠️ Confirmar nos tipos de `better-auth@1.7.18` os nomes `auth.api.checkVerificationOTP` e `auth.api.resetPasswordEmailOTP` antes de usar.

- [ ] **Passo 1: testes que falham** em `auth-allowlist.int.test.ts`: cada uma destas responde 404 com e sem sessão: `POST /api/auth/update-user`, `/change-email`, `/change-password`, `/revoke-other-sessions`, `/revoke-session`, `/email-otp/reset-password`, `/email-otp/check-verification-otp`, `/reset-password`, `/forget-password/email-otp` e `GET /api/auth/list-sessions`, `/get-session`; variações `//api/auth//Update-User/` também 404; as cinco permitidas continuam funcionando (login por código, por senha, pedido de código, sair); o pedido de código para e-mail desconhecido segue idêntico ao de conhecido e sem e-mail.
- [ ] **Passo 2:** rodar o arquivo → FALHA (hoje respondem 200/401).
- [ ] **Passo 3:** implementar a lista em `auth-routes.ts` (substitui `OPEN_PATHS`; a checagem de lista vem **antes** de `sessionBlocked`). Adicionar a `MESSAGES` os códigos `SAME_PASSWORD` ("A nova senha não pode ser igual à atual."), `NO_PASSWORD` ("Você ainda não tem senha. Defina uma pelo código enviado ao e-mail."), `INVALID_NAME` ("Informe um nome de 1 a 120 caracteres.").
- [ ] **Passo 4:** implementar as quatro operações no gateway (corpo livre; `verifyPassword` usa `(await auth.$context).password.verify`).
- [ ] **Passo 5:** migrar os testes antigos de `auth-login.int.test.ts`: o bloco de validação de senha por `change-password` (~linha 410) passa a validar a regra no core/perfil na tarefa 8 (remover aqui e deixar nota); o teste do usuário que perdeu o vínculo (~linha 610) passa a esperar 401 em `/api/profile` (tarefa 8) e 404 nas rotas fechadas. Registrar no teste o motivo da troca.
- [ ] **Passo 6:** rodar `pnpm --filter @app/api test:int` → PASSA (exceto o que aguarda a tarefa 8, marcado com `it.todo`). Sugerir commit `feat(api): lista de rotas permitidas em /api/auth e operações de código no gateway`.

### Tarefa 7: Recuperação de senha (RF03)

**Files:**
- Create: `apps/api/src/modules/recovery/recover-password.ts`, `apps/api/src/http/recovery/recovery-routes.ts`
- Modify: `apps/api/src/app.ts` (`AppDeps.recovery`), `apps/api/src/composition.ts`
- Test: `apps/api/test/auth-recovery.int.test.ts`; unitário `apps/api/src/modules/recovery/recover-password.test.ts`

**Interfaces:**
- Consumes: gateway (tarefa 6), `AuthStore` (tarefa 3), `EmailSender.sendSecurityNotice`, `BackgroundTasks`, `hashEmail`, `validatePassword`, `normalizeEmail`.
- Produces: `type RecoverPassword = (input: { email: string; code: string; password: string; ip?: string; userAgent?: string }) => Promise<void>`; `createRecoverPassword(deps): RecoverPassword`; `class RecoveryError extends Error { constructor(readonly code: string) }` com `code` em `INVALID_OTP | OTP_EXPIRED | TOO_MANY_ATTEMPTS | SAME_PASSWORD | PASSWORD_TOO_SHORT | PASSWORD_TOO_LONG | PASSWORD_NEEDS_LETTER_AND_DIGIT | PASSWORD_SAME_AS_EMAIL`.
- Rota: `POST /api/recovery/reset`, corpo `{ email, code, password }` (Zod; strings com máximo), resposta `{ success: true }`; erro `RecoveryError` → 400 com `authError(400, code)`. Pública (sem sessão), no plugin `recoveryRoutes` com o mesmo `setErrorHandler` das rotas de signup.

Ordem do caso de uso (importa para a segurança): (1) normaliza o e-mail; (2) usuário inexistente ou sem vínculo ativo → `RecoveryError("INVALID_OTP")`, sem chamar o Better Auth; (3) `validatePassword` → erro de senha; (4) `gateway.checkResetCode` (erro vira `RecoveryError`); (5) se há hash atual e `verifyPassword` bate com a senha nova → `SAME_PASSWORD` (o código segue válido); (6) `gateway.resetPasswordWithCode`; (7) `store.deleteSessionsExcept(user.id, null)`; (8) `store.updatePasswordState(user.id, { failedAttempts: 0, lockedUntil: null })`; (9) auditoria `password_reset` com `userId` e `emailHash`; (10) `background.run` envia `sendSecurityNotice({ to, kind: "password-changed", at: clock.now() })`.

- [ ] **Passo 1: testes que falham** em `auth-recovery.int.test.ts` (harness da tarefa 5): RF03.CA01 usuário sem senha pede código por `request-password-reset`, conclui em `/api/recovery/reset` e entra com a senha nova; RF03.CA02 duas sessões abertas antes caem (401 em `/api/me`) e o aviso foi enviado (`email.sentNotices` com 1 item para o e-mail certo); RF03.CA03 e-mail desconhecido recebe a mesma resposta do conhecido e `email.sent` e `sentNotices` ficam vazios; RF03.R3 senha igual à atual com código certo → 400 `SAME_PASSWORD` e o mesmo código ainda conclui com outra senha; **Review Focus 1** código errado + senha igual à atual → `INVALID_OTP`; **Review Focus 2** o código usado não funciona de novo; **Review Focus 4** e-mail desconhecido e e-mail de usuário sem vínculo ativo no `/api/recovery/reset` → `INVALID_OTP`, sem e-mail, sem auditoria `password_reset`; usuário com senha bloqueada (5 erros) recupera e já entra com a senha nova; senha fraca/curta/longa/igual ao e-mail → erros `PASSWORD_*`; 3 códigos errados invalidam o código (`TOO_MANY_ATTEMPTS`); código expirado (relógio +5 min) → `OTP_EXPIRED`; auditoria tem `password_reset` com `email_hash` e sem e-mail nem senha em claro; e-mail com maiúsculas e espaços é normalizado.
- [ ] **Passo 2:** rodar `pnpm --filter @app/api exec vitest run test/auth-recovery.int.test.ts` → FALHA (rota não existe).
- [ ] **Passo 3:** implementar `createRecoverPassword`, `recoveryRoutes`, o registro em `app.ts` e a composição. O corpo e o e-mail nunca vão para o log.
- [ ] **Passo 4:** rodar o arquivo → PASSA. Se algum teste mostrar que `resetPasswordWithCode` já revoga sessões ou cria sessão por conta própria, ajustar só o que o teste exigir; o passo 7 acima garante a revogação de qualquer forma.
- [ ] **Passo 5:** `pnpm --filter @app/api typecheck && pnpm --filter @app/api test` verdes. Sugerir commit `feat(api): recuperação de senha por código (RF03)`.

### Tarefa 8: Perfil — nome, senha e sessões

**Files:**
- Create: `apps/api/src/modules/profile/profile-service.ts`, `apps/api/src/http/profile/profile-routes.ts`
- Modify: `apps/api/src/app.ts` (`AppDeps.profile`), `apps/api/src/composition.ts`
- Test: `apps/api/test/profile.int.test.ts`; unitário `apps/api/src/modules/profile/profile-service.test.ts`

**Interfaces:**
- Consumes: tarefas 2, 3, 4, 6; `AuthSession` (`sessionId`, `userId`, `name`, `email`).
- Produces: `createProfileService(deps)` com
  - `get(session: AuthSession): Promise<ProfileView>`
  - `updateName(session, name: string): Promise<void>`
  - `changePassword(session, input: { currentPassword: string; newPassword: string; ip?; userAgent? }): Promise<void>`
  - `requestPasswordCode(session, audit: { ip?; userAgent? }): Promise<void>`
  - `changePasswordWithCode(session, input: { code: string; newPassword: string; ip?; userAgent? }): Promise<void>`
  - `revokeOtherSessions(session, audit): Promise<void>`
- `ProfileView = { name: string; email: string; hasPassword: boolean; sessions: { device: string; lastUsedAt: string /* ISO */; current: boolean }[] }`.
- `class ProfileError extends Error { constructor(readonly code: string) }`, `code` em `NO_PASSWORD | INVALID_PASSWORD | SAME_PASSWORD | INVALID_NAME | INVALID_OTP | OTP_EXPIRED | TOO_MANY_ATTEMPTS | PASSWORD_*`.
- Rotas (todas com `requireSession(checkSession)`, Zod, erro `ProfileError` → 400 com `authError(400, code)`; sem sessão 401): `GET /api/profile`; `PATCH /api/profile/name` `{ name }`; `POST /api/profile/password` `{ currentPassword, newPassword }`; `POST /api/profile/password/code` (sem corpo); `POST /api/profile/password/with-code` `{ code, newPassword }`; `POST /api/profile/sessions/revoke-others`. Resposta de sucesso das escritas: `{ success: true }`.

Regras: `updateName` apara e exige 1 a 120 caracteres; grava e audita `name_changed`. `changePassword`: sem hash → `NO_PASSWORD`; `verifyPassword` falso → `INVALID_PASSWORD` (não conta para o bloqueio do login); `validatePassword`; nova igual à atual → `SAME_PASSWORD`; `gateway.hashPassword` + `store.setPasswordHash`; `deleteSessionsExcept(userId, session.sessionId)`; auditoria `password_changed`; aviso em segundo plano. `changePasswordWithCode`: mesmos passos 3 a 5 da recuperação (validar, `checkResetCode`, comparar com a atual se houver), depois `resetPasswordWithCode` com o e-mail da **sessão** (nunca do corpo), `deleteSessionsExcept(userId, session.sessionId)`, auditoria `password_set` (não havia senha) ou `password_changed`, aviso. `requestPasswordCode` chama `gateway.requestPasswordCode` com o e-mail da sessão. `get` usa `describeDevice(userAgent)`, `current = (id === session.sessionId)`, `hasPassword = hash !== null`, e nunca devolve token nem id.

- [ ] **Passo 1: testes que falham** em `profile.int.test.ts`: sem sessão toda rota → 401 (RF02.CA08); `GET /api/profile` lista as duas sessões do usuário com `current` certo, rótulo de aparelho, `hasPassword`, e o JSON não contém `token` nem `id`; outro usuário nunca aparece; RF02.CA09 trocar a senha com a atual encerra a sessão B e mantém a A (A continua em `/api/me`, B dá 401), grava `password_changed` e envia aviso; troca com código: mesmo resultado, e para quem não tinha senha grava `password_set` e passa a entrar com senha; senha atual errada → `INVALID_PASSWORD`; **Review Focus 3** usuário sem senha chamando `/password` → `NO_PASSWORD`; nova senha igual à atual → `SAME_PASSWORD`; senha fraca → `PASSWORD_*`; o e-mail do corpo é ignorado no `with-code` (só vale o da sessão); `/password/code` envia um código ao e-mail da sessão, respeitando reenvio de 60 s (segundo pedido imediato não envia); `revoke-others` mantém a atual, apaga as demais e grava `other_sessions_revoked`; **Review Focus 5** nome vazio, só espaços e 121 caracteres → `INVALID_NAME`, `"  Maria  "` grava `"Maria"`, e `/api/me` mostra o nome novo; usuário que perdeu o vínculo ativo recebe 401 em `/api/profile` (RF02.CA07); auditoria sem senha, código nem e-mail em claro.
- [ ] **Passo 2:** rodar `pnpm --filter @app/api exec vitest run test/profile.int.test.ts` → FALHA.
- [ ] **Passo 3:** implementar serviço, rotas (plugin `profileRoutes`, mesmo `setErrorHandler` do signup), registro e composição. Nada de log de corpo.
- [ ] **Passo 4:** reativar os `it.todo` da tarefa 6 que pertencem ao perfil (validação de senha por `PASSWORD_*` e usuário sem vínculo) e rodar `pnpm --filter @app/api test:int` → PASSA.
- [ ] **Passo 5:** `pnpm --filter @app/api typecheck && pnpm lint` verdes. Sugerir commit `feat(api): perfil com nome, senha e sessões (RF02.Obs3, R8, CA09)`.

### Tarefa 9: Web — recuperação de senha e "Esqueci a senha"

**Files:**
- Modify: `apps/web/features/auth/auth-client.ts`, `login-form.tsx`, `apps/web/proxy.ts`
- Create: `apps/web/features/auth/recover-form.tsx`, `recover-form.test.tsx`, `apps/web/app/(public)/recuperar-senha/page.tsx`
- Test: `apps/web/features/auth/login-form.test.tsx` (existente: acrescentar casos), `apps/web/proxy.test.ts` (se existir; senão criar)

**Interfaces:**
- Produces em `AuthClient`: `requestPasswordReset(email: string): Promise<void>` (POST `/api/auth/email-otp/request-password-reset`, `{ email }`); `resetPassword(input: { email: string; code: string; password: string }): Promise<void>` (POST `/api/recovery/reset`).
- `RecoverForm({ client?: AuthClient; onDone?: (email: string) => void })`; ao concluir grava `sessionStorage["login:prefill"] = JSON.stringify({ email })` e chama `onDone` (padrão: `window.location.assign("/login")`).
- Mensagens extras em `FALLBACKS`: `SAME_PASSWORD`, `NO_PASSWORD`, `PASSWORD_*` (o texto vem da API; o fallback só cobre falha de rede).

Comportamento da tela (mesmo padrão de `LoginForm`: `useState`, shadcn, `role="alert"`, contagem de 60 s): passo 1 e-mail → "Enviar código" → status fixo "Se o e-mail estiver cadastrado, você receberá o código." e campos código (6 dígitos, `autoComplete="one-time-code"`), nova senha e confirmação (`autoComplete="new-password"`); não envia se a confirmação for diferente (erro local "As senhas não conferem."); erros de `OTP_EXPIRED`/`TOO_MANY_ATTEMPTS` voltam ao passo do código; sucesso → "Senha alterada. Entre com a nova senha." e vai para o login.

- [ ] **Passo 1: testes que falham** (Vitest + Testing Library, cliente falso): `RecoverForm` envia o pedido e mostra a mensagem fixa "Se o e-mail estiver cadastrado..." (com erro de rede mostra o texto de conexão, não a mensagem fixa), recusa confirmação diferente sem chamar a API, chama `resetPassword` com o e-mail, código e senha, grava o `sessionStorage` e chama `onDone`, mostra a mensagem de erro da API em `role="alert"`; `LoginForm` mostra o link "Esqueci a senha" (href `/recuperar-senha`) **só no modo senha** e a dica "Ainda não tem senha? Entre com o código ou toque em Esqueci a senha."; com `sessionStorage["login:prefill"]` o formulário abre no modo senha com o e-mail preenchido e remove a chave; `proxy` deixa `/recuperar-senha` passar sem cookie.
- [ ] **Passo 2:** `pnpm --filter @app/web exec vitest run features/auth` → FALHA.
- [ ] **Passo 3:** implementar; adicionar `/recuperar-senha` a `PUBLIC_PAGES`; a página fica em `app/(public)/recuperar-senha/page.tsx` (casca estática, `RecoverForm` dentro de `Suspense` como o `/login`).
- [ ] **Passo 4:** testes do passo 2 → PASSAM; `pnpm --filter @app/web typecheck && pnpm lint`. Sugerir commit `feat(web): recuperação de senha e link Esqueci a senha (RF03)`.

### Tarefa 10: Web — "Meu perfil" e menu do usuário

**Files:**
- Create: `apps/web/features/profile/profile-client.ts`, `profile-client.test.ts`, `profile-view.tsx`, `profile-view.test.tsx`, `apps/web/app/(app)/perfil/page.tsx`, `apps/web/components/user-menu.tsx`
- Modify: `apps/web/components/app-shell.tsx`, `apps/web/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `createProfileClient(fetchImpl?: typeof fetch): ProfileClient` com `get(): Promise<Profile>`, `updateName(name: string)`, `changePassword(input: { currentPassword: string; newPassword: string })`, `requestPasswordCode()`, `changePasswordWithCode(input: { code: string; newPassword: string })`, `revokeOtherSessions()`. `Profile` é o schema Zod espelho de `ProfileView` (tarefa 8), validado com `createApiClient`.
- `ProfileView({ client?: ProfileClient })` (client component, `useQuery(["profile"])` + `useMutation`; invalida `["profile"]` após cada escrita). `UserMenu({ name }: { name: string })` mostra o nome, o link "Meu perfil" (`/perfil`) e o `SignOutButton`. `AppShell` ganha a prop `userName: string`; `SessionGate` passa `session.name`.
- A tela tem três blocos: **Nome** (campo + "Salvar"); **Senha** (se `hasPassword`: senha atual, nova e confirmação + "Trocar senha", com o botão "Não lembro a senha atual: receber código" que troca o bloco para o fluxo do código; se não tem senha: "Definir senha" direto pelo fluxo do código — pedir código, digitar código, nova senha e confirmação); **Sessões ativas** (lista com `device`, "Último uso: dd/MM/yyyy às HH:mm" via `Intl` em `America/Sao_Paulo`, selo "Esta sessão", e o botão "Encerrar as outras sessões", desabilitado quando só há a atual). Tudo como texto (nunca HTML); alvos de toque confortáveis; sem rolagem horizontal no celular.

- [ ] **Passo 1: testes que falham:** `profile-client` valida a resposta com Zod e rejeita resposta torta; `ProfileView` com cliente falso: mostra o nome, a lista com "Esta sessão", esconde o fluxo de senha atual quando `hasPassword` é falso, troca de senha com confirmação diferente não chama a API, sucesso mostra "Senha alterada." e recarrega o perfil, "Encerrar as outras sessões" chama a API e desabilita quando só há uma sessão, erro da API aparece em `role="alert"`; `UserMenu` mostra o nome e o link.
- [ ] **Passo 2:** `pnpm --filter @app/web exec vitest run features/profile components` → FALHA.
- [ ] **Passo 3:** implementar. Ler `app/(app)/layout.tsx` antes (já lido: `SessionGate` chama `requireCurrentSession()`); usar o retorno para `userName`. Trocar o `SignOutButton` solto do `AppShell` (barra lateral e cabeçalho de celular) por `UserMenu`. Garantir que a lista de navegação (`lib/navigation.ts`) não ganhe item novo: o acesso é pelo menu do usuário.
- [ ] **Passo 4:** testes do passo 2 → PASSAM; `pnpm --filter @app/web test && pnpm --filter @app/web typecheck && pnpm lint`. Sugerir commit `feat(web): Meu perfil com nome, senha e sessões (RF02.Obs3, R8)`.

### Tarefa 11: API falsa e E2E (desktop e Pixel 7)

**Files:**
- Modify: `apps/web/e2e/fake-api.mjs`
- Create: `apps/web/e2e/recovery.spec.ts`, `apps/web/e2e/profile.spec.ts`

**Interfaces:**
- Consumes: telas das tarefas 9 e 10. A API falsa mantém estado em memória (senha atual `demo12345`, código fixo `123456`, lista de sessões com a atual e duas outras) e implementa: `POST /api/auth/email-otp/request-password-reset`, `POST /api/recovery/reset`, `GET /api/profile`, `PATCH /api/profile/name`, `POST /api/profile/password`, `POST /api/profile/password/code`, `POST /api/profile/password/with-code`, `POST /api/profile/sessions/revoke-others`. Erros no formato `{ code, message }`.

- [ ] **Passo 1: specs que falham:** `recovery.spec.ts`: do `/login` no modo senha toca "Esqueci a senha", pede o código, digita `123456` e a nova senha duas vezes, volta ao `/login` já em modo senha com o e-mail preenchido e entra; senha diferente na confirmação mostra o erro; `/recuperar-senha` abre sem sessão. `profile.spec.ts`: logado, abre o menu do usuário e vai a "Meu perfil"; troca o nome e vê o nome novo; troca a senha pela atual; encerra as outras sessões (a lista passa a ter uma); `/perfil` sem cookie vai para `/login`. Os dois rodam em `Desktop Chrome` e `Pixel 7` e conferem que não há rolagem horizontal (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Passo 2:** `pnpm --filter @app/web test:e2e -- recovery.spec.ts profile.spec.ts` → FALHA.
- [ ] **Passo 3:** completar a API falsa (sem lógica além do necessário) e ajustar seletores se preciso.
- [ ] **Passo 4:** rodar a suíte inteira `pnpm --filter @app/web test:e2e` → PASSA (incluindo `login`, `signup`, `smoke`). Sugerir commit `test(web): E2E de recuperação de senha e perfil`.

### Tarefa 12: Fechamento da etapa

**Files:**
- Modify: `docs/planos/painel.md`, `docs/planos/andamento.md`, `docs/arquitetura.md`, `CLAUDE.md`, `docs/decisoes.md` (só se algo mudar do que a DD-26 diz)

- [ ] **Passo 1: verificação final:** `pnpm typecheck && pnpm lint && pnpm test`, `pnpm --filter @app/api test:int`, `pnpm --filter @app/db test:int`, `pnpm --filter @app/web test:e2e`. Todos verdes antes de marcar "Feita" (usar `superpowers:verification-before-completion`).
- [ ] **Passo 2:** `painel.md`: F1c "Feita (data)", observação curta e links do desenho e deste plano; "Atualizado em"; F1 inteira cumprida. `andamento.md`: F1c feita; pendência nova "troca do próprio e-mail (RF02.Obs3), adiada da F1c, candidata à F6"; pendências novas da F1c (sem limite de tentativas na rota da senha atual; `/api/profile` lido no navegador até a F2; envio real do aviso na F8). `arquitetura.md`: eventos novos de `auth_audit`, rotas `/api/profile/*` e `/api/recovery/reset`, lista de rotas permitidas. `CLAUDE.md` (Estado atual): F1c feita, próxima etapa F2.
- [ ] **Passo 3 (roteiro à mão para o Luís):** aplicar a migration 0015 (`pnpm db:migrate`, com `DATABASE_ADMIN_URL` exportada); `pnpm dev`; em `/login` (modo senha) tocar "Esqueci a senha"; ler o código em `DEV_MAIL_DIR`; definir senha nova; entrar; abrir "Meu perfil"; abrir uma segunda sessão em outro navegador, trocar a senha no primeiro e ver a segunda cair; ler o aviso de troca em `DEV_MAIL_DIR`.
- [ ] **Passo 4:** seguir o "Fechamento de etapa" do `painel.md`: propor (sem criar) regras, skills ou hooks do que se repetiu na etapa. Sugerir commit `docs: F1c feita (recuperação, perfil e sessões)`.

---

## Autorrevisão

- **Cobertura do desenho:** recuperação (T7, T9), link e dica no login (T9), perfil com nome, senha e sessões (T8, T10), menu do usuário (T10), lista de rotas permitidas (T6), migration e auditoria (T3), aviso por e-mail (T2, T4), DD e requisito (T1), E2E (T11), fechamento (T12). Fora de escopo respeitado: sem troca de e-mail, sem encerrar sessão avulsa, sem login automático.
- **Consistência de nomes:** `getPasswordHash`, `setPasswordHash`, `listSessions`, `deleteSessionsExcept`, `updateUserName` (T3) são os usados em T7 e T8; `verifyPassword`, `requestPasswordCode`, `checkResetCode`, `resetPasswordWithCode`, `ResetCodeError` (T6) idem; `sentNotices` (T4) nos testes de T7 e T8; `sendSecurityNotice`/`SecurityNoticeMessage` (T2); `login:prefill` em T9 e T11.
- **Riscos abertos que os testes decidem:** nomes `checkVerificationOTP` e `resetPasswordEmailOTP` em `auth.api` (T6); se `resetPasswordWithCode` revoga ou abre sessão sozinho (T7 e T8 têm o teste e a revogação explícita).
- **Pendências de decisão que sobraram da F1c (09/11/2026, detalhe em `docs/planos/andamento.md`):** (1) a auditoria que falha depois de gravar a senha ou o nome devolve erro ao usuário mesmo com a troca feita; (2) no login por código (F1a), `TOO_MANY_ATTEMPTS` e `OTP_EXPIRED` permitem descobrir se um e-mail tem conta; a recuperação por link (DD-27) não tem esse problema.
