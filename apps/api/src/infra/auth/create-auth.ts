import { createHash, randomBytes } from "node:crypto";
import {
  type Clock,
  canHoldSession,
  decideOtpSend,
  decidePasswordAttempt,
  type EmailSender,
  normalizeEmail,
  PASSWORD_LOCK_MINUTES,
  PASSWORD_MAX_FAILURES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordError,
  receivesLoginCode,
  sessionExpiresAt,
  validatePassword,
} from "@app/core";
import { type AuthStore, accounts, sessions, users, verifications } from "@app/db";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { z } from "zod";
import {
  type AuthGateway,
  type AuthSession,
  ResetTokenError,
} from "../../modules/auth/check-session";
import type { BackgroundTasks } from "./background-tasks";

export interface CreateAuthDeps {
  /** Pool do papel `app_auth` (sem `app.tenant_id`). */
  readonly pool: pg.Pool;
  readonly store: AuthStore;
  readonly email: EmailSender;
  readonly clock: Clock;
  readonly secret: string;
  /** Origem pública do painel (o cookie é de primeira parte, atrás do `rewrites` do Next). */
  readonly baseUrl: string;
  readonly trustedOrigins: string[];
  /**
   * Destino dos logs internos do Better Auth. Só o texto fixo da mensagem passa: os argumentos
   * (erros do banco com parâmetros, por exemplo) podem trazer e-mail (regra 9).
   */
  /** Fora de `development` o cookie de sessão é `Secure`. */
  readonly secureCookies: boolean;
  /** Onde roda o envio do código, sem segurar a resposta (RF02.R1). */
  readonly background: BackgroundTasks;
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

/** Validade do link de recuperação de senha (RF03.R2). */
const RESET_LINK_TTL_SECONDS = 30 * 60;
const SEND_OTP_PATH = "/email-otp/send-verification-otp";
/** Cabeçalhos internos: a rota Fastify descarta os que vêm do cliente com este prefixo. */
export const INTERNAL_HEADER_PREFIX = "x-auth-internal-";
const INTERNAL_HEADER = `${INTERNAL_HEADER_PREFIX}send`;
/** Marca da tentativa de senha, do gancho `before` para o `after`. */
const ATTEMPT_HEADER = `${INTERNAL_HEADER_PREFIX}attempt`;
const OTP_TYPES = ["sign-in", "email-verification"] as const;
type OtpType = (typeof OTP_TYPES)[number];
const isOtpType = (value: unknown): value is OtpType =>
  typeof value === "string" && (OTP_TYPES as readonly string[]).includes(value);
const PASSWORD_SIGN_IN = "/sign-in/email";
const OTP_SIGN_IN = "/sign-in/email-otp";
const NO_ACTIVE_UNIT = "NO_ACTIVE_UNIT";
/** Rotas que definem senha nova e o campo onde ela vem (RF01/RF02.R3). */
const SET_PASSWORD_FIELDS: Record<string, string> = {
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
};

const PASSWORD_ERROR_CODES: Record<PasswordError, string> = {
  too_short: "PASSWORD_TOO_SHORT",
  too_long: "PASSWORD_TOO_LONG",
  needs_letter_and_digit: "PASSWORD_NEEDS_LETTER_AND_DIGIT",
  same_as_email: "PASSWORD_SAME_AS_EMAIL",
};

/** Auditoria guarda o e-mail só como hash SHA-256 do e-mail em minúsculas (regra 9). */
export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

type Body = Record<string, unknown>;
const asBody = (value: unknown): Body | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Body) : null;
const emailOf = (body: Body | null): string | null =>
  typeof body?.email === "string" ? normalizeEmail(body.email) : null;

