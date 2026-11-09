# F1a: achados da prova de conceito do Better Auth

Data: 09/11/2026. Pacote: `better-auth@1.7.18` (CLI `auth@latest`), `drizzle-orm@0.45.4`, `pg@8.23.1`. Postgres 16 do Compose, banco descartável `spike_auth`, conexão com o papel `app_auth`. Código do spike: branch `spike/f1a-better-auth` (worktree `../financeiro-spike`), não volta para a `main`.
Cada resposta traz: resposta, versão e o trecho mínimo que funcionou. Referências: `2026-11-07-f1-autenticacao-design.md`, RF01 a RF03.

## Configuração base que funcionou

```ts
export const auth = betterAuth({
  baseURL: "http://localhost:3000",            // origem do web (primeira parte)
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ["http://localhost:3000"],
  database: drizzleAdapter(db, { provider: "pg", schema }), // db = conexão app_auth
  advanced: {
    database: { generateId: "uuid" },          // ver Q1: NÃO usar função
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
  user: { modelName: "users" },
  session: { modelName: "sessions", expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 5 },
  account: { modelName: "accounts" },
  verification: { modelName: "verifications" },
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 64 },
  plugins: [emailOTP({ disableSignUp: true, otpLength: 6, expiresIn: 300, allowedAttempts: 3,
    storeOTP: "hashed", async sendVerificationOTP({ email, otp, type }) { /* ver Q5 */ } })],
});
```

## Q1. `drizzleAdapter` sobre `users` com `snake_case` e UUID v7

Resposta: funciona, com três ajustes.
- `user.modelName: "users"` (e `sessions`, `accounts`, `verifications`) basta. O adaptador usa os nomes das **propriedades** do schema Drizzle; como `emailVerified`, `createdAt`, `updatedAt` já são propriedades camelCase mapeadas para colunas `snake_case` no `pgTable`, **não é preciso `user.fields`**. `phone_e164` não precisa de `additionalFields` (o Better Auth ignora colunas que não conhece; nasce opcional).
- Colunas novas em `users`: `email_verified boolean not null default false`, `updated_at timestamptz not null default now()`, `image text` (nula). `phone_e164` passou a aceitar `NULL` (decisão 4 do desenho). `email` pode continuar nulo no banco; o Better Auth só opera com e-mail preenchido.
- **ARMADILHA: `advanced.database.generateId: () => uuidv7()` quebra.** O plugin `emailOTP` grava `verifications` com id determinístico (`SHA-256` em base64url, 43 caracteres), não com o gerador da função. Com coluna `uuid` dá `invalid input syntax for type uuid`, a rota devolve 500 e não aparece linha em `verifications`. Solução que funcionou: `generateId: "uuid"` (o Better Auth delega a geração ao banco/Drizzle e, quando precisa de id determinístico, gera um UUID válido) e manter o UUID v7 no schema: `uuid("id").primaryKey().$defaultFn(() => uuidv7())` (o `primaryId()` do repositório já faz isso). Conferido: o id da sessão saiu como `01a1be91-8974-73e2-...` (v7). Alternativa descartada: `verifications.id` como `text`.
- O CLI `npx auth@latest generate` exige um arquivo de config sem imports do projeto (o config completo falhou por módulo não encontrado); usei um `gen-config.ts` mínimo só com `modelName`s, `emailAndPassword` e `emailOTP`. Ele gera `text` para ids e `timestamp` sem fuso: **trocar na mão** por `uuid` e `timestamptz`.

## Q2. Colunas exigidas (saída do `auth generate`, tipos ajustados para o repositório)

- `users`: `id`, `name` (not null), `email` (único), `email_verified` (bool, default false), `image` (nulo), `created_at`, `updated_at`.
- `sessions`: `id`, `expires_at`, `token` (not null, único), `created_at`, `updated_at`, `ip_address` (nulo), `user_agent` (nulo), `user_id` (not null, FK `users`, `on delete cascade`). Índice em `user_id`.
- `accounts`: `id`, `account_id` (not null), `provider_id` (not null; senha usa `'credential'`), `user_id` (FK), `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password` (hash), `created_at`, `updated_at`. Índice em `user_id`.
- `verifications`: `id`, `identifier` (not null), `value` (not null), `expires_at`, `created_at`, `updated_at`. Índice em `identifier`. (O código de e-mail fica aqui, em hash com `storeOTP: "hashed"`.)
- Colunas de RF02 que **não** são do Better Auth (bloqueio de senha, contagem de erros, último acesso, limite de envio) são nossas; o spike as manteve em memória.

