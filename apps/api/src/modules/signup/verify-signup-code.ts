import { randomBytes } from "node:crypto";
import { type Clock, err, normalizeEmail, ok, type Result } from "@app/core";
import { hashSecret, hashSignupEmail, SIGNUP_RECEIPT_TTL_MS } from "./signup-hashing";

export interface VerifySignupCodeDeps {
  readonly store: {
    verifyCode(input: {
      email: string;
      codeHash: string;
      now: Date;
      makeReceipt(): { receiptHash: string; expiresAt: Date };
    }): Promise<"ok" | "invalid" | "too_many_attempts">;
  };
  readonly audit: {
    recordAudit(event: {
      event: "signup_verified";
      emailHash?: string;
      ip?: string;
      userAgent?: string;
    }): Promise<void>;
  };
  readonly clock: Clock;
}

export interface VerifySignupCodeInput {
  readonly email: string;
  readonly code: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

/** `invalid_code` cobre código errado, vencido, já usado e e-mail que já tem conta (RF02.R1). */
export type VerifySignupCodeError = "invalid_code" | "too_many_attempts";

export type VerifySignupCode = (
  input: VerifySignupCodeInput,
) => Promise<Result<{ receipt: string }, VerifySignupCodeError>>;

/**
 * `POST /api/signup/verify` (RF01.R10). Acerto devolve um comprovante opaco (32 bytes
 * aleatórios), entregue só nesta resposta; o banco guarda o hash, com validade de 30 min.
 * Não consulta usuários: e-mail com conta tem só a linha `notice`, que responde como código
 * errado e conta tentativas igual.
 */
export function createVerifySignupCode(deps: VerifySignupCodeDeps): VerifySignupCode {
  return async (input) => {
    const email = normalizeEmail(input.email);
    const now = deps.clock.now();
    // Preenchido só no acerto, dentro da transação do store.
    const issued: { receipt?: string } = {};
    const result = await deps.store.verifyCode({
      email,
      codeHash: hashSecret(input.code),
      now,
      makeReceipt() {
        const receipt = randomBytes(32).toString("base64url");
        issued.receipt = receipt;
        return {
          receiptHash: hashSecret(receipt),
          expiresAt: new Date(now.getTime() + SIGNUP_RECEIPT_TTL_MS),
        };
      },
    });
    if (result === "too_many_attempts") return err("too_many_attempts");
    const receipt = issued.receipt;
    if (result !== "ok" || receipt === undefined) return err("invalid_code");
    await deps.audit.recordAudit({
      event: "signup_verified",
      emailHash: hashSignupEmail(email),
      ...(input.ip === undefined ? {} : { ip: input.ip }),
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
    });
    return ok({ receipt });
  };
}
