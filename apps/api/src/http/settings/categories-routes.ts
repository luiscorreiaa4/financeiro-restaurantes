import { can, type DomainError, type Result } from "@app/core";
import {
  categorySettingsSchema,
  categoryTreeSchema,
  subcategoryInputSchema,
  subcategoryPatchSchema,
} from "@app/core/contracts";
import type { CategoriesScope, CategoriesSettingsRepo } from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  decoratePanelRequest,
  type PanelDeps,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
  requireWritable,
} from "../panel/panel-context";

export type CategoriesRoutesDeps = PanelDeps & {
  readonly categorySettings: CategoriesSettingsRepo;
};

const idSchema = z.uuid();
const listQuerySchema = z
  .object({
    search: z.string().max(60).optional(),
    kind: z.enum(["revenue", "expense", "investment", "deduction"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();

const validation = (reply: FastifyReply, field: string, reason: string) =>
  reply.code(422).send({ code: "validation", field, reason });

const CATEGORY_FIELDS = {
  name: "name",
  parent: "parent_id",
  nature: "nature",
  supportWords: "support_words",
} as const;

/** Erro de domínio da categoria para a resposta: só `code` (e `field`/`reason`, sem dado). */
function sendDomainError(reply: FastifyReply, error: DomainError) {
  switch (error.code) {
    case "NameTaken":
      return reply.code(409).send({ code: "name_taken" });
    case "InvalidCategory":
      if (error.field === "name" && error.reason === "duplicate") {
        return reply.code(409).send({ code: "name_taken" });
      }
      return validation(reply, CATEGORY_FIELDS[error.field], error.reason);
    case "UnknownReference":
      return validation(reply, "parent_id", "unknown");
    case "SystemCategoryReadOnly":
      return validation(reply, "name", "system_read_only");
    case "ParentChangeForbidden":
      return validation(reply, "parent_id", "immutable");
    case "NatureOnlyForExpense":
      return validation(reply, "nature", "invalid");
    case "SensitiveLocked":
      return validation(reply, "is_sensitive", "locked");
    default:
      throw new Error(`erro de domínio inesperado na categoria: ${error.code}`);
  }
}

/**
 * Categorias e subcategorias (F6c, RF07): leitura com `catalog:view`; escrita com
 * `catalog:manage` e conta gravável (RF37). A folha (sensível) só sai para quem vê folha, também
 * na busca e nas subcategorias dela (RF06.R3). Erros só com `{ code }`; nome, palavra de apoio,
 * cookie e `X-Context` nunca vão para o log (regra 9).
 */
export const categoriesRoutes: FastifyPluginAsync<{ deps: CategoriesRoutesDeps }> = async (
  app,
  { deps },
) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      // Só o tipo do erro: a mensagem do driver traz SQL e parâmetros.
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha nas categorias");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const read = [requirePanelContext(deps), requireTenantRoute(), requirePermission("catalog:view")];
  const write = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("catalog:manage"),
    requireWritable(),
  ];

  /** Tenant, autor e recorte de sensível vêm do contexto revalidado, nunca do corpo ou da URL. */
  function callerOf(request: FastifyRequest): {
    tenantId: string;
    userId: string;
    scope: CategoriesScope;
  } {
    if (request.panel == null || request.session == null) {
      throw new Error("requirePanelContext não preencheu o contexto");
    }
    // O mesmo critério do recorte de lançamentos (`entryScopeFor`): quem vê lançamento de
    // categoria sensível vê a categoria. Na dúvida, não vê.
    const includeSensitive = can(request.panel.actor, "entry:view", {
      categoryIsSensitive: true,
      isOwnEntry: true,
    });
    return {
      tenantId: request.panel.tenantId,
      userId: request.session.userId,
      scope: { includeSensitive },
    };
  }

  const idOf = (request: FastifyRequest): string | null => {
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    return parsed.success ? parsed.data : null;
  };

  function respond(
    reply: FastifyReply,
    result: Result<unknown, DomainError> | null,
    successStatus: number,
  ) {
    if (result === null) return reply.code(404).send({ code: "not_found" });
    if (!result.ok) return sendDomainError(reply, result.error);
    return reply.code(successStatus).send(categorySettingsSchema.parse(result.value));
  }

  app.get("/api/settings/categories", { preHandler: read }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId, scope } = callerOf(request);
    const items = await deps.categorySettings.list(tenantId, {
      ...scope,
      ...(query.data.search ? { search: query.data.search } : {}),
      ...(query.data.kind ? { kind: query.data.kind } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
    });
    return categoryTreeSchema.parse({ items });
  });

  app.post("/api/settings/categories", { preHandler: write }, async (request, reply) => {
    const parsed = subcategoryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId, userId, scope } = callerOf(request);
    const result = await deps.categorySettings.createSubcategory(
      tenantId,
      userId,
      parsed.data,
      scope,
    );
    return respond(reply, result, 201);
  });

  app.patch("/api/settings/categories/:id", { preHandler: write }, async (request, reply) => {
    const parsed = subcategoryPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, userId, scope } = callerOf(request);
    const result = await deps.categorySettings.updateSubcategory(
      tenantId,
      userId,
      id,
      parsed.data,
      scope,
    );
    return respond(reply, result, 200);
  });
};
