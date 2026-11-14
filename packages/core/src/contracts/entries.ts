import { z } from "zod";
import type { CatalogCategory } from "../entry/catalog";
import type { Channel, EntryType, VersionAction } from "../entry/entry";
import type { EntryFlag } from "../entry/interpret";
import { periodWithinLimit } from "./period";

// Contrato da API de lançamentos do painel (D-F3, D-F4, DD-36): a única interface entre a
// API, o leitor SQL e a tela. Só Zod e tipos.

// As listas abaixo repetem os valores do domínio; `satisfies` e as checagens de tipo logo
// depois quebram a compilação se uma união do domínio ganhar ou perder um valor.
type Exhaustive<Union, Listed extends Union> = [Union] extends [Listed] ? true : never;

export const ENTRY_TYPES = ["expense", "revenue"] as const satisfies readonly EntryType[];
/** Sinais de revisão (RF12.R13, RF22.R4). */
export const ENTRY_FLAGS = [
  "category_to_review",
  "channel_to_review",
  "possible_duplicate",
  "old_date",
] as const satisfies readonly EntryFlag[];
/** Canais de origem de um lançamento e de cada versão (RF25.R4). */
export const ORIGIN_CHANNELS = [
  "whatsapp",
  "web",
  "import",
  "email",
  "system",
] as const satisfies readonly Channel[];
/** Ações do histórico (RF25.R4). */
export const VERSION_ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
] as const satisfies readonly VersionAction[];
export const CATEGORY_KINDS = [
  "revenue",
  "expense",
  "investment",
  "deduction",
] as const satisfies readonly CatalogCategory["kind"][];

const _entryTypes: Exhaustive<EntryType, (typeof ENTRY_TYPES)[number]> = true;
const _entryFlags: Exhaustive<EntryFlag, (typeof ENTRY_FLAGS)[number]> = true;
const _originChannels: Exhaustive<Channel, (typeof ORIGIN_CHANNELS)[number]> = true;
const _versionActions: Exhaustive<VersionAction, (typeof VERSION_ACTIONS)[number]> = true;
const _categoryKinds: Exhaustive<CatalogCategory["kind"], (typeof CATEGORY_KINDS)[number]> = true;
void [_entryTypes, _entryFlags, _originChannels, _versionActions, _categoryKinds];

/** Ordenações da lista (DD-35); `amount` é o valor bruto. */
export const ENTRY_SORTS = ["created_at", "occurred_on", "paid_on", "amount"] as const;
export const SORT_DIRECTIONS = ["desc", "asc"] as const;
export const SOURCE_KINDS = ["text", "audio", "image", "none"] as const;

/**
 * Campos que podem aparecer no histórico (RF25.R4): os editáveis do RF23, as taxas
 * copiadas e os valores recalculados (RF23.R1, Obs4), os sinais (RF23.R2) e o motivo da
 * exclusão (RF24.R1). Cadastros vêm pelo nome (`category`, `unit`), não pelo id.
 */
export const ENTRY_CHANGE_FIELDS = [
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
  "feeCents",
  "netCents",
  "category",
  "supplier",
  "paymentMethod",
  "salesChannel",
  "unit",
  "flags",
  "deleteReason",
] as const;

export const ENTRY_PAGE_DEFAULT = 50;
export const ENTRY_PAGE_MAX = 100;
export const ENTRY_BATCH_MAX = 100;
export const ENTRY_SEARCH_MAX = 100;
export const ENTRY_DESCRIPTION_MAX = 200;
/** RF24.R1. */
export const ENTRY_DELETE_REASON_MAX = 200;
/** Máximo de itens em cada filtro de lista (`unitIds`, `categoryIds`, `flags`). */
export const ENTRY_FILTER_LIST_MAX = 100;
export const ENTRY_CURSOR_MAX = 512;
/** Nome de fornecedor novo digitado na edição. */
export const SUPPLIER_NAME_MAX = 120;
export const QUANTITY_UNIT_MAX = 20;

/** Data de negócio `AAAA-MM-DD` que existe no calendário (RNF13.R4). */
export const businessDateSchema = z.iso.date();
/** Dinheiro: inteiro seguro em centavos, a partir de zero (RNF13, D-F4). */
export const centsSchema = z.int().min(0);
/** Centavos que podem ser negativos (resultado). */
const signedCentsSchema = z.int();
const idSchema = z.uuid();
/** Instante ISO 8601 com `Z` ou deslocamento. */
const timestampSchema = z.iso.datetime({ offset: true });
const refSchema = z.object({ id: idSchema, name: z.string() });