## Q3. RLS, GRANTs e `app_auth`

Resposta: o `FORCE ROW LEVEL SECURITY` de `users` e das tabelas novas nega tudo ao `app_auth` até haver política para ele. Medido:
- Sem GRANT: `permission denied for table users`.
- Com `GRANT SELECT` e sem política: `select count(*) from users` devolve **0 linhas, sem erro** (negação silenciosa; causa provável de "usuário não encontrado" na F1a).
- O que bastou (nada de `app.tenant_id`):

```sql
-- sessions, accounts, verifications: ENABLE + FORCE RLS e política aberta para o papel
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications TO app_auth;
CREATE POLICY sessions_auth      ON sessions      FOR ALL TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY accounts_auth      ON accounts      FOR ALL TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY verifications_auth ON verifications FOR ALL TO app_auth USING (true) WITH CHECK (true);
-- users: ler para achar o usuário; UPDATE porque o login por código marca email_verified/updated_at
GRANT SELECT, UPDATE ON users TO app_auth;
CREATE POLICY users_auth_select ON users FOR SELECT TO app_auth USING (true);
CREATE POLICY users_auth_update ON users FOR UPDATE TO app_auth USING (true) WITH CHECK (true);
-- vínculo ativo (Q5): o envio do código consulta memberships
GRANT SELECT ON memberships TO app_auth;
CREATE POLICY memberships_auth_select ON memberships FOR SELECT TO app_auth USING (true);
```
- `INSERT` e `DELETE` em `users` não foram necessários (`disableSignUp`); o cadastro da F1b usa caminho próprio.
- O `init.sql` não dá privilégios padrão ao `app_auth` (correto): tudo é concedido na migration. As migrations `0000` a `0010` aplicaram limpas num banco novo. Observação: o papel `app_auth` não existia no cluster do Compose (o `init.sql` do diretório principal tem a criação, ainda não commitada, e só roda na criação do volume); para bancos existentes é preciso reaplicar o `init.sql` por psql.

## Q4. Cookie atrás do `rewrites` do Next

Resposta: funciona. Testado de verdade: Fastify (porta 4000, `auth.handler` via `Request/Response`) mais `next dev` (porta 3000, `API_URL=http://localhost:4000`), com `curl` só contra `:3000`.
- `baseURL: "http://localhost:3000"` (origem do **web**, não da API) e `trustedOrigins: ["http://localhost:3000"]`. Em produção, `baseURL` = origem pública HTTPS do painel.
- Cookie de login em dev: `better-auth.session_token=<token>.<assinatura>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax` (sem `Domain`, ou seja, de primeira parte; sem `Secure` por ser HTTP).
- Com `baseURL` HTTPS (testado): `__Secure-better-auth.session_token=...; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`.
- **Nome exato do cookie para o `proxy.ts`: `better-auth.session_token` em HTTP (dev) e `__Secure-better-auth.session_token` em HTTPS (produção).** O `proxy.ts` deve aceitar os dois. O cookie guarda `token.assinatura`; o `proxy.ts` só testa presença, a validade é da API.
- Leitura na API: `auth.api.getSession({ headers })` com o cabeçalho `cookie` repassado pelo rewrite funcionou (com cookie 200, sem cookie 401).
- POST com `Origin: http://evil.com`: 400.
- **O rewrite do Next não acrescenta `x-forwarded-for`** (só `x-forwarded-host`) e repassa o que o cliente mandar. Em dev o IP chega vazio (a sessão grava `ip_address` vazio e o Better Auth avisa "Rate limiting could not determine a client IP", usando um balde único por rota). O limite de 20 envios por hora por IP só vale em produção se o proxy de borda definir `x-forwarded-for` de forma confiável e a API só confiar nele (`advanced.ipAddress.ipAddressHeaders` / `trustedProxies`). Pendência de infra (F8, RNF10).

## Q5. Só entra quem tem vínculo ativo; e-mail desconhecido recebe a mesma resposta

