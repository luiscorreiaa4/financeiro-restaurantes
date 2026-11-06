import type { DomainError } from "../errors/domain-errors";
import { fail } from "../errors/domain-errors";
import type { Result } from "../errors/result";
import { ok } from "../errors/result";
import { computeFee, type Money } from "../money";
import type { BusinessDate } from "./business-date";
import { isBusinessDate, isUuidV7 } from "./business-date";
import type { EntryFlag } from "./interpret";
import { quantityToMilli } from "./quantity";

export type EntryType = "expense" | "revenue";
export type Channel = "whatsapp" | "web" | "import" | "email" | "system";
export type VersionAction = "create" | "update" | "delete" | "restore";

/** Campos editáveis de um lançamento. A taxa é guardada como regra para poder recalcular. */
export interface EntryFields {
  readonly unitId: string;
  readonly type: EntryType;
  readonly occurredOn: BusinessDate;
  /** Data de pagamento ou recebimento; igual à de competência por padrão (RF12.R21, DD-02). */
  readonly paidOn: BusinessDate;
  readonly description: string;
  readonly quantity: number | null;
  readonly quantityUnit: string | null;
  /** Pedidos da receita (RF12.R22, DD-13). */
  readonly orders: number | null;
  readonly amountCents: Money;
  readonly feePercentBp: number;
  readonly feeFixedCents: number;
  readonly categoryId: string | null;
  readonly supplierId: string | null;
  readonly paymentMethodId: string | null;
  readonly salesChannelId: string | null;
}

/** Entrada para criar um lançamento: campos + origem. Taxa e líquido são calculados aqui. */
export interface EntryDraft extends Omit<EntryFields, "paidOn" | "orders"> {
  /** Padrão: a data de competência. */
  readonly paidOn?: BusinessDate | null;
  readonly orders?: number | null;
  /** Obrigatório quando o canal é `whatsapp` (regra 5: todo lançamento guarda a origem). */
  readonly inboundMessageId: string | null;
  /** Sinais de revisão (RF12.R13); não impedem a gravação. */
  readonly flags?: readonly EntryFlag[];
}

export interface Entry extends EntryFields {
  readonly id: string;
  readonly tenantId: string;
  readonly feeCents: Money;
  readonly netCents: Money;
  readonly inboundMessageId: string | null;
  readonly flags: readonly EntryFlag[];
  readonly confirmationWaMessageId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /** Quem excluiu, o motivo e até quando é restaurável (RF24). */
  readonly deletedBy: string | null;
  readonly deleteReason: string | null;
  readonly restorableUntil: BusinessDate | null;
  readonly version: number;
}

/** A lixeira guarda o lançamento restaurável por 30 dias (RF24.R2). */
export const RESTORE_WINDOW_DAYS = 30;
const DELETE_REASON_MAX = 200;

export interface ChangeContext {
  readonly actorId: string;
  readonly channel: Channel;
  readonly at: Date;
}

/** Registro de `entry_versions`: quem, quando, canal, antes e depois. */
export interface EntryVersion {
  readonly entryId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly action: VersionAction;
  readonly before: Entry | null;
  readonly after: Entry;
  readonly changedBy: string;
  readonly channel: Channel;
  readonly changedAt: Date;
}

export interface EntryChange {
  readonly entry: Entry;
  readonly version: EntryVersion;
}

type EntryError = Extract<
  DomainError,
  {
    code:
      | "AmountNotPositive"
      | "InvalidAmount"
      | "MoneyOverflow"
      | "InvalidFeeRate"
      | "FeeExceedsAmount"
      | "InvalidQuantity"
      | "InvalidOrders"
      | "SalesChannelRequired"
      | "InvalidDeleteReason"
      | "InvalidBusinessDate"
      | "InvalidId"
      | "OriginMissing"
      | "EntryDeleted"
      | "EntryAlreadyDeleted"
      | "NothingToChange";
  }
>;

const FIELD_KEYS = [
  "unitId",
  "type",
  "occurredOn",
  "paidOn",
  "description",
  "quantity",
  "quantityUnit",
  "orders",
  "amountCents",
  "feePercentBp",
  "feeFixedCents",
  "categoryId",
  "supplierId",
  "paymentMethodId",
  "salesChannelId",
] as const satisfies readonly (keyof EntryFields)[];

function validateFields(
  fields: EntryFields,
): Result<{ feeCents: Money; netCents: Money }, EntryError> {
  if (!isBusinessDate(fields.occurredOn)) {
    return fail("InvalidBusinessDate", { value: fields.occurredOn });
  }
  if (!isBusinessDate(fields.paidOn)) return fail("InvalidBusinessDate", { value: fields.paidOn });
  if (fields.amountCents <= 0) return fail("AmountNotPositive");
  if (fields.orders !== null) {
    if (fields.type !== "revenue" || !Number.isInteger(fields.orders) || fields.orders <= 0) {
      return fail("InvalidOrders", { value: fields.orders });
    }
  }
  // Toda receita tem canal (DD-08); o canal padrão da unidade cobre a mensagem sem canal.
  if (fields.type === "revenue" && fields.salesChannelId === null) {
    return fail("SalesChannelRequired");
  }
  if (fields.quantity !== null) {
    const quantity = quantityToMilli(fields.quantity);
    if (!quantity.ok) return quantity;
  }
  const fee = computeFee(fields.amountCents, fields);
  if (!fee.ok) return fee;
  return ok(fee.value);
}

