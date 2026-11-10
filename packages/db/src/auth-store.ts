import { and, count, desc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { type AUTH_EVENTS, accounts, authAudit, memberships, sessions, users } from "../schema";
import type { Database, Transaction } from "./client";
import { uuidv7 } from "./uuid";

export type AuthEvent = (typeof AUTH_EVENTS)[number];

const HOUR_MS = 60 * 60 * 1000;

/** Envios de código (`otp_sent`) desde `since`, pelo hash do e-mail e pelo IP. */
async function recentSends(
  db: Database | Transaction,
  emailHash: string,
  ip: string | undefined,
  since: Date,
): Promise<{ byEmail: { sentAt: Date }[]; byIp: { sentAt: Date }[] }> {
  const sent = (filter: ReturnType<typeof eq>) =>
    db
      .select({ sentAt: authAudit.createdAt })
      .from(authAudit)
      .where(and(eq(authAudit.event, "otp_sent"), filter, gte(authAudit.createdAt, since)));
  const byEmail = await sent(eq(authAudit.emailHash, emailHash));
  const byIp = ip === undefined ? [] : await sent(eq(authAudit.ip, ip));
  return { byEmail, byIp };
}

/** Papéis que entram no painel mesmo sem `panel_access` (o Dono libera o painel só ao lançador). */
const PANEL_ROLES = ["owner", "manager", "accountant"];

export interface AuthUserState {
  id: string;
  passwordLockedUntil: Date | null;
  failedPasswordAttempts: number;
}

export interface AuthStore {
  /** Existe vínculo ativo com acesso ao painel (RF02.R1). */
  hasActiveMembership(userId: string): Promise<boolean>;
  /** `email` já normalizado (minúsculas, sem espaços nas pontas). */
  findUserByEmail(email: string): Promise<AuthUserState | null>;
  /** Usuário pelo id (link de recuperação, RF03); `email` como está no cadastro (minúsculas; null em quem não tem e-mail). */
  findUserById(userId: string): Promise<{ id: string; email: string | null } | null>;
  /** Celular do usuário em E.164; `null` sem celular (contador convidado por e-mail, DD-20). */
  findUserPhone(userId: string): Promise<string | null>;
  recordAudit(event: {
    event: AuthEvent;
    userId?: string;
    emailHash?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void>;
  /** Envios de código (`otp_sent`) desde `since`, pelo e-mail e pelo IP. */
  recentOtpSends(
    emailHash: string,
    ip: string | undefined,
    since: Date,
  ): Promise<{ byEmail: { sentAt: Date }[]; byIp: { sentAt: Date }[] }>;
  /**
   * Reserva um envio de código: com trava por e-mail e por IP, conta os envios da última hora,
   * pergunta a `decide` e, se liberado, grava `otp_sent` na mesma transação. Pedidos paralelos
   * não passam juntos do limite (RF02.R4).
   */
  reserveOtpSend(input: {
    userId: string;
    emailHash: string;
    ip: string | undefined;
    userAgent: string | undefined;
    decide(byEmail: { sentAt: Date }[], byIp: { sentAt: Date }[]): boolean;
  }): Promise<boolean>;
  /**
   * Tentativa de senha de e-mail **desconhecido**: com trava no hash, recusa se já houver
   * `maxFailures` erros desde `since`; senão grava o `login_failed` e devolve o total.
   */
  reserveUnknownPasswordFailure(input: {
    emailHash: string;
    ip: string | undefined;
    userAgent: string | undefined;
    since: Date;
    maxFailures: number;
  }): Promise<{ allowed: false } | { allowed: true; failures: number }>;
  /**
   * Lê e grava o estado da senha do usuário com `SELECT ... FOR UPDATE`: `step` recebe o estado
   * atual e devolve o próximo, ou `null` para não mudar nada. Devolve o que `step` devolveu.
   */
  updatePasswordStateAtomically(
    userId: string,
    step: (state: {
      failedAttempts: number;
      lockedUntil: Date | null;
    }) => { failedAttempts: number; lockedUntil: Date | null } | null,
  ): Promise<{ failedAttempts: number; lockedUntil: Date | null } | null>;
  updatePasswordState(
    userId: string,
    state: { failedAttempts: number; lockedUntil: Date | null },
  ): Promise<void>;
  markLogin(userId: string): Promise<void>;
  /** Renova o uso da sessão (RF02.R5); o Better Auth só a lê. */
  touchSession(sessionId: string, state: { updatedAt: Date; expiresAt: Date }): Promise<void>;
  /** Hash da senha (conta `credential`); `null` se o usuário não tem senha. */
  getPasswordHash(userId: string): Promise<string | null>;
  /** Troca o hash da conta `credential` existente; `false` se o usuário não tem conta de senha. */
  setPasswordHash(userId: string, hash: string): Promise<boolean>;
  /** Sessões ainda válidas em `now`, da mais recente para a mais antiga; nunca devolve o token. */
  listSessions(
    userId: string,
    now: Date,
  ): Promise<{ id: string; userAgent: string | null; updatedAt: Date }[]>;
  /** Apaga as sessões do usuário menos `keepSessionId` (`null` apaga todas); devolve quantas. */
  deleteSessionsExcept(userId: string, keepSessionId: string | null): Promise<number>;
  updateUserName(userId: string, name: string): Promise<void>;
}

/**
 * Consultas de acesso do papel `app_auth` (sem `app.tenant_id`). O relógio vem de fora para
 * as janelas de tempo (limite de envio, bloqueio) serem testáveis.
 */
export function createAuthStore(
  db: Database,
  clock: { now(): Date } = { now: () => new Date() },
): AuthStore {
  return {
    async hasActiveMembership(userId) {
      const rows = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, "active"),
            isNull(memberships.deactivatedAt),
            or(eq(memberships.panelAccess, true), inArray(memberships.role, PANEL_ROLES)),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async findUserByEmail(email) {
      const rows = await db
        .select({
          id: users.id,
          passwordLockedUntil: users.passwordLockedUntil,
          failedPasswordAttempts: users.failedPasswordAttempts,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserById(userId) {
      const rows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserPhone(userId) {
      const rows = await db
        .select({ phoneE164: users.phoneE164 })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.phoneE164 ?? null;
    },

    async recordAudit(event) {
      await db.insert(authAudit).values({
        id: uuidv7(),
        event: event.event,
        userId: event.userId ?? null,
        emailHash: event.emailHash ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        createdAt: clock.now(),
      });
    },

    async recentOtpSends(emailHash, ip, since) {
      return recentSends(db, emailHash, ip, since);
    },

    async reserveOtpSend(input) {
      const now = clock.now();
      return db.transaction(async (tx) => {
        // Ordem fixa (e-mail, depois IP): duas transações nunca se esperam em ciclo.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`otp:email:${input.emailHash}`}))`,
        );
        if (input.ip !== undefined) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`otp:ip:${input.ip}`}))`);
        }
        const since = new Date(now.getTime() - HOUR_MS);
        const sends = await recentSends(tx, input.emailHash, input.ip, since);
        if (!input.decide(sends.byEmail, sends.byIp)) return false;
        await tx.insert(authAudit).values({
          id: uuidv7(),
          event: "otp_sent",
          userId: input.userId,
          emailHash: input.emailHash,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          createdAt: now,
        });
        return true;
      });
    },

    async reserveUnknownPasswordFailure(input) {
      const now = clock.now();
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pwd:${input.emailHash}`}))`);
        const rows = await tx
          .select({ n: count() })
          .from(authAudit)
          .where(
            and(
              eq(authAudit.event, "login_failed"),
              eq(authAudit.emailHash, input.emailHash),
              gte(authAudit.createdAt, input.since),
            ),
          );
        const failures = rows[0]?.n ?? 0;
        if (failures >= input.maxFailures) return { allowed: false as const };
        await tx.insert(authAudit).values({
          id: uuidv7(),
          event: "login_failed",
          emailHash: input.emailHash,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          createdAt: now,
        });
        return { allowed: true as const, failures: failures + 1 };
      });
    },

    async updatePasswordStateAtomically(userId, step) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({
            failedAttempts: users.failedPasswordAttempts,
            lockedUntil: users.passwordLockedUntil,
          })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        const current = rows[0];
        if (current === undefined) return null;
        const next = step(current);
        if (next === null) return null;
        await tx
          .update(users)
          .set({
            failedPasswordAttempts: next.failedAttempts,
            passwordLockedUntil: next.lockedUntil,
            updatedAt: clock.now(),
          })
          .where(eq(users.id, userId));
        return next;
      });
    },

    async updatePasswordState(userId, state) {
      await db
        .update(users)
        .set({
          failedPasswordAttempts: state.failedAttempts,
          passwordLockedUntil: state.lockedUntil,
          updatedAt: clock.now(),
        })
        .where(eq(users.id, userId));
    },

    async markLogin(userId) {
      const now = clock.now();
      await db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, userId));
    },

    async touchSession(sessionId, state) {
      await db
        .update(sessions)
        .set({ updatedAt: state.updatedAt, expiresAt: state.expiresAt })
        .where(eq(sessions.id, sessionId));
    },

    async getPasswordHash(userId) {
      const rows = await db
        .select({ password: accounts.password })
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
        .limit(1);
      return rows[0]?.password ?? null;
    },

    async setPasswordHash(userId, hash) {
      const rows = await db
        .update(accounts)
        .set({ password: hash, updatedAt: clock.now() })
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
        .returning({ id: accounts.id });
      return rows.length > 0;
    },

    async listSessions(userId, now) {
      return db
        .select({ id: sessions.id, userAgent: sessions.userAgent, updatedAt: sessions.updatedAt })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
        .orderBy(desc(sessions.updatedAt));
    },

    async deleteSessionsExcept(userId, keepSessionId) {
      const rows = await db
        .delete(sessions)
        .where(
          keepSessionId === null
            ? eq(sessions.userId, userId)
            : and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)),
        )
        .returning({ id: sessions.id });
      return rows.length;
    },

    async updateUserName(userId, name) {
      await db.update(users).set({ name, updatedAt: clock.now() }).where(eq(users.id, userId));
    },
  };
}
