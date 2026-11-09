import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmailSender } from "@app/core";
import { uuidv7 } from "@app/db";

/**
 * Só desenvolvimento: grava um JSON por e-mail em `dir` (é assim que o dev lê o código).
 * Nunca escreve no logger. A composição recusa este adaptador com NODE_ENV=production.
 */
export function createFileEmailSender(dir: string): EmailSender {
  return {
    async sendAccessCode(message) {
      await mkdir(dir, { recursive: true });
      const body = { to: message.to, code: message.code, purpose: message.purpose };
      await writeFile(join(dir, `${Date.now()}-${uuidv7()}.json`), JSON.stringify(body, null, 2));
    },
  };
}