const entryTypeSchema = z.enum(ENTRY_TYPES);
const entryFlagSchema = z.enum(ENTRY_FLAGS);
const originChannelSchema = z.enum(ORIGIN_CHANNELS);

// ---------------------------------------------------------------------------------------
// Query string: tudo chega como texto, e parâmetro repetido chega como array.
// ---------------------------------------------------------------------------------------

/** Lista da query string: `unitIds=a` vira `["a"]`; `unitIds=a&unitIds=b` já é lista. */
function queryList<Item extends z.ZodType>(item: Item) {
  return z
    .preprocess(
      (value) => (Array.isArray(value) ? value : [value]),
      z.array(item).min(1).max(ENTRY_FILTER_LIST_MAX),
    )
    .optional();
}

const limitSchema = z.coerce
  .number<string | number>()
  .int()
  .min(1)
  .max(ENTRY_PAGE_MAX)
  .default(ENTRY_PAGE_DEFAULT);
const cursorSchema = z.string().min(1).max(ENTRY_CURSOR_MAX).optional();

function isValidDate(value: unknown): boolean {
  return businessDateSchema.safeParse(value).success;
}

function codePoints(text: string): number {
  return [...text].length;
}

export const entryListQuerySchema = z
  .object({
    /** Período sobre a data de competência (`occurred_on`), obrigatório (RF22.R1). */
    from: businessDateSchema,
    to: businessDateSchema,
    type: entryTypeSchema.optional(),
    unitIds: queryList(idSchema),
    categoryIds: queryList(idSchema),
    supplierId: idSchema.optional(),
    paymentMethodId: idSchema.optional(),
    salesChannelId: idSchema.optional(),
    createdBy: idSchema.optional(),
    originChannel: originChannelSchema.optional(),
    flags: queryList(entryFlagSchema),
    q: z.string().trim().min(1).max(ENTRY_SEARCH_MAX).optional(),
    sort: z.enum(ENTRY_SORTS).default("created_at"),
    dir: z.enum(SORT_DIRECTIONS).default("desc"),
    cursor: cursorSchema,
    limit: limitSchema,
  })
  .superRefine((query, ctx) => {
    // As checagens do objeto rodam mesmo com campo inválido; a data ruim já tem o seu erro.
    if (!isValidDate(query.from) || !isValidDate(query.to)) return;
    if (query.from > query.to) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "period_inverted" });
    } else if (!periodWithinLimit(query.from, query.to)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "period_too_long" });
    }
  });

export const trashQuerySchema = z
  .object({
    /** Período sobre a data da exclusão (RF24, Pesquisa). */
    deletedFrom: businessDateSchema,
    deletedTo: businessDateSchema,
    unitIds: queryList(idSchema),
    deletedBy: idSchema.optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  })
  .superRefine((query, ctx) => {
    if (!isValidDate(query.deletedFrom) || !isValidDate(query.deletedTo)) return;
    if (query.deletedFrom > query.deletedTo) {
      ctx.addIssue({ code: "custom", path: ["deletedTo"], message: "period_inverted" });
    }
  });

// ---------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------

export const entryItemSchema = z.object({
  id: idSchema,
  version: z.int().min(1),
  type: entryTypeSchema,
  occurredOn: businessDateSchema,
  paidOn: businessDateSchema,
  description: z.string(),
  quantity: z.number().nullable(),
  quantityUnit: z.string().nullable(),
  orders: z.int().nullable(),
  amountCents: centsSchema,
  feeCents: centsSchema,
  netCents: centsSchema,
  /** Nulo quando o lançamento está sem categoria (`category_id` aceita nulo). */
  category: refSchema.nullable(),
  supplier: refSchema.nullable(),
  paymentMethod: refSchema.nullable(),
  salesChannel: refSchema.nullable(),
  unit: refSchema,
  createdBy: refSchema,
  /** Canal da versão 1 do lançamento. */
  originChannel: originChannelSchema,
  flags: z.array(entryFlagSchema),
  createdAt: timestampSchema,
  // Conforto para a tela; a API repete a checagem em cada mutação.
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canRestore: z.boolean(),
});

export const entryListResponseSchema = z.object({
  items: z.array(entryItemSchema),
  nextCursor: z.string().nullable(),
});

