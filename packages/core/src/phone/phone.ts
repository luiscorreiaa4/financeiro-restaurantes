import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";

export interface BrazilianPhone {
  /** Forma canônica E.164, com o 9º dígito nos celulares: "+5511987654321". */
  readonly e164: string;
  readonly kind: "mobile" | "landline";
  /** Celular com o 9; igual a `e164` para fixo. É o formato aceito no envio. */
  readonly withNinthDigit: string;
  /** Celular sem o 9 (como o webhook da Meta costuma entregar); igual a `e164` para fixo. */
  readonly withoutNinthDigit: string;
  /** Formatos para buscar o usuário no banco (canônico primeiro, sem repetição). */
  readonly lookupCandidates: readonly string[];
}

type PhoneError = Extract<DomainError, { code: "InvalidPhone" }>;

/**
 * Normaliza telefone brasileiro (qualquer formato digitado, `wa_id` da Meta, E.164).
 *
 * Regras (número nacional = DDD de 2 dígitos + assinante):
 * - assinante de 9 dígitos começando com 9 → celular;
 * - assinante de 8 dígitos começando com 6 a 9 → celular antigo sem o 9: o canônico
 *   acrescenta o 9 (caso real: o webhook entrega 551187654321 e o envio exige 5511987654321);
 * - assinante de 8 dígitos começando com 2 a 5 → fixo, sem variante com 9.
 * Aceita "+", espaços, parênteses, hífen, "00" e zero de tronco antes do DDD,
 * com ou sem o 55.
 */
export function normalizeBrazilianPhone(input: string): Result<BrazilianPhone, PhoneError> {
  let digits = input.replace(/\D/g, "");
  if (digits === "") return fail("InvalidPhone", { reason: "empty" });

  // "00" internacional e zero de tronco: nem o DDD nem o 55 começam com zero.
  digits = digits.replace(/^0+/, "");
  if (digits.length === 12 || digits.length === 13) {
    if (!digits.startsWith("55")) return fail("InvalidPhone", { reason: "length" });
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) {
    return fail("InvalidPhone", { reason: "length" });
  }

  const areaCode = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  if (!/^[1-9][1-9]$/.test(areaCode)) return fail("InvalidPhone", { reason: "area_code" });

  const prefix = `+55${areaCode}`;
  if (subscriber.length === 9) {
    if (!subscriber.startsWith("9")) return fail("InvalidPhone", { reason: "number" });
    return ok(mobile(prefix, subscriber.slice(1)));
  }
  if (/^[6-9]/.test(subscriber)) return ok(mobile(prefix, subscriber));
  if (/^[2-5]/.test(subscriber)) {
    const e164 = `${prefix}${subscriber}`;
    return ok({
      e164,
      kind: "landline",
      withNinthDigit: e164,
      withoutNinthDigit: e164,
      lookupCandidates: [e164],
    });
  }
  return fail("InvalidPhone", { reason: "number" });
}

function mobile(prefix: string, eightDigits: string): BrazilianPhone {
  const withNinthDigit = `${prefix}9${eightDigits}`;
  const withoutNinthDigit = `${prefix}${eightDigits}`;
  return {
    e164: withNinthDigit,
    kind: "mobile",
    withNinthDigit,
    withoutNinthDigit,
    lookupCandidates: [withNinthDigit, withoutNinthDigit],
  };
}

/** `wa_id` da Meta: E.164 sem o "+". */
export function toWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}
