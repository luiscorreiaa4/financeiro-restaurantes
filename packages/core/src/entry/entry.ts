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
export type Channel = "whatsapp" | "web" | "import" | "system";
export type VersionAction = "create" | "update" | "delete" | "restore";

/** Campos editáveis de um lançamento. A taxa é guardada como regra para poder recalcular. */
export interface EntryFields {
  readonly unitId: string;
  readonly type: EntryType;
  readonly occurredOn: BusinessDate;
  readonly description: string;
  readonly quantity: number | null;
  readonly quantityUnit: string | null;
  readonly amountCents: Money;
  readonly feePercentBp: number;
  readonly feeFixedCents: number;
  readonly categoryId: string | null;
  readonly supplierId: string | null;
  readonly paymentMethodId: string | null;
  readonly salesChannelId: string | null;
}

/** Entrada para criar um lançamento: campos + origem. Taxa e líquido são calculados aqui. */
export interface EntryDraft extends EntryFields {
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
  readonly version: number;
}

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
  "description",
  "quantity",
  "quantityUnit",
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
  if (fields.amountCents <= 0) return fail("AmountNotPositive");
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
  const calculated = validateFields(draft);
  if (!calculated.ok) return calculated;

  const entry: Entry = {
    ...draft,
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
): Result<EntryChange, EntryError> {
  if (entry.deletedAt !== null) return fail("EntryAlreadyDeleted");
  const next: Entry = {
    ...entry,
    deletedAt: context.at,
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
    updatedAt: context.at,
    version: entry.version + 1,
  };
  return ok({ entry: next, version: toVersion("restore", entry, next, context) });
}

function pickFields(entry: Entry): EntryFields {
  return {
    unitId: entry.unitId,
    type: entry.type,
    occurredOn: entry.occurredOn,
    description: entry.description,
    quantity: entry.quantity,
    quantityUnit: entry.quantityUnit,
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