export const entryTotalsSchema = z.object({
  revenueCents: centsSchema,
  expenseCents: centsSchema,
  /** Receitas menos despesas; pode ser negativo. */
  resultCents: signedCentsSchema,
  count: z.int().min(0),
  /** Há lançamento sensível no filtro que o ator não vê e que não entra nos totais (RF22.Obs7). */
  hasRestricted: z.boolean(),
});

export const entryOptionsSchema = z.object({
  categories: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      kind: z.enum(CATEGORY_KINDS),
      parentId: idSchema.nullable(),
      requiresQuantity: z.boolean(),
    }),
  ),
  suppliers: z.array(refSchema),
  paymentMethods: z.array(refSchema),
  salesChannels: z.array(refSchema),
  units: z.array(refSchema),
  members: z.array(refSchema),
});

const changeValueSchema = z.union([z.string(), z.number(), z.null()]);

// Os dois `refine` de `restricted` abaixo são a barreira do contrato contra vazamento: uma
// resposta que marca "restrito" e mesmo assim carrega o conteúdo não passa na validação.
export const entryVersionSchema = z
  .object({
    version: z.int().min(1),
    action: z.enum(VERSION_ACTIONS),
    channel: originChannelSchema,
    changedBy: refSchema,
    changedAt: timestampSchema,
    /** Antes ou depois em categoria sensível que o ator não vê: vem sem campos. */
    restricted: z.boolean(),
    changes: z.array(
      z.object({
        field: z.enum(ENTRY_CHANGE_FIELDS),
        before: changeValueSchema,
        after: changeValueSchema,
      }),
    ),
  })
  .refine((version) => !version.restricted || version.changes.length === 0, {
    path: ["changes"],
    message: "restricted_with_changes",
  });

const entryDeletedSchema = z.object({
  at: timestampSchema,
  by: refSchema,
  reason: z.string().nullable(),
  restorableUntil: businessDateSchema,
});

export const entryDetailSchema = entryItemSchema.extend({
  feePercentBp: z.int().min(0).max(10_000),
  feeFixedCents: centsSchema,
  updatedAt: timestampSchema,
  deleted: entryDeletedSchema.nullable(),
  versions: z.array(entryVersionSchema),
});

export const entrySourceSchema = z
  .object({
    channel: originChannelSchema,
    kind: z.enum(SOURCE_KINDS),
    /** Texto do usuário: a tela mostra como texto puro (RF25.R1). */
    text: z.string().nullable(),
    transcription: z.string().nullable(),
    /** Chave de acesso da nota, 44 dígitos. */
    accessKey: z
      .string()
      .regex(/^\d{44}$/)
      .nullable(),
    sentBy: refSchema.nullable(),
    /** Nulo quando não há mensagem de origem (`kind: "none"`). */
    sentAt: timestampSchema.nullable(),
    /** A mensagem gerou outro lançamento que o ator não vê: sem texto nem transcrição (RF25.Obs1). */
    restricted: z.boolean(),
    mediaAvailable: z.boolean(),
  })
  .refine(
    (source) =>
      !source.restricted ||
      (source.text === null && source.transcription === null && source.accessKey === null),
    { message: "restricted_with_content" },
  );

// ---------------------------------------------------------------------------------------
// Escrita (F3b)
// ---------------------------------------------------------------------------------------

const supplierPatchSchema = z.union([
  z.strictObject({ id: idSchema }),
  z.strictObject({ name: z.string().trim().min(1).max(SUPPLIER_NAME_MAX) }),
  z.null(),
]);

/**
 * Campos editáveis do RF23, todos opcionais. Campo ausente = não muda; `null` = limpar.
 * Taxa e líquido não entram: são recalculados pelo `core`. Chave desconhecida é recusada.
 */
export const entryPatchSchema = z.strictObject({
  type: entryTypeSchema.optional(),
  occurredOn: businessDateSchema.optional(),
  paidOn: businessDateSchema.optional(),
  description: z.string().trim().min(1).max(ENTRY_DESCRIPTION_MAX).optional(),
  quantity: z.number().positive().nullable().optional(),
  quantityUnit: z.string().trim().min(1).max(QUANTITY_UNIT_MAX).nullable().optional(),
  orders: z.int().min(1).nullable().optional(),
  amountCents: z.int().min(1).optional(),
  categoryId: idSchema.optional(),
  /** Um existente, um nome novo (a API associa ou cria) ou `null` para limpar. */
  supplier: supplierPatchSchema.optional(),
  paymentMethodId: idSchema.nullable().optional(),
  salesChannelId: idSchema.nullable().optional(),
  unitId: idSchema.optional(),
});