Resposta: funciona sem gancho especial.
- Com `emailOTP({ disableSignUp: true })`, e-mail desconhecido em `/email-otp/send-verification-otp` devolve `200 {"success":true}` e o Better Auth **nem chama** `sendVerificationOTP` (a lista de envios não cresceu). Mesma resposta e formato do e-mail conhecido.
- Usuário existente **sem vínculo ativo**: o Better Auth chama `sendVerificationOTP`; a checagem é nossa, lá dentro (resposta ao cliente continua `200 {"success":true}`):

```ts
async sendVerificationOTP({ email, otp, type }) {
  const r = await pool.query(
    `select 1 from users u join memberships m on m.user_id = u.id
      where u.email = $1 and m.status = 'active' and m.deactivated_at is null limit 1`, [email]);
  if (r.rowCount === 0) return;   // não envia, não lança erro
  await emailSender.send(/* ... */);
}
```
- Confirmados: 6 dígitos, validade 5 min (`expiresIn: 300`), 3 tentativas (`allowedAttempts: 3`): três códigos errados dão `400 INVALID_OTP`; o **código certo depois do terceiro erro** dá `403 TOO_MANY_ATTEMPTS` (cobre RF02.CA03). `storeOTP: "hashed"` funcionou.
- Lacunas a fechar na F1a (o Better Auth não cobre): (a) **`/sign-in/email` (senha) deixa entrar usuário sem vínculo ativo**; (b) uma **sessão já aberta continua válida** depois de desativar o vínculo (`get-session` seguiu 200 após `status='deactivated'`). RF02.R1/R6 e CA07 exigem checar o vínculo ativo em gancho de login e em `lib/auth/session.ts`/API a cada requisição; `revoke-sessions` do Better Auth funcionou para encerrar as sessões (RF02.R8). (c) Diferença de tempo entre "enviou" e "não enviou": o envio do e-mail não deve ser aguardado de forma que revele a diferença (enfileirar).

## Q6. 60 s entre envios, 5/h por e-mail, 20/h por IP

Resposta: parcial. O `rateLimit` do Better Auth chaveia por **IP mais caminho**, nunca por e-mail.
- 20/h por IP: `rateLimit: { enabled: true, customRules: { "/email-otp/send-verification-otp": { window: 3600, max: 20 } } }` (funcionou; responde `429` com texto genérico). `enabled: true` é necessário fora de produção. O plugin ainda traz regra própria de 3 por 60 s por rota; não atrapalhou.
- Observado: uma regra `{ window: 60, max: 1 }` em `customRules` bloqueou **e-mails diferentes** do mesmo IP (era IP, não e-mail). Por isso o intervalo de 60 s e o 5/h **por e-mail** vão num `hooks.before` próprio:

```ts
hooks: { before: createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/email-otp/send-verification-otp") {
    const email = (ctx.body as { email?: string }).email?.toLowerCase();
    /* histórico de envios do e-mail, com relógio injetado */
    if (tooSoon || overHourly) return ctx.json({ success: true }); // mesma resposta, sem enviar
  }
})}
```
Devolver `{ success: true }` sem enviar mantém a resposta idêntica; lançar `APIError` revelaria o limite. Na F1a real o histórico vai para o banco, não para memória; o relógio injetado entra na função de decisão.

## Q7. 5 erros de senha bloqueiam 15 min, sem afetar o código

Resposta: sim, por `hooks.before` mais `hooks.after` filtrando `ctx.path === "/sign-in/email"`.

```ts
before: if (ctx.path === "/sign-in/email" && locked(email)) throw new APIError("TOO_MANY_REQUESTS", { message: "PASSWORD_LOCKED" });
after:  if (ctx.path === "/sign-in/email") {
          const ret = ctx.context.returned;
          if (ret instanceof APIError) registrarErro(email);   // ao 5º: lockedUntil = agora + 15 min
          else limparErros(email);
        }
```
Medido: erros 1 a 5 devolvem `401 INVALID_EMAIL_OR_PASSWORD`; o 6º e a senha certa durante o bloqueio devolvem `429 PASSWORD_LOCKED`; com o relógio avançado 16 min a senha certa entra. `/sign-in/email-otp` não passa pelo filtro e segue funcionando. O gancho conta por e-mail digitado, exista ou não, para não revelar quem é cliente. Persistir contagem e `locked_until` em tabela (RF02.R7). `ctx.context.returned` é um `APIError` quando a senha falha.

## Q8. Sessão: 12 h de inatividade e 30 dias com "manter conectado"

