import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { EXPORT_LINK_TTL_SECONDS } from "@app/core/contracts";

export type ExportLinkInput = { exportId: string; userId: string; tenantId: string };

export type ExportLinkSigner = {
  issue(input: ExportLinkInput): { token: string; expiresAt: Date };
  verify(token: string, input: ExportLinkInput): boolean;
};

const VERSION = "export-link-v1";
const MAC_HEX_LENGTH = 64; // HMAC-SHA256 em hexadecimal
const MAX_TOKEN_LENGTH = 256; // o token legítimo tem uns 90 caracteres
const EPOCH_PATTERN = /^\d{1,15}$/;
const MAC_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Token de curta duração do link de download (RF29.R5). O token carrega só a expiração e o HMAC;
 * os ids vêm da rota e entram apenas na assinatura. O relógio é injetado.
 */
export function createExportLinkSigner(secret: string, clock: { now(): Date }): ExportLinkSigner {
  if (secret.length === 0) {
    throw new Error("Segredo do link de exportação vazio");
  }
  // A força mínima do AUTH_SECRET é validada na configuração, não aqui.
  const key = Buffer.from(hkdfSync("sha256", secret, "", "export-link", 32));

  // JSON de array: aspas e escapes delimitam cada campo sem ambiguidade, mesmo que um id contenha
  // separadores; a versão fixa evita reaproveitar a assinatura em outro contexto.
  function sign(input: ExportLinkInput, expiresAtEpoch: number): string {
    const payload = JSON.stringify([
      VERSION,
      input.exportId,
      input.userId,
      input.tenantId,
      expiresAtEpoch,
    ]);
    return createHmac("sha256", key).update(payload).digest("hex");
  }

  return {
    issue(input) {
      const expiresAtEpoch = Math.floor(clock.now().getTime() / 1000) + EXPORT_LINK_TTL_SECONDS;
      const token = Buffer.from(
        `${expiresAtEpoch}.${sign(input, expiresAtEpoch)}`,
        "utf8",
      ).toString("base64url");
      return { token, expiresAt: new Date(expiresAtEpoch * 1000) };
    },

    verify(token, input) {
      try {
        if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
        const parts = Buffer.from(token, "base64url").toString("utf8").split(".");
        if (parts.length !== 2) return false;
        const [epochText, mac] = parts as [string, string];
        if (!EPOCH_PATTERN.test(epochText) || !MAC_PATTERN.test(mac)) return false;
        const expiresAtEpoch = Number(epochText);
        if (!Number.isSafeInteger(expiresAtEpoch)) return false;

        const expected = Buffer.from(sign(input, expiresAtEpoch), "utf8");
        const received = Buffer.from(mac, "utf8");
        if (received.length !== MAC_HEX_LENGTH || expected.length !== received.length) return false;
        if (!timingSafeEqual(expected, received)) return false;

        return clock.now().getTime() <= expiresAtEpoch * 1000;
      } catch {
        return false;
      }
    },
  };
}
