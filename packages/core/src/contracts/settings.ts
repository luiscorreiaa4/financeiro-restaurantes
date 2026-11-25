import { z } from "zod";
import { ADDITIONAL_PERMISSIONS, MEMBERSHIP_STATUSES } from "../permissions/permissions";
import {
  CATALOG_ALIASES_MAX,
  CATALOG_STATUSES,
  PAYMENT_METHOD_TYPES,
  SALES_CHANNEL_TYPES,
} from "../registry/catalog-types";
import { CATEGORY_ORIGINS, CATEGORY_STATUSES } from "../registry/category";
import {
  MEMBER_EMAIL_MAX,
  MEMBER_NAME_MAX,
  MEMBER_NAME_MIN,
  MEMBER_ROLES,
} from "../registry/member";
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

// Colaborador (F6b, RF05). O contador entra pela F13, não por aqui.
export const memberInputSchema = z
  .object({
    displayName: z.string().min(MEMBER_NAME_MIN).max(MEMBER_NAME_MAX),
    phone: z.string().min(1),
    email: z.email().max(MEMBER_EMAIL_MAX).nullable(),
    role: z.enum(MEMBER_ROLES),
    allUnits: z.boolean(),
    unitIds: z.array(idSchema),
    defaultUnitId: idSchema.nullable(),
    panelAccess: z.boolean(),
    permissions: z.array(z.enum(ADDITIONAL_PERMISSIONS)),
  })
  .strict();
export const memberPatchSchema = memberInputSchema
  .partial()
  .extend({ confirmPhoneChange: z.literal(true).optional() })
  .strict()
  .refine((value) => value.phone === undefined || value.confirmPhoneChange === true, {
    message: "confirmPhoneChange is required when phone changes",
    path: ["confirmPhoneChange"],
  });
export const memberSettingsSchema = z
  .object({
    id: idSchema,
    displayName: z.string(),
    phoneMasked: z.string(),
    phone: z.string().optional(),
    email: z.string().nullable().optional(),
    role: z.enum(MEMBER_ROLES),
    allUnits: z.boolean(),
    unitIds: z.array(idSchema),
    defaultUnitId: idSchema.nullable(),
    panelAccess: z.boolean(),
    permissions: z.array(z.enum(ADDITIONAL_PERMISSIONS)),
    status: z.enum(MEMBERSHIP_STATUSES),
    invitedAt: timestampSchema.nullable(),
    deactivatedAt: timestampSchema.nullable(),
  })
  .strict();
export const memberCreatedSchema = z
  .object({ member: memberSettingsSchema, inviteText: z.string() })
  .strict();

// Categoria (F6c, RF07): árvore de dois níveis; a subcategoria herda tipo, grupo e sensível do pai.
const CATEGORY_KIND_VALUES = ["revenue", "expense", "investment", "deduction"] as const;
const categoryNameSchema = z.string().min(2).max(60);
const supportWordsSchema = z.array(z.string().min(1).max(40)).max(30);
const categoryNatureSchema = z.enum(["fixed", "variable"]);

export const categorySettingsSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    parentId: idSchema.nullable(),
    kind: z.enum(CATEGORY_KIND_VALUES),
    nature: categoryNatureSchema.nullable(),
    dreGroup: z.string(),
    isSensitive: z.boolean(),
    requiresQuantity: z.boolean(),
    supportWords: z.array(z.string()),
    origin: z.enum(CATEGORY_ORIGINS),
    status: z.enum(CATEGORY_STATUSES),
  })
  .strict();
export const categoryNodeSchema = categorySettingsSchema
  .extend({ children: z.array(categorySettingsSchema) })
  .strict();
export const categoryTreeSchema = z.object({ items: z.array(categoryNodeSchema) }).strict();

// O pai não troca e "sensível" vem do pai: nem `parentId` nem `isSensitive` entram aqui.
export const subcategoryInputSchema = z
  .object({
    parentId: idSchema,
    name: categoryNameSchema,
    nature: categoryNatureSchema.nullable().optional(),
    supportWords: supportWordsSchema,
  })
  .strict();
export const subcategoryPatchSchema = z
  .object({
    name: categoryNameSchema.optional(),
    nature: categoryNatureSchema.nullable().optional(),
    supportWords: supportWordsSchema.optional(),
    status: z.enum(CATEGORY_STATUSES).optional(),
  })
  .strict();

// Fornecedor (F6c, RF10). Dinheiro em centavos inteiros; CPF mascarado é decisão do servidor (R2).
export const SUPPLIER_ORIGINS = ["message", "invoice", "panel", "import"] as const;
export const SUPPLIER_LIST_STATUSES = ["active", "inactive", "all"] as const;
const supplierNameSchema = z.string().min(2).max(120);
const supplierAliasesSchema = z.array(z.string().min(1).max(120)).max(10);

export const supplierSettingsSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    aliases: z.array(z.string()),
    /** CNPJ inteiro; CPF mascarado quando o ator não é dono nem tem exportar dados. */
    document: z.string().nullable(),
    documentKind: z.enum(["cpf", "cnpj"]).nullable(),
    status: z.enum(CATALOG_STATUSES),
    origin: z.enum(SUPPLIER_ORIGINS).nullable(),
    /** Só despesas do recorte do ator no período (unidades e folha respeitadas). */
    totalSpentCents: z.number().int().nonnegative(),
    lastPurchaseOn: businessDateSchema.nullable(),
  })
  .strict();
export const supplierListSchema = z
  .object({
    items: z.array(supplierSettingsSchema),
    from: businessDateSchema,
    to: businessDateSchema,
  })
  .strict();
export const supplierPatchSchema = z
  .object({
    name: supplierNameSchema.optional(),
    document: z.string().max(30).nullable().optional(),
    aliases: supplierAliasesSchema.optional(),
    status: z.enum(CATALOG_STATUSES).optional(),
  })
  .strict();
export const mergeInputSchema = z.object({ targetId: idSchema }).strict();
export const mergePreviewSchema = z
  .object({ visibleEntries: z.number().int().nonnegative() })
  .strict();
/** Sem contagem: o total movido inclui lançamentos que o ator não vê. */
export const mergeResultSchema = z
  .object({ ok: z.literal(true), target: supplierSettingsSchema })
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
export type MemberSettingsInput = z.infer<typeof memberInputSchema>;
export type MemberSettingsPatch = z.infer<typeof memberPatchSchema>;
export type MemberSettings = z.infer<typeof memberSettingsSchema>;
export type MemberCreated = z.infer<typeof memberCreatedSchema>;
export type CategorySettings = z.infer<typeof categorySettingsSchema>;
export type CategoryNode = z.infer<typeof categoryNodeSchema>;
export type CategoryTree = z.infer<typeof categoryTreeSchema>;
export type SubcategoryInput = z.infer<typeof subcategoryInputSchema>;
export type SubcategoryPatch = z.infer<typeof subcategoryPatchSchema>;
export type SupplierSettings = z.infer<typeof supplierSettingsSchema>;
export type SupplierList = z.infer<typeof supplierListSchema>;
export type SupplierPatchInput = z.infer<typeof supplierPatchSchema>;
export type MergeInput = z.infer<typeof mergeInputSchema>;
export type MergePreview = z.infer<typeof mergePreviewSchema>;
export type MergeResult = z.infer<typeof mergeResultSchema>;
