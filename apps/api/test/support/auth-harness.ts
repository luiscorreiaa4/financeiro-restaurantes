import { createHash } from "node:crypto";
import {
  createAuthStore,
  createDatabase,
  createPanelAccessStore,
  createPool,
  seedDevData,
  uuidv7,
} from "@app/db";
import { startTestDatabase, type TestDatabase } from "@app/db/testing";
import { hashPassword } from "better-auth/crypto";
import type { LightMyRequestResponse } from "fastify";
import { expect, vi } from "vitest";
import { buildApp } from "../../src/app";
import { createBackgroundTasks } from "../../src/infra/auth/background-tasks";
import { createAuth, createAuthGateway } from "../../src/infra/auth/create-auth";
import { createSystemClock } from "../../src/infra/clock";
import { createMemoryEmailSender } from "../../src/infra/email/memory-email-sender";
import {
  createCheckEntry,
  createCheckSession,
  createSessionBlocked,
} from "../../src/modules/auth/check-session";
import { createProfileService } from "../../src/modules/profile/profile-service";
import {
  createRecoverPassword,
  createRequestRecoveryLink,
} from "../../src/modules/recovery/recover-password";

export const ORIGIN = "http://localhost:3000";
const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
export const START = new Date("2026-11-09T12:00:00.000Z");
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Fora de `development` o cookie é `Secure` e leva o prefixo `__Secure-`. */
export const SESSION_COOKIE = "__Secure-better-auth.session_token=";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers["set-cookie"];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

export interface AuthHarness {
  db: TestDatabase;
  authPool: ReturnType<typeof createPool>;
  appPool: ReturnType<typeof createPool>;
  app: ReturnType<typeof buildApp>;
  gateway: ReturnType<typeof createAuthGateway>;
  email: ReturnType<typeof createMemoryEmailSender>;
  tasks: ReturnType<typeof createBackgroundTasks>;
  logLines: string[];
  origin: string;
  clock: {
    /** O Better Auth usa `Date` internamente (vencimento do código e da sessão): só `Date` é falso. */
    advance(ms: number): void;
    /** Volta o relógio para `START`. */
    reset(): void;
  };
  /** Limpa tabelas, o e-mail em memória e o contador de IP; devolve o relógio para `START`. */
  reset(): Promise<void>;
  /** Fecha app, pool e banco, e volta os timers ao normal. */
  stop(): Promise<void>;
  createUser(options?: {
    password?: string;
    membership?: "active" | "deactivated";
    role?: "owner" | "manager" | "accountant";
    withUnit?: boolean;
    email?: string;
  }): Promise<{ userId: string; email: string }>;
  post(url: string, body: unknown, cookie?: string, ip?: string): Promise<LightMyRequestResponse>;
  requestCode(address: string, ip?: string): Promise<LightMyRequestResponse>;
  requestCodeOnly(address: string, ip?: string): Promise<LightMyRequestResponse>;
  signInCode(address: string, otp: string, rememberMe?: boolean): Promise<LightMyRequestResponse>;
  signInPassword(
    address: string,
    password: string,
    rememberMe?: boolean,
  ): Promise<LightMyRequestResponse>;
  lastCode(): string;
  sessionCookie(response: LightMyRequestResponse): string;
  me(cookie?: string): Promise<LightMyRequestResponse>;
  loginWithCode(address: string, rememberMe?: boolean): Promise<string>;
  seedDev(): Promise<void>;
}

