import { z } from "zod";

// Tolerância controlada: objetos "loose" aceitam campos novos da Meta sem derrubar o parse,
// e cada mensagem/status é validado sozinho para que um item estranho não perca os demais.

export const envelopeSchema = z.looseObject({
  entry: z
    .array(
      z.looseObject({
        changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })).default([]),
      }),
    )
    .default([]),
});

export const changeValueSchema = z.looseObject({
  metadata: z.unknown().optional(),
  contacts: z.array(z.unknown()).default([]),
  messages: z.array(z.unknown()).default([]),
  statuses: z.array(z.unknown()).default([]),
});

export const contactSchema = z.looseObject({
  wa_id: z.string().optional(),
  user_id: z.string().optional(),
});

export const messageSchema = z.looseObject({
  id: z.string().min(1),
  from: z.string().min(1).optional(),
  from_user_id: z.string().optional(),
  type: z.string().min(1),
  text: z.looseObject({ body: z.string() }).optional(),
});

export const statusSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.union([z.string(), z.number()]).optional(),
  recipient_id: z.string().optional(),
  errors: z
    .array(
      z.looseObject({
        code: z.number().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.looseObject({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});