export const entryUpdateBodySchema = z
  .object({
    /** Versão que o usuário abriu (RF23.Obs2). */
    expectedVersion: z.int().min(1),
    patch: entryPatchSchema.default({}),
    markReviewed: z.boolean().default(false),
  })
  // Chave presente com valor `undefined` não é mudança (`null` é: limpa o campo).
  .refine(
    (body) => body.markReviewed || Object.values(body.patch).some((value) => value !== undefined),
    {
      path: ["patch"],
      message: "nothing_to_change",
    },
  );

// Mesmo critério do domínio (`softDeleteEntry`): sem espaços nas pontas, contado em caracteres.
const deleteReasonSchema = z
  .string()
  .trim()
  .refine((reason) => codePoints(reason) <= ENTRY_DELETE_REASON_MAX, { message: "too_long" })
  .optional();

export const entryDeleteBodySchema = z.object({ reason: deleteReasonSchema });

export const batchBodySchema = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .max(ENTRY_BATCH_MAX)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: "duplicated_ids",
    }),
  reason: deleteReasonSchema,
});

/** Quantidade e soma do valor bruto, calculadas no servidor (RF24.Obs3). */
export const batchPreviewSchema = z.object({
  count: z.int().min(0),
  totalCents: centsSchema,
});

export const trashResponseSchema = z.object({
  items: z.array(entryItemSchema.extend({ deleted: entryDeletedSchema })),
  nextCursor: z.string().nullable(),
});

/** Corpo do 409 da edição: o detalhe atual, que o chamador já pode ver (RF23.Obs2). */
export const entryStaleSchema = z.object({
  code: z.literal("entry_stale"),
  current: entryDetailSchema,
});

// ---------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------

export type EntrySort = (typeof ENTRY_SORTS)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export type OriginChannel = (typeof ORIGIN_CHANNELS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type EntryChangeField = (typeof ENTRY_CHANGE_FIELDS)[number];

/** Consulta já validada, com os padrões aplicados. */
export type EntryListQuery = z.infer<typeof entryListQuerySchema>;
/**
 * O que a tela informa para montar a URL da lista: os campos de `EntryListQuery`, com
 * `sort`, `dir` e `limit` opcionais (o servidor aplica os padrões) e as listas como lista.
 */
export interface EntryListQueryInput {
  from: string;
  to: string;
  type?: (typeof ENTRY_TYPES)[number];
  unitIds?: string[];
  categoryIds?: string[];
  supplierId?: string;
  paymentMethodId?: string;
  salesChannelId?: string;
  createdBy?: string;
  originChannel?: OriginChannel;
  flags?: (typeof ENTRY_FLAGS)[number][];
  q?: string;
  sort?: EntrySort;
  dir?: SortDirection;
  cursor?: string;
  limit?: number;
}
export type TrashQuery = z.infer<typeof trashQuerySchema>;
export type EntryItem = z.infer<typeof entryItemSchema>;
export type EntryListResponse = z.infer<typeof entryListResponseSchema>;
export type EntryTotals = z.infer<typeof entryTotalsSchema>;
export type EntryOptions = z.infer<typeof entryOptionsSchema>;
export type EntryVersion = z.infer<typeof entryVersionSchema>;
export type EntryChange = EntryVersion["changes"][number];
export type EntryDeleted = z.infer<typeof entryDeletedSchema>;
export type EntryDetail = z.infer<typeof entryDetailSchema>;
export type EntrySource = z.infer<typeof entrySourceSchema>;
export type EntryPatch = z.infer<typeof entryPatchSchema>;
export type EntryUpdateBody = z.infer<typeof entryUpdateBodySchema>;
/** O que o chamador envia: `patch` e `markReviewed` podem faltar. */
export type EntryUpdateBodyInput = z.input<typeof entryUpdateBodySchema>;
export type EntryDeleteBody = z.infer<typeof entryDeleteBodySchema>;
export type BatchBody = z.infer<typeof batchBodySchema>;
export type BatchPreview = z.infer<typeof batchPreviewSchema>;
export type TrashItem = TrashResponse["items"][number];
export type TrashResponse = z.infer<typeof trashResponseSchema>;
export type EntryStale = z.infer<typeof entryStaleSchema>;
