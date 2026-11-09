import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccessCodeMessage, EmailSender } from "@app/core";
import { uuidv7 } from "@app/db";
import { accountExistsText } from "./email-texts";

function bodyOf(message: AccessCodeMessage) {
  if (message.purpose === "account-exists") {
    return {
      to: message.to,
      purpose: message.purpose,
      loginUrl: message.loginUrl,
      text: accountExistsText(message.loginUrl),
    };
  }
  return { to: message.to, code: message.code, purpose: message.purpose };
}

/**
 * Só desenvolvimento: grava um JSON por e-mail em `dir` (é assim que o dev lê o código).
 * Nunca escreve no logger. A composição recusa este adaptador com NODE_ENV=production.
 */
export function createFileEmailSender(dir: string): EmailSender {
  return {
    async sendAccessCode(message) {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `${Date.now()}-${uuidv7()}.json`),
        JSON.stringify(bodyOf(message), null, 2),
      );
    },
  };
}
