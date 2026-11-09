import { createHash } from "node:crypto";
import { normalizeEmail } from "@app/core";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Código e comprovante só existem no banco como SHA-256 (RF01.R10). */
export const hashSecret = sha256;

/** Mesmo hash de e-mail da auditoria do login (`hashEmail` em infra/auth): minúsculas, sem espaços. */
export const hashSignupEmail = (email: string) => sha256(normalizeEmail(email));

/** Vale 5 min (RF01.R10, RF02.R4). */
export const SIGNUP_CODE_TTL_MS = 5 * 60 * 1000;
/** Comprovante de e-mail verificado: uso único, vale 30 min. */
export const SIGNUP_RECEIPT_TTL_MS = 30 * 60 * 1000;
