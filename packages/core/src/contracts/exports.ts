import { z } from "zod";
import { entryFiltersSchema, idSchema, timestampSchema } from "./entries";

// Contrato da exportação do painel (RF29, DD-42): só Zod e tipos.

export const EXPORT_FORMATS = ["xlsx", "csv"] as const;
export const EXPORT_CONTENTS = ["entries", "full"] as const;
/** NA_FILA, GERANDO, PRONTO e FALHOU (RF29.R4). */
export const EXPORT_STATUSES = ["queued", "generating", "ready", "failed"] as const;
export const EXPORT_ERROR_CODES = ["forbidden", "too_many_rows", "generation_failed"] as const;
/** RF29.R5. */
export const EXPORT_LINK_TTL_SECONDS = 3600;
export const EXPORT_RETENTION_DAYS = 7;
/** DD-42. */
export const EXPORT_MAX_ROWS = 100_000;
export const EXPORT_MAX_PENDING = 3;

export const exportCreateBodySchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    content: z.enum(EXPORT_CONTENTS),
    filters: entryFiltersSchema,
    clientRequestId: z.uuid(),
  })
  .strict();

export const exportItemSchema = z
  .object({
    id: idSchema,
    format: z.enum(EXPORT_FORMATS),
    content: z.enum(EXPORT_CONTENTS),
    status: z.enum(EXPORT_STATUSES),
    rowCount: z.int().nullable(),
    fileSize: z.int().nullable(),
    errorCode: z.enum(EXPORT_ERROR_CODES).nullable(),
    filters: entryFiltersSchema,
    createdAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
    available: z.boolean(),
  })
  .strict();

export const exportListResponseSchema = z.object({ items: z.array(exportItemSchema) }).strict();

export const exportLinkResponseSchema = z
  .object({ url: z.string().startsWith("/api/exports/"), expiresAt: timestampSchema })
  .strict();

export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportContent = (typeof EXPORT_CONTENTS)[number];
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export type ExportErrorCode = (typeof EXPORT_ERROR_CODES)[number];
export type ExportCreateBody = z.infer<typeof exportCreateBodySchema>;
export type ExportItem = z.infer<typeof exportItemSchema>;
export type ExportListResponse = z.infer<typeof exportListResponseSchema>;
export type ExportLinkResponse = z.infer<typeof exportLinkResponseSchema>;
