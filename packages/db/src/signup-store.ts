import { normalizeEmail } from "@app/core";
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { uuidv7 } from "./uuid";

const HOUR_MS = 60 * 60 * 1000;
/** Erros de código aceitos por linha; o 4o pedido já vira `too_many_attempts` (RF01). */
const MAX_CODE_ATTEMPTS = 3;

export type VerifyCodeResult = "ok" | "invalid" | "too_many_attempts";

export interface SignupStore {
  /**
   * Reserva um envio de código ou aviso: com trava por e-mail, lê os envios da última hora
   * (por e-mail e por IP), pergunta a `decide` e, se liberado, grava a linha. A política
   * (limites) fica em `decide`; o armazenamento só serializa e grava.
   */
  reserveSend(input: {
    email: string;
    ip: string | undefined;
    kind: "code" | "notice";
    codeHash: string | null;
    expiresAt: Date;
    decide(byEmail: { sentAt: Date }[], byIp: { sentAt: Date }[]): boolean;
  }): Promise<boolean>;
  /**
   * Confere o código na linha mais recente do e-mail (qualquer `kind`). Cada pedido conta uma
   * tentativa, num único `UPDATE` com guarda; `notice`, linha vencida e linha que já gerou
   * comprovante contam como `invalid`. No acerto grava o comprovante.
   */
  verifyCode(input: {
    email: string;
    codeHash: string;
    now: Date;
    makeReceipt(): { receiptHash: string; expiresAt: Date };
  }): Promise<VerifyCodeResult>;
  /** Consome o comprovante uma única vez: `UPDATE` com guarda, devolve se alterou uma linha. Com `executor` (transação `app_auth` da criação da conta), o consumo desfaz junto se a criação falhar. */
  consumeReceipt(
    input: { email: string; receiptHash: string; now: Date },
    executor?: Database | Transaction,
  ): Promise<boolean>;
  /**
   * Só leitura, barata: o comprovante existe para este e-mail, não venceu e não foi usado
   * (mesmas condições de `consumeReceipt`). Filtro antes do hash de senha (scrypt) numa rota
   * pública; o uso único de verdade continua no `consumeReceipt` dentro da transação.
   */
  isReceiptLive(input: { email: string; receiptHash: string; now: Date }): Promise<boolean>;
}

/**
 * Código e comprovante do autocadastro (papel `app_auth`, tabela global). O relógio vem de
 * fora para as janelas de tempo serem testáveis. Nunca registra e-mail nem código em log.
 */
export function createSignupStore(
  db: Database,
  clock: { now(): Date } = { now: () => new Date() },
): SignupStore {
  return {
    async reserveSend(input) {
      const email = normalizeEmail(input.email);
      const now = clock.now();
      const since = new Date(now.getTime() - HOUR_MS);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`signup:email:${email}`}))`);
        const toSends = (rows: { sent_at: Date | string }[]) =>
          rows.map((r) => ({ sentAt: new Date(r.sent_at) }));
        const byEmail = await tx.execute<{ sent_at: Date | string }>(
          sql`select created_at as sent_at from signup_verifications where email = ${email} and created_at >= ${since}`,
        );
        const byIp =
          input.ip === undefined
            ? []
            : (
                await tx.execute<{ sent_at: Date | string }>(
                  sql`select created_at as sent_at from signup_verifications where ip = ${input.ip} and created_at >= ${since}`,
                )
              ).rows;
        if (!input.decide(toSends(byEmail.rows), toSends(byIp))) return false;
        await tx.execute(
          sql`insert into signup_verifications (id, email, kind, code_hash, ip, expires_at, created_at)
              values (${uuidv7()}, ${email}, ${input.kind}, ${input.codeHash}, ${input.ip ?? null}, ${input.expiresAt}, ${now})`,
        );
        return true;
      });
    },

    async verifyCode(input) {
      const email = normalizeEmail(input.email);
      return db.transaction(async (tx) => {
        // Serializa por e-mail para "a linha mais recente" não mudar entre achar e atualizar.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`signup:email:${email}`}))`);
        const latest = sql`(select id from signup_verifications where email = ${email} order by created_at desc, id desc limit 1)`;
        const bumped = await tx.execute<{
          kind: string;
          code_hash: string | null;
          live: boolean;
          receipt_hash: string | null;
          consumed_at: unknown;
        }>(
          sql`update signup_verifications set attempts = attempts + 1
              where id = ${latest} and attempts < ${MAX_CODE_ATTEMPTS}
              returning kind, code_hash, (expires_at > ${input.now}) as live, receipt_hash, consumed_at`,
        );
        const row = bumped.rows[0];
        if (row === undefined) {
          const exists = await tx.execute(
            sql`select 1 from signup_verifications where id = ${latest}`,
          );
          return exists.rows.length > 0 ? "too_many_attempts" : "invalid";
        }
        const valid =
          row.kind === "code" &&
          row.code_hash === input.codeHash &&
          row.live &&
          row.receipt_hash === null &&
          row.consumed_at === null;
        if (!valid) return "invalid";
        const receipt = input.makeReceipt();
        await tx.execute(
          sql`update signup_verifications
              set receipt_hash = ${receipt.receiptHash}, receipt_expires_at = ${receipt.expiresAt}
              where id = ${latest} and receipt_hash is null`,
        );
        return "ok";
      });
    },

    async isReceiptLive(input) {
      const result = await db.execute(
        sql`select 1 from signup_verifications
            where email = ${normalizeEmail(input.email)} and receipt_hash = ${input.receiptHash}
              and consumed_at is null and receipt_expires_at > ${input.now}
            limit 1`,
      );
      return result.rows.length === 1;
    },

    async consumeReceipt(input, executor = db) {
      const result = await executor.execute(
        sql`update signup_verifications set consumed_at = ${input.now}
            where email = ${normalizeEmail(input.email)} and receipt_hash = ${input.receiptHash}
              and consumed_at is null and receipt_expires_at > ${input.now}
            returning id`,
      );
      return result.rows.length === 1;
    },
  };
}
