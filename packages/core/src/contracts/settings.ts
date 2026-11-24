import { z } from "zod";
import {
  CATALOG_ALIASES_MAX,
  CATALOG_STATUSES,
  PAYMENT_METHOD_TYPES,
  SALES_CHANNEL_TYPES,
} from "../registry/catalog-types";
import { CATALOG_NAME_MAX, CATALOG_NAME_MIN, MAX_FEE_BP } from "../registry/payment-method";
import {
  BRAZILIAN_STATES,
  UNIT_ALIAS_MAX_LENGTH,
  UNIT_ALIASES_MAX,
  UNIT_NAME_MAX,
  UNIT_NAME_MIN,
  UNIT_STATUSES,
} from "../registry/unit";
import { businessDateSchema, idSchema, timestampSchema } from "./entries";

// Contrato das configurações do painel (F6a, RF08, RF09, RF05): só Zod e tipos.

export const FEE_REAPPLICATION_TARGET_KINDS = ["payment_method", "sales_channel"] as const;
export const FEE_REAPPLICATION_STATUSES = ["queued", "running", "done", "failed"] as const;

const nameSchema = z.string().min(CATALOG_NAME_MIN).max(CATALOG_NAME_MAX);
const aliasesSchema = z.array(z.string().min(1).max(CATALOG_NAME_MAX)).max(CATALOG_ALIASES_MAX);
const feePercentBpSchema = z.int().min(0).max(MAX_FEE_BP);
const feeFixedCentsSchema = z.int().min(0);
const statusSchema = z.enum(CATALOG_STATUSES);

// Forma de pagamento.
export const paymentMethodInputSchema = z
  .object({
    name: nameSchema,
    type: z.enum(PAYMENT_METHOD_TYPES),
    feePercentBp: feePercentBpSchema,
    feeFixedCents: feeFixedCentsSchema,
    aliases: aliasesSchema,
    status: statusSchema,
    isDefaultCard: z.boolean(),
  })
  .strict();
export const paymentMethodPatchSchema = paymentMethodInputSchema.partial().strict();
export const paymentMethodSettingsSchema = paymentMethodInputSchema
  .extend({ id: idSchema, protected: z.boolean() })
  .strict();

// Canal de venda: sem taxa fixa e sem cartão padrão.
export const salesChannelInputSchema = z
  .object({
    name: nameSchema,
    type: z.enum(SALES_CHANNEL_TYPES),
    feePercentBp: feePercentBpSchema,
    aliases: aliasesSchema,
    status: statusSchema,
  })
  .strict();
export const salesChannelPatchSchema = salesChannelInputSchema.partial().strict();
export const salesChannelSettingsSchema = salesChannelInputSchema
  .extend({ id: idSchema, protected: z.boolean() })
  .strict();

// Unidade.
export const unitInputSchema = z
  .object({
    name: z.string().min(UNIT_NAME_MIN).max(UNIT_NAME_MAX),
    aliases: z.array(z.string().min(1).max(UNIT_ALIAS_MAX_LENGTH)).max(UNIT_ALIASES_MAX),
    cnpj: z.string().nullable(),
    uf: z.enum(BRAZILIAN_STATES),
    city: z.string().min(1),
    timezone: z.string().min(1),
    status: z.enum(UNIT_STATUSES),
    defaultSalesChannelId: idSchema.nullable(),
  })
  .strict();
export const unitPatchSchema = unitInputSchema.partial().strict();
// Na saída, cidade e UF podem ser nulas: unidades anteriores à E11 não têm (migration 0008, sem
// backfill). Entrada e patch continuam exigindo os dois.
export const unitSettingsSchema = unitInputSchema
  .extend({
    id: idSchema,
    onlyUnitMemberCount: z.int().min(0),
    uf: unitInputSchema.shape.uf.nullable(),
    city: unitInputSchema.shape.city.nullable(),
  })
  .strict();

// Prévia da taxa sobre R$ 100,00.
export const feePreviewSchema = z
  .object({ grossCents: z.literal(10000), feeCents: z.int(), netCents: z.int() })
  .strict();

// Reaplicação de taxa a lançamentos antigos.
const feeReapplicationRangeShape = {
  targetKind: z.enum(FEE_REAPPLICATION_TARGET_KINDS),
  targetId: idSchema,
  from: businessDateSchema,
  to: businessDateSchema,
};
const fromNotAfterTo = (value: { from: string; to: string }) => value.from <= value.to;
const rangeIssue = { message: "from must not be after to", path: ["from"] };

export const feeReapplicationPreviewInputSchema = z
  .object(feeReapplicationRangeShape)
  .strict()
  .refine(fromNotAfterTo, rangeIssue);
export const feeReapplicationPreviewSchema = z
  .object({
    matched: z.int().min(0),
    deltaNetCents: z.int(),
    feePercentBp: feePercentBpSchema,
    feeFixedCents: feeFixedCentsSchema,
  })
  .strict();
export const feeReapplicationInputSchema = z
  .object({ ...feeReapplicationRangeShape, clientRequestId: z.uuid() })
  .strict()
  .refine(fromNotAfterTo, rangeIssue);
export const feeReapplicationSchema = z
  .object({
    id: idSchema,
    ...feeReapplicationRangeShape,
    status: z.enum(FEE_REAPPLICATION_STATUSES),
    errorCode: z.string().nullable(),
    matched: z.int().min(0),
    updated: z.int().min(0),
    skipped: z.int().min(0),
    createdAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
  })
  .strict();

export const restrictedUnitsSchema = z
  .object({
    units: z.array(z.object({ id: idSchema, name: z.string(), tenantName: z.string() }).strict()),
  })
  .strict();

export type PaymentMethodInput = z.infer<typeof paymentMethodInputSchema>;
export type PaymentMethodPatch = z.infer<typeof paymentMethodPatchSchema>;
export type PaymentMethodSettings = z.infer<typeof paymentMethodSettingsSchema>;
export type SalesChannelSettingsInput = z.infer<typeof salesChannelInputSchema>;
export type SalesChannelPatch = z.infer<typeof salesChannelPatchSchema>;
export type SalesChannelSettings = z.infer<typeof salesChannelSettingsSchema>;
export type UnitSettingsInput = z.infer<typeof unitInputSchema>;
export type UnitPatch = z.infer<typeof unitPatchSchema>;
export type UnitSettings = z.infer<typeof unitSettingsSchema>;
export type FeePreview = z.infer<typeof feePreviewSchema>;
export type FeeReapplicationPreviewInput = z.infer<typeof feeReapplicationPreviewInputSchema>;
export type FeeReapplicationPreview = z.infer<typeof feeReapplicationPreviewSchema>;
export type FeeReapplicationInput = z.infer<typeof feeReapplicationInputSchema>;
export type FeeReapplication = z.infer<typeof feeReapplicationSchema>;
export type RestrictedUnits = z.infer<typeof restrictedUnitsSchema>;
