import type { Err } from "./result";
import { err } from "./result";

/**
 * Erros de domínio nomeados. Cada um tem um `code` estável; a mensagem em pt-BR
 * para o usuário é escrita fora do core (mapeamento `code` → texto).
 * Exceções ficam reservadas para falhas de infraestrutura.
 */
export type DomainError =
  | { readonly code: "AmountMissing" }
  | { readonly code: "AmountNotPositive" }
  | { readonly code: "InvalidAmount"; readonly value: number }
  | { readonly code: "MoneyOverflow" }
  | { readonly code: "InvalidFeeRate"; readonly value: number }
  | { readonly code: "FeeExceedsAmount"; readonly feeCents: number; readonly amountCents: number }
  | {
      readonly code: "AmountInconsistent";
      readonly computedCents: number;
      readonly statedCents: number;
    }
  | { readonly code: "InvalidQuantity"; readonly value: number }
  | { readonly code: "InvalidBusinessDate"; readonly value: string }
  | { readonly code: "InvalidId"; readonly value: string }
  | { readonly code: "OriginMissing" }
  | { readonly code: "EntryDeleted" }
  | { readonly code: "EntryAlreadyDeleted" }
  | { readonly code: "NothingToChange" }
  | { readonly code: "PermissionDenied"; readonly role: string; readonly action: string }
  | { readonly code: "InvalidPhone"; readonly reason: "empty" | "length" | "area_code" | "number" }
  | { readonly code: "DuplicateMessage"; readonly waMessageId: string }
  | { readonly code: "ExtractionInvalid"; readonly detail: string }
  | { readonly code: "LlmRefused" }
  | { readonly code: "SendFailed"; readonly detail: string };

export type DomainErrorCode = DomainError["code"];

type ErrorOf<C extends DomainErrorCode> = Extract<DomainError, { code: C }>;

/** Atalho: `fail("AmountMissing")` ou `fail("InvalidAmount", { value })`. */
export function fail<C extends DomainErrorCode>(
  code: C,
  ...detail: keyof Omit<ErrorOf<C>, "code"> extends never ? [] : [Omit<ErrorOf<C>, "code">]
): Err<ErrorOf<C>> {
  return err({ code, ...(detail[0] ?? {}) } as ErrorOf<C>);
}