/** IP que a rota Fastify gravou em `x-forwarded-for` (o cliente não escolhe; ver auth-routes). */
function ipOf(headers: Headers | undefined): string | undefined {
  const value = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

const uaOf = (headers: Headers | undefined) => headers?.get("user-agent") ?? undefined;

/**
 * Better Auth sobre a nossa tabela `users` (caminho A, nota da Task 1). Os ganchos aplicam as
 * regras de RF02 com as funções puras do core e o relógio injetado; o Better Auth usa `Date`.
 */
export function createAuth(deps: CreateAuthDeps) {
  const { store, clock } = deps;
  const schema = { users, sessions, accounts, verifications };
  const db = drizzle(deps.pool, { schema });
  // Só o envio feito pela tarefa em segundo plano leva este segredo: o cliente nunca o conhece.
  const internalToken = randomBytes(32).toString("hex");

  const passwordLocked = () =>
    new APIError("TOO_MANY_REQUESTS", {
      code: "PASSWORD_LOCKED",
      message: "password sign-in locked",
    });
  const invalidPassword = () =>
    new APIError("UNAUTHORIZED", {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "invalid email or password",
    });
  /** Gerente ou contador sem unidade ativa, depois de provar a credencial (RF02.R1, CA10). */
  const noActiveUnit = () =>
    new APIError("FORBIDDEN", { code: NO_ACTIVE_UNIT, message: "no active unit" });
  const invalidOtp = () =>
    new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "invalid otp" });

  /**
   * Envio do código, fora da requisição: a resposta ao cliente sai antes de qualquer consulta,
   * com o mesmo tempo para e-mail conhecido ou não (RF02.R1). Vínculo ativo e limites (RF02.R4)
   * são conferidos aqui, com a reserva do envio feita sob trava no banco.
   */
  async function sendCodeInBackground(input: {
    email: string;
    type: OtpType;
    ip: string | undefined;
    userAgent: string | undefined;
  }): Promise<void> {
    const user = await store.findUserByEmail(input.email);
    if (user === null || !receivesLoginCode(await store.panelEntry(user.id))) return;
    const now = clock.now();
    const reserved = await store.reserveOtpSend({
      userId: user.id,
      emailHash: hashEmail(input.email),
      ip: input.ip,
      userAgent: input.userAgent,
      decide: (byEmail, byIp) => decideOtpSend(byEmail, byIp, now).allowed,
    });
    if (!reserved) return;
    const headers = new Headers({ [INTERNAL_HEADER]: internalToken });
    if (input.ip !== undefined) headers.set("x-forwarded-for", input.ip);
    if (input.userAgent !== undefined) headers.set("user-agent", input.userAgent);
    await auth.api.sendVerificationOTP({ body: { email: input.email, type: input.type }, headers });
  }

  const auth = betterAuth({
    baseURL: deps.baseUrl,
    basePath: "/api/auth",
    secret: deps.secret,
    trustedOrigins: deps.trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    logger: {
      level: "warn",
      log: (level, message) => deps.log?.(level, message),
    },
    advanced: {
      // Função de id quebra o emailOTP (nota da Task 1, Q1): o `$defaultFn(uuidv7)` gera o id.
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      // Cookie `Secure` (prefixo `__Secure-`) fora de development (RF02.R5).
      useSecureCookies: deps.secureCookies,
    },
    user: { modelName: "users" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    session: {
      modelName: "sessions",
      expiresIn: sessionExpiresAt({ keepConnected: true, now: new Date(0) }).getTime() / 1000,
      updateAge: 60 * 5,
      additionalFields: {
        keepConnected: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    // Limite nativo por IP e rota (ativo só em produção). Folgado de propósito: sem IP real
    // atrás do proxy todos caem no mesmo balde. Os limites de RF02.R4 estão nos ganchos.
    rateLimit: { window: 60, max: 100 },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Link de recuperação (RF03, DD-27): uso único, 30 minutos. O token vai no fragmento da URL,
      // que o navegador não envia ao servidor nem no `Referer`.
      resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS,
      async sendResetPassword({ user, token }) {
        const url = new URL("/redefinir-senha", deps.baseUrl);
        url.hash = `token=${token}`;
        const to = normalizeEmail(user.email);
        deps.background.run(() => deps.email.sendPasswordResetLink({ to, url: url.toString() }));
      },
    },
    databaseHooks: {
      session: {
        create: {
          // "Manter conectado" vem no corpo do login (`rememberMe: true`); padrão é não (RF02.R5).
          async before(session, ctx) {
            // Ponto único da recusa, para TODA criação de sessão (sem olhar o caminho: `ctx` pode
            // vir vazio). Roda só depois de senha ou código certos. O erro sobe ao cliente sem
            // criar linha em `sessions` nem cookie.
            const entry = await store.panelEntry(session.userId);
            if (!canHoldSession(entry)) {
              throw entry.kind === "refused" && entry.reason === "ask_owner"
                ? noActiveUnit()
                : invalidPassword();
            }
            const keepConnected = asBody(ctx?.body)?.rememberMe === true;
            return {
              data: {
                ...session,
                keepConnected,
                expiresAt: sessionExpiresAt({ keepConnected, now: clock.now() }),
              },
            };
          },
        },
        update: {
          // A renovação nativa empurra 30 dias; sem "manter conectado" o teto é 12 h (RF02.R5).
          async before(data, ctx) {
            if (!("expiresAt" in data) || data.expiresAt === undefined) return;
            const current = ctx?.context.session?.session as
              | { keepConnected?: unknown }
              | undefined;
            if (current?.keepConnected === true) return;
            return {
              data: {
                ...data,
                expiresAt: sessionExpiresAt({ keepConnected: false, now: clock.now() }),
              },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = asBody(ctx.body);
        const email = emailOf(body);
        const headers = ctx.headers;
        const audit = { ip: ipOf(headers), userAgent: uaOf(headers) };

        if (ctx.path === SEND_OTP_PATH) {
          // Chamada da própria tarefa em segundo plano: segue para o Better Auth gerar o código.
          if (headers?.get(INTERNAL_HEADER) === internalToken) return;
          const type = body?.type;
          // A recuperação de senha é por link (DD-27): código desse tipo não existe mais.
          if (type === "forget-password") {
            throw new APIError("BAD_REQUEST", { code: "INVALID_REQUEST", message: "invalid type" });
          }
          // Formato inválido: o Better Auth responde 400 sem gerar nada.
          if (email === null || !z.email().safeParse(email).success || !isOtpType(type)) return;
          deps.background.run(() => sendCodeInBackground({ email, type, ...audit }));
          // Mesma resposta, já, em todos os casos: nada aqui depende de o e-mail existir.
          return ctx.json({ success: true });
        }

        if (ctx.path === PASSWORD_SIGN_IN && email !== null && typeof body?.password === "string") {
          const now = clock.now();
          const emailHash = hashEmail(email);
          const user = await store.findUserByEmail(email);
          let attempt: "counted" | "locking" | "unknown";
          if (user === null) {
            // E-mail desconhecido também bloqueia (RF02.R7: o bloqueio não revela se existe).
            const reserved = await store.reserveUnknownPasswordFailure({
              emailHash,
              ...audit,
              since: new Date(now.getTime() - PASSWORD_LOCK_MINUTES * 60 * 1000),
              maxFailures: PASSWORD_MAX_FAILURES,
            });
            if (!reserved.allowed) throw passwordLocked();
            if (reserved.failures === PASSWORD_MAX_FAILURES) {
              await store.recordAudit({ event: "password_locked", emailHash, ...audit });
            }
            attempt = "unknown";
          } else {
            // Só `refused/no_access` é recusado antes de conferir; `ask_owner` segue e é
            // recusado depois da credencial, no gancho de criação da sessão.
            const entry = await store.panelEntry(user.id);
            if (entry.kind === "refused" && entry.reason === "no_access") {
              await store.recordAudit({
                event: "login_failed",
                userId: user.id,
                emailHash,
                ...audit,
              });
              throw invalidPassword();
            }
            // A tentativa conta como erro já na entrada, sob trava: tentativas paralelas não
            // passam juntas do limite. Se a senha estiver certa, o gancho `after` zera.
            const next = await store.updatePasswordStateAtomically(user.id, (state) => {
              if (state.lockedUntil !== null && now.getTime() < state.lockedUntil.getTime()) {
                return null;
              }
              return decidePasswordAttempt(state, "wrong", now).next;
            });
            if (next === null) throw passwordLocked();
            attempt = next.lockedUntil !== null ? "locking" : "counted";
          }
          return {
            context: {
              body: { ...body, email, rememberMe: body.rememberMe === true },
              headers: new Headers({ [ATTEMPT_HEADER]: attempt }),
            },
          };
        }

        if (ctx.path === OTP_SIGN_IN && email !== null) {
          const user = await store.findUserByEmail(email);
          const entry = user === null ? null : await store.panelEntry(user.id);
          if (user !== null && entry?.kind === "refused" && entry.reason === "no_access") {
            await store.recordAudit({
              event: "login_failed",
              userId: user.id,
              emailHash: hashEmail(email),
              ...audit,
            });
            throw invalidOtp();
          }
          return { context: { body: { ...body, email } } };
        }

        const passwordField = SET_PASSWORD_FIELDS[ctx.path];
        if (passwordField !== undefined && typeof body?.[passwordField] === "string") {
          const owner = email ?? (await getSessionFromCtx(ctx).catch(() => null))?.user.email ?? "";
          const checked = validatePassword({
            password: body[passwordField] as string,
            email: normalizeEmail(owner),
          });
          if (!checked.ok) {
            throw new APIError("BAD_REQUEST", {
              code: PASSWORD_ERROR_CODES[checked.error],
              message: "invalid password",
            });
          }
        }

        if (ctx.path === "/sign-out") {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          if (current)
            await store.recordAudit({ event: "logout", userId: current.user.id, ...audit });
        }
        return;
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== PASSWORD_SIGN_IN && ctx.path !== OTP_SIGN_IN) return;
        const email = emailOf(asBody(ctx.body));
        if (email === null) return;
        const returned = ctx.context.returned;
        const failed = isAPIError(returned);
        // Credencial certa, mas sem unidade ativa: a senha estava certa, então o contador zera.
        const refusedNoUnit =
          isAPIError(returned) &&
          (returned.body as { code?: unknown } | undefined)?.code === NO_ACTIVE_UNIT;
        const emailHash = hashEmail(email);
        const audit = { emailHash, ip: ipOf(ctx.headers), userAgent: uaOf(ctx.headers) };
        const signedInUserId = ctx.context.newSession?.user.id;

        if (ctx.path === PASSWORD_SIGN_IN) {
          const attempt = ctx.headers?.get(ATTEMPT_HEADER);
          // E-mail desconhecido já foi auditado na entrada; sem marca, o `before` não contou.
          if (attempt !== "counted" && attempt !== "locking") return;
          const user = await store.findUserByEmail(email);
          if (user === null) return;
          if (refusedNoUnit) {
            await store.updatePasswordState(user.id, { failedAttempts: 0, lockedUntil: null });
            await store.recordAudit({ event: "login_failed", userId: user.id, ...audit });
          } else if (!failed) {
            await store.updatePasswordState(user.id, { failedAttempts: 0, lockedUntil: null });
            await store.recordAudit({ event: "login", userId: user.id, ...audit });
          } else {
            await store.recordAudit({ event: "login_failed", userId: user.id, ...audit });
            if (attempt === "locking") {
              await store.recordAudit({ event: "password_locked", userId: user.id, ...audit });
            }
          }
        } else {
          const userId = signedInUserId ?? (await store.findUserByEmail(email))?.id;
          await store.recordAudit({ event: failed ? "login_failed" : "login", userId, ...audit });
        }
        if (!failed && signedInUserId !== undefined) await store.markLogin(signedInUserId);
      }),
    },
    plugins: [
      signupSessionPlugin(),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        disableSignUp: true,
        storeOTP: "hashed",
        rateLimit: { window: 60, max: 100 },
        // Só a tarefa em segundo plano chega aqui, depois de conferir vínculo e limites.
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (ctx?.headers?.get(INTERNAL_HEADER) !== internalToken) return;
          await deps.email.sendAccessCode({
            to: normalizeEmail(email),
            code: otp,
            purpose: type === "change-email" ? "email-verification" : type,
          });
        },
      }),
    ],
  });
  return auth;
}

