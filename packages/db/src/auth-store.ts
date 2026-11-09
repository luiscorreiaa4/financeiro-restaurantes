import { and, count, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { type AUTH_EVENTS, authAudit, memberships, sessions, users } from "../schema";
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
  };
}