Resposta: o Better Auth cobre só metade, e há uma lacuna no login por código.
- `session.expiresIn` é a duração **global** com renovação: com `updateAge`, o `get-session` renova `expires_at` para agora mais `expiresIn` e reenvia o cookie (testado: sessão com `updated_at` 10 min atrás passou de 29 para 30 dias). Config usada: `expiresIn: 60*60*24*30`, `updateAge: 60*5`.
- `rememberMe` existe **somente** em `/sign-in/email` (senha), `/sign-up/email` e telefone; **`/sign-in/email-otp` não aceita `rememberMe`** (só lê o cookie `dont_remember` se já existir). Com `rememberMe: false`: cookie de sessão do navegador (sem `Max-Age`) mais cookie `better-auth.dont_remember`, `expires_at` **fixo em 1 dia** (valor embutido no pacote) e **sem renovação**. Com `true`: `Max-Age=2592000` e renovação até 30 dias.
- Logo, "12 h de inatividade" **não** é nativo, e o modo padrão por código não oferece a escolha. Caminho sugerido para as Tasks 3 e 6: guardar `keep_connected` na sessão (campo adicional ou `databaseHooks.session.create.before`) e aplicar a inatividade de 12 h em `lib/auth/session.ts`/API usando `sessions.updated_at` (com `updateAge` curto, ex. 5 min, ele acompanha o último uso); `expiresIn` global fica em 30 dias. Alternativa mais simples: sessão do código sem "manter conectado" = 1 dia fixo, documentando a diferença com RF02.R5. A decisão é do Luís e do Matheus; a prova só mostra que o nativo não fecha RF02.R5 sozinho.
- Atributos de RF02.R5 (`httpOnly`, `secure`, `sameSite=lax`): atendidos por padrão (`Secure` só com `baseURL` HTTPS).

## Q9. Senha: tamanhos e hash

Resposta: `minPasswordLength: 8` e `maxPasswordLength: 64` aceitos e aplicados ao definir senha: 7 caracteres dá `400 PASSWORD_TOO_SHORT`, 65 dá `400 PASSWORD_TOO_LONG` (testado em `/sign-up/email`). No `sign-in` o tamanho não é validado (senha curta só dá `401`). A regra "letras e números" (RF01) **não existe** no Better Auth: validar nós mesmos (Zod) no cadastro e na recuperação.
- Hash padrão: **scrypt** do `node:crypto` (`@better-auth/utils/password`), `N=16384, r=16, p=1, dkLen=64`, salt aleatório de 16 bytes, senha normalizada NFKC; formato em `accounts.password`: `salt(32 hex):chave(128 hex)` (medido). Hash forte com sal: atende RNF01 sem biblioteca extra (há `emailAndPassword.password.hash/verify` caso se queira outro algoritmo).
- **`emailAndPassword.disableSignUp: true` é obrigatório**: `emailOTP.disableSignUp` só vale para o plugin; `POST /api/auth/sign-up/email` continuou exposto e validando senha. Sem a opção, a rota de cadastro por senha fica aberta.

## Outros achados que mudam o desenho

- `auth.handler(Request)` integra com Fastify convertendo `req` em `Request` e copiando `set-cookie` como **lista** (`reply.header("set-cookie", cookies)`); uma única string quebraria cookies múltiplos (`session_token` e `dont_remember`).
- `generateId: "uuid"` precisa vir junto de `$defaultFn(uuidv7)` em **todas** as quatro tabelas.
- Mensagens e `code` do Better Auth vêm em inglês (`INVALID_OTP`, `TOO_MANY_ATTEMPTS`, `PASSWORD_TOO_SHORT`...); a API deve mapear por `code` para texto em português (RNF09).
- Dependências: `apps/api` precisou declarar `better-auth`, `drizzle-orm` e `pg` (hoje só `@app/db` as tem).

## Decisão

**Caminho A confirmado.** `users` serve de tabela de usuário do Better Auth por `modelName` e colunas novas, com `app_auth` sem `app.tenant_id` e políticas próprias; cookie de primeira parte atrás do `rewrites`; `emailOTP` com `disableSignUp`; resposta idêntica para e-mail desconhecido e sem vínculo. Os pontos a resolver na implementação (lacunas da Q5, limite por e-mail em gancho na Q6, inatividade e "manter conectado" com código na Q8, `emailAndPassword.disableSignUp`, IP real atrás do proxy) não exigem o caminho B.