/**
 * Sessão aberta fora de uma rota do Better Auth (autocadastro, F1b). Endpoint só de servidor:
 * nunca entra no roteador HTTP, só em `auth.api.openSignupSession`. Cria a sessão pelo
 * adaptador interno (passa pelos `databaseHooks`: sem "manter conectado", 12 h) e grava o
 * cookie assinado igual ao do login sem `rememberMe`.
 */
function signupSessionPlugin() {
  return {
    id: "signup-session",
    endpoints: {
      openSignupSession: createAuthEndpoint.serverOnly(
        { method: "POST", body: z.object({ userId: z.string().min(1) }) },
        async (ctx) => {
          const { internalAdapter } = ctx.context;
          const user = await internalAdapter.findUserById(ctx.body.userId);
          if (user === null) throw new APIError("NOT_FOUND", { message: "user not found" });
          const session = await internalAdapter.createSession(user.id, true);
          await setSessionCookie(ctx, { session, user }, true);
          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

export type Auth = ReturnType<typeof createAuth>;

/** Adapta o Better Auth à porta que a API usa (`AuthGateway`). */
export function createAuthGateway(
  auth: Auth,
  deps: { store: AuthStore; clock: Clock; background: BackgroundTasks },
): AuthGateway {
  const { store, clock, background } = deps;
  return {
    handle: (request) => auth.handler(request),

    async readSession(headers) {
      try {
        const result = await auth.api.getSession({ headers, query: { disableRefresh: true } });
        if (result === null) return null;
        const session: AuthSession = {
          sessionId: result.session.id,
          userId: result.user.id,
          name: result.user.name,
          email: result.user.email,
          keepConnected: result.session.keepConnected === true,
          updatedAt: new Date(result.session.updatedAt),
        };
        return session;
      } catch (error) {
        // Cookie adulterado ou sessão apagada no meio: sem sessão, nunca 500.
        if (isAPIError(error) && error.statusCode < 500) return null;
        throw error;
      }
    },

    async openSession(input) {
      // IP e agente gravados na sessão como no login (o adaptador lê os cabeçalhos da chamada).
      const headers = new Headers();
      if (input.ip !== undefined) headers.set("x-forwarded-for", input.ip);
      if (input.userAgent !== undefined) headers.set("user-agent", input.userAgent);
      const { headers: responseHeaders } = await auth.api.openSignupSession({
        body: { userId: input.userId },
        headers,
        returnHeaders: true,
      });
      return responseHeaders.getSetCookie();
    },

    async hashPassword(password) {
      return (await auth.$context).password.hash(password);
    },

    async verifyPassword({ hash, password }) {
      return (await auth.$context).password.verify({ hash, password });
    },

    async requestPasswordLink(input) {
      // Resolve já, sempre igual: vínculo, limites e envio rodam fora da requisição (RF03.R1).
      background.run(async () => {
        if (!z.email().safeParse(input.email).success) return;
        const user = await store.findUserByEmail(input.email);
        if (user === null || !canHoldSession(await store.panelEntry(user.id))) return;
        const now = clock.now();
        // Mesmos limites do código de acesso (RF02.R4): 60 s, 5/h por e-mail e 20/h por IP.
        const reserved = await store.reserveOtpSend({
          userId: user.id,
          emailHash: hashEmail(input.email),
          ip: input.ip,
          userAgent: input.userAgent,
          decide: (byEmail, byIp) => decideOtpSend(byEmail, byIp, now).allowed,
        });
        if (!reserved) return;
        // Só o link mais recente vale (RF03.R2, DD-30): os anteriores deste usuário morrem aqui.
        await store.deleteResetTokens(user.id);
        await auth.api.requestPasswordReset({ body: { email: input.email } });
      });
    },

    async peekResetToken(token) {
      const found = await (await auth.$context).internalAdapter.findVerificationValue(
        `reset-password:${token}`,
      );
      if (found === null || found.expiresAt.getTime() <= Date.now()) return null;
      return { userId: found.value };
    },

    async resetPasswordWithToken(input) {
      try {
        await auth.api.resetPassword({
          body: { newPassword: input.password, token: input.token },
        });
      } catch (error) {
        if (isAPIError(error) && error.statusCode < 500) throw new ResetTokenError("INVALID_TOKEN");
        throw error;
      }
    },

    async refreshSession(headers) {
      const { headers: responseHeaders } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      return responseHeaders.getSetCookie();
    },
  };
}
