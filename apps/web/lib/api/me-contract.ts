import { z } from "zod";

/** Papéis e situações como a API os devolve (espelho de `@app/core`; o web valida o texto). */
const roleSchema = z.enum(["owner", "manager", "staff", "accountant"]);
const accountStatusSchema = z.enum(["active", "read_only", "canceled", "closed"]);

const unitChoiceSchema = z.union([z.literal("all"), z.string().min(1)]);

/** Contrato de `GET /api/me` (F2): usuário, empresas, contexto efetivo e de onde ele veio. */
export const fullMeSchema = z.object({
  access: z.literal("full"),
  userId: z.string().min(1),
  name: z.string(),
  email: z.string(),
  companies: z.array(
    z.object({
      tenantId: z.string().min(1),
      name: z.string(),
      role: roleSchema,
      accountStatus: accountStatusSchema,
      /** Unidade inicial ao trocar para esta empresa: "all" se o vínculo tem todas, senão a padrão acessível. */
      startUnitId: unitChoiceSchema,
    }),
  ),
  context: z.object({
    tenantId: z.string().min(1),
    unitId: unitChoiceSchema,
    role: roleSchema,
    permissions: z.array(z.string()),
    allUnits: z.boolean(),
    unitIds: z.array(z.string()),
    accountStatus: accountStatusSchema,
    allowedActions: z.array(z.string()),
  }),
  contextSource: z.enum(["cookie", "fallback", "invalid_cookie"]),
});

/** Sessão restrita (pós-F2, A5): sem empresa nem contexto; só dá para criar empresa ou sair. */
export const restrictedMeSchema = z.object({
  access: z.literal("restricted"),
  reason: z.enum(["owner_no_unit", "no_membership"]),
  userId: z.string().min(1),
  name: z.string(),
  email: z.string(),
});

export const meSchema = z.discriminatedUnion("access", [fullMeSchema, restrictedMeSchema]);

export type FullMe = z.infer<typeof fullMeSchema>;
export type RestrictedMe = z.infer<typeof restrictedMeSchema>;
export type Me = z.infer<typeof meSchema>;

/** Valor do cabeçalho `X-Context` (mesmo formato do cookie `fr_ctx`). */
export function contextHeaderOf(me: FullMe): string {
  return `${me.context.tenantId}.${me.context.unitId}`;
}