export function createEntry(
  draft: EntryDraft,
  context: ChangeContext & { readonly id: string; readonly tenantId: string },
): Result<EntryChange, EntryError> {
  if (!isUuidV7(context.id)) return fail("InvalidId", { value: context.id });
  if (context.channel === "whatsapp" && draft.inboundMessageId === null) {
    return fail("OriginMissing");
  }
  const fields: EntryFields = {
    ...draft,
    paidOn: draft.paidOn ?? draft.occurredOn,
    orders: draft.orders ?? null,
  };
  const calculated = validateFields(fields);
  if (!calculated.ok) return calculated;

  const entry: Entry = {
    ...draft,
    ...fields,
    flags: draft.flags ?? [],
    id: context.id,
    tenantId: context.tenantId,
    feeCents: calculated.value.feeCents,
    netCents: calculated.value.netCents,
    confirmationWaMessageId: null,
    createdBy: context.actorId,
    createdAt: context.at,
    updatedAt: context.at,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    restorableUntil: null,
    version: 1,
  };
  return ok({ entry, version: toVersion("create", null, entry, context) });
}

/** Edita campos; taxa e líquido são recalculados. Sem mudança real não gera versão. */
export function editEntry(
  entry: Entry,
  patch: Partial<EntryFields>,
  context: ChangeContext,
): Result<EntryChange, EntryError> {
  if (entry.deletedAt !== null) return fail("EntryDeleted");

  const fields = { ...pickFields(entry), ...patch };
  if (FIELD_KEYS.every((key) => fields[key] === entry[key])) return fail("NothingToChange");

  const calculated = validateFields(fields);
  if (!calculated.ok) return calculated;

  const next: Entry = {
    ...entry,
    ...fields,
    feeCents: calculated.value.feeCents,
    netCents: calculated.value.netCents,
    updatedAt: context.at,
    version: entry.version + 1,
  };
  return ok({ entry: next, version: toVersion("update", entry, next, context) });
}

/** Soft delete: nada é apagado, `deletedAt` é preenchido e a versão fica registrada. */
export function softDeleteEntry(
  entry: Entry,
  context: ChangeContext,
  options: { readonly reason?: string | null } = {},
): Result<EntryChange, EntryError> {
  if (entry.deletedAt !== null) return fail("EntryAlreadyDeleted");
  const reason = options.reason?.trim() ? options.reason.trim() : null;
  if (reason !== null && [...reason].length > DELETE_REASON_MAX) {
    return fail("InvalidDeleteReason");
  }
  const next: Entry = {
    ...entry,
    deletedAt: context.at,
    deletedBy: context.actorId,
    deleteReason: reason,
    restorableUntil: addDays(context.at, RESTORE_WINDOW_DAYS),
    updatedAt: context.at,
    version: entry.version + 1,
  };
  return ok({ entry: next, version: toVersion("delete", entry, next, context) });
}

/** Tira da lixeira (RF25.R4): limpa `deletedAt` e registra a versão `restore`. */
export function restoreEntry(
  entry: Entry,
  context: ChangeContext,
): Result<EntryChange, EntryError | Extract<DomainError, { code: "EntryNotDeleted" }>> {
  if (entry.deletedAt === null) return fail("EntryNotDeleted");
  const next: Entry = {
    ...entry,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    restorableUntil: null,
    updatedAt: context.at,
    version: entry.version + 1,
  };
  return ok({ entry: next, version: toVersion("restore", entry, next, context) });
}

/** Data (UTC) de `days` dias depois de `at`, como data de negócio. */
function addDays(at: Date, days: number): BusinessDate {
  const date = new Date(at.getTime() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Marca como revisado: tira os sinais de revisão e registra a versão (RF12.R13). */
export function markEntryReviewed(
  entry: Entry,
  context: ChangeContext,
): Result<EntryChange, EntryError> {
  if (entry.deletedAt !== null) return fail("EntryDeleted");
  if (entry.flags.length === 0) return fail("NothingToChange");
  const next: Entry = {
    ...entry,
    flags: [],
    updatedAt: context.at,
    version: entry.version + 1,
  };
  return ok({ entry: next, version: toVersion("update", entry, next, context) });
}

function pickFields(entry: Entry): EntryFields {
  return {
    unitId: entry.unitId,
    type: entry.type,
    occurredOn: entry.occurredOn,
    paidOn: entry.paidOn,
    description: entry.description,
    quantity: entry.quantity,
    quantityUnit: entry.quantityUnit,
    orders: entry.orders,
    amountCents: entry.amountCents,
    feePercentBp: entry.feePercentBp,
    feeFixedCents: entry.feeFixedCents,
    categoryId: entry.categoryId,
    supplierId: entry.supplierId,
    paymentMethodId: entry.paymentMethodId,
    salesChannelId: entry.salesChannelId,
  };
}

function toVersion(
  action: VersionAction,
  before: Entry | null,
  after: Entry,
  context: ChangeContext,
): EntryVersion {
  return {
    entryId: after.id,
    tenantId: after.tenantId,
    version: after.version,
    action,
    before,
    after,
    changedBy: context.actorId,
    channel: context.channel,
    changedAt: context.at,
  };
}