export async function startAuthHarness(): Promise<AuthHarness> {
  const db = await startTestDatabase();
  const authPool = createPool(db.urls.auth);
  const appPool = createPool(db.urls.app);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  const clock = createSystemClock();
  const store = createAuthStore(createDatabase(authPool), clock);
  const email = createMemoryEmailSender();
  const tasks = createBackgroundTasks({ onError: () => undefined, onDrop: () => undefined });
  const auth = createAuth({
    pool: authPool,
    store,
    email,
    clock,
    secret: SECRET,
    baseUrl: ORIGIN,
    trustedOrigins: [ORIGIN],
    secureCookies: true,
    background: tasks,
  });
  const gateway = createAuthGateway(auth, { store, clock, background: tasks });
  const logLines: string[] = [];
  const checkSession = createCheckSession({ gateway, access: store, clock });
  const checkEntry = createCheckEntry({ gateway, access: store, clock });
  const app = buildApp(
    { LOG_LEVEL: "debug", APP_URL: ORIGIN },
    {
      auth: {
        gateway,
        checkSession,
        sessionBlocked: createSessionBlocked({ gateway, access: store }),
        secure: true,
      },
      recovery: {
        recover: createRecoverPassword({ store, gateway, email, background: tasks, clock }),
        requestLink: createRequestRecoveryLink({ gateway }),
      },
      profile: {
        checkSession,
        service: createProfileService({ store, gateway, email, background: tasks, clock }),
      },
      panel: {
        checkSession,
        checkEntry,
        access: createPanelAccessStore(createDatabase(authPool)),
        appDb: createDatabase(appPool),
        secure: true,
      },
      logStream: { write: (line) => logLines.push(line) },
    },
  );

  let ipCounter = 0;
  let userCounter = 0;

  const currentIp = () => `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;

  const post = (url: string, body: unknown, cookie?: string, ip = currentIp()) =>
    app.inject({
      method: "POST",
      url,
      remoteAddress: ip,
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": "vitest",
        ...(cookie ? { cookie } : {}),
      },
      payload: JSON.stringify(body),
    });

  const requestCodeOnly = (address: string, ip?: string) =>
    post(
      "/api/auth/email-otp/send-verification-otp",
      { email: address, type: "sign-in" },
      undefined,
      ip,
    );

  /** Pede o código e espera o envio, que roda fora da requisição (tempo igual para todos). */
  const requestCode = async (address: string, ip?: string) => {
    const response = await requestCodeOnly(address, ip);
    await tasks.drain();
    return response;
  };

  const signInCode = (address: string, otp: string, rememberMe?: boolean) =>
    post("/api/auth/sign-in/email-otp", { email: address, otp, rememberMe });

  const signInPassword = (address: string, password: string, rememberMe?: boolean) =>
    post("/api/auth/sign-in/email", { email: address, password, rememberMe });

  const lastCode = (): string => {
    const last = email.sent.at(-1);
    if (!last || !("code" in last)) throw new Error("nenhum código enviado");
    return last.code;
  };

  /** `nome=valor` do cookie de sessão, pronto para o cabeçalho `cookie`. */
  const sessionCookie = (response: LightMyRequestResponse): string => {
    const found = setCookies(response).find((c) => c.startsWith(SESSION_COOKIE));
    if (!found) throw new Error("sem cookie de sessão");
    return found.split(";")[0] as string;
  };

  const me = (cookie?: string) =>
    app.inject({
      method: "GET",
      url: "/api/me",
      headers: cookie ? { cookie } : {},
    });

  const loginWithCode = async (address: string, rememberMe?: boolean) => {
    expect((await requestCode(address)).statusCode).toBe(200);
    const response = await signInCode(address, lastCode(), rememberMe);
    expect(response.statusCode).toBe(200);
    return sessionCookie(response);
  };

  /** Usuário com e-mail verificado e vínculo (dono) num tenant novo, criado pelo admin. */
  const createUser = async (
    options: {
      password?: string;
      membership?: "active" | "deactivated";
      role?: "owner" | "manager" | "accountant";
      withUnit?: boolean;
      email?: string;
    } = {},
  ) => {
    userCounter += 1;
    const address = options.email ?? `pessoa${userCounter}.${uuidv7().slice(-6)}@ex.com`;
    const userId = uuidv7();
    const tenantId = uuidv7();
    await db.admin.query("insert into tenants (id, name) values ($1, 'Restaurante')", [tenantId]);
    // O painel exige ao menos uma unidade ativa (DD-31): sem ela o vínculo não abre o login.
    if (options.withUnit !== false) {
      await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
        uuidv7(),
        tenantId,
      ]);
    }
    await db.admin.query(
      "insert into users (id, name, email, email_verified) values ($1, 'Pessoa', $2, true)",
      [userId, address],
    );
    const status = options.membership ?? "active";
    await db.admin.query(
      `insert into memberships (id, tenant_id, user_id, role, all_units, status, deactivated_at)
     values ($1, $2, $3, $6, true, $4, $5)`,
      [
        uuidv7(),
        tenantId,
        userId,
        status,
        status === "deactivated" ? new Date() : null,
        options.role ?? "owner",
      ],
    );
    if (options.password !== undefined) {
      await db.admin.query(
        `insert into accounts (id, account_id, provider_id, user_id, password)
       values ($1, $2::text, 'credential', $2::uuid, $3)`,
        [uuidv7(), userId, await hashPassword(options.password)],
      );
    }
    return { userId, email: address };
  };

  return {
    db,
    authPool,
    appPool,
    app,
    gateway,
    email,
    tasks,
    logLines,
    origin: ORIGIN,
    clock: {
      advance(ms: number) {
        vi.setSystemTime(new Date(Date.now() + ms));
      },
      reset() {
        vi.setSystemTime(START);
      },
    },
    async reset() {
      vi.setSystemTime(START);
      await db.admin.query("truncate auth_audit, verifications, sessions");
      (email.sent as unknown[]).length = 0;
      (email.sentLinks as unknown[]).length = 0;
      (email.sentNotices as unknown[]).length = 0;
      ipCounter += 1;
    },
    async stop() {
      vi.useRealTimers();
      await app?.close();
      await authPool?.end();
      await appPool?.end();
      await db?.stop();
    },
    createUser,
    post,
    requestCode,
    requestCodeOnly,
    signInCode,
    signInPassword,
    lastCode,
    sessionCookie,
    me,
    loginWithCode,
    async seedDev() {
      await seedDevData(createDatabase(db.admin), "development");
    },
  };
}
