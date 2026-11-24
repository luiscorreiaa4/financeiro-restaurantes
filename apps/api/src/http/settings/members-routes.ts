import {
  buildInviteText,
  type DomainError,
  type EmailSender,
  MEMBER_ROLES,
  MEMBERSHIP_STATUSES,
} from "@app/core";
import {
  memberCreatedSchema,
  memberInputSchema,
  memberPatchSchema,
  memberSettingsSchema,
} from "@app/core/contracts";
import type { MemberRecord, MembersRepo } from "@app/db";
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createCreateMember } from "../../modules/members/create-member";
import {
  type ContactIssue,
  type MemberOutcome,
  type MembersDeps,
  OWNER_SCOPE,
} from "../../modules/members/shared";
import { createUpdateMember } from "../../modules/members/update-member";
import {
  decoratePanelRequest,
  type PanelDeps,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
  requireWritable,
} from "../panel/panel-context";

export type MembersRoutesDeps = PanelDeps &
  Pick<MembersDeps, "directory" | "productPhoneE164"> & {
    readonly members: MembersRepo;
    readonly clock: { now(): Date };
    readonly email: Pick<EmailSender, "sendMemberInvite">;
    /** Link do login do painel (de `APP_URL`, nunca da requisição). */
    readonly loginUrl: string;
    /** Encerra as sessões do usuário (`null` = todas). Reduzir acesso e desativar encerram (CA09). */
    readonly deleteSessionsExcept: (
      userId: string,
      keepSessionId: string | null,
    ) => Promise<number>;
  };

const idSchema = z.uuid();
const listQuerySchema = z
  .object({
    search: z.string().max(120).optional(),
    role: z.enum(MEMBER_ROLES).optional(),
    unitId: idSchema.optional(),
    status: z.enum(MEMBERSHIP_STATUSES).optional(),
  })
  .strict();

/** Validação do domínio: só `code: "validation"`, o campo e um motivo fixo, nunca o dado. */
function validationOf(error: DomainError): { field: string; reason: string } | null {
  switch (error.code) {
    case "InvalidName":
      return { field: "displayName", reason: "invalid" };
    case "InvalidPhone":
      return { field: "phone", reason: "invalid" };
    case "ForeignPhone":
      return { field: "phone", reason: "foreign" };
    case "ProductNumber":
      return { field: "phone", reason: "product_number" };
    case "PhoneRequired":
      return { field: "phone", reason: "required" };
    case "InvalidEmail":
      return { field: "email", reason: "invalid" };
    case "EmailRequiredForPanel":
      return { field: "email", reason: "required" };
    case "InvalidPermission":
      return { field: "permissions", reason: "invalid" };
    case "DefaultUnitOutsideAccess":
      return { field: "defaultUnitId", reason: "outside_access" };
    case "DefaultUnitRequired":
      return { field: "defaultUnitId", reason: "required" };
    case "NoUnitAccess":
      return { field: "unitIds", reason: "required" };
    case "UnitOutsideTenant":
      return { field: "unitIds", reason: "unknown" };
    case "OwnerNeedsAllUnits":
    case "AccountantNeedsAllUnits":
      return { field: "allUnits", reason: "needs_all" };
    default:
      return null;
  }
}

function sendDomainError(reply: FastifyReply, error: DomainError) {
  if (error.code === "LastActiveOwner") {
    return reply.code(422).send({ code: "last_active_owner" });
  }
  const validation = validationOf(error);
  if (validation === null)
    throw new Error(`erro de domínio inesperado nos colaboradores: ${error.code}`);
  return reply.code(422).send({ code: "validation", ...validation });
}

const sendContact = (reply: FastifyReply, issue: ContactIssue) => reply.code(422).send(issue);

/** Contador entra pela F13 (RF36), não por esta tela: o contrato de colaborador não o declara. */
const isListable = (record: MemberRecord) => (record.role as string) !== "accountant";

/** Último filtro da saída: sem o `userId` e só o que o contrato declara. */
function present(record: MemberRecord) {
  const { userId: _userId, email, ...rest } = record;
  // Sem e-mail e e-mail oculto saem iguais (a chave some): nada sonda se o número já existe.
  return memberSettingsSchema.parse(email == null ? rest : { ...rest, email });
}

/**
 * Colaboradores da empresa (F6b, RF05): leitura com `user:view` (dono todos; gerente só os das
 * suas unidades, sem e-mail e com celular mascarado, RF05.CA08); escrita só com `user:manage`
 * (dono) e conta gravável. Erros só com `{ code }` (422 com `field` e `reason`); nome, celular,
 * e-mail, cookie e `X-Context` nunca vão para o log (regra 9).
 */
export const membersRoutes: FastifyPluginAsync<{ deps: MembersRoutesDeps }> = async (
  app,
  { deps },
) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(
        { errorName: error.name, errorCode: error.code },
        "falha nos colaboradores",
      );
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const memberDeps: MembersDeps = {
    appDb: deps.appDb,
    members: deps.members,
    directory: deps.directory,
    productPhoneE164: deps.productPhoneE164,
    now: () => deps.clock.now(),
  };
  const createMember = createCreateMember(memberDeps);
  const updateMember = createUpdateMember(memberDeps);

  const read = [requirePanelContext(deps), requireTenantRoute(), requirePermission("user:view")];
  const write = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requirePermission("user:manage"),
    requireWritable(),
  ];

  function callerOf(request: FastifyRequest) {
    if (request.panel == null || request.session == null) {
      throw new Error("requirePanelContext não preencheu o contexto");
    }
    return {
      tenantId: request.panel.tenantId,
      actorId: request.session.userId,
      tenantName: request.panel.companies.find((c) => c.tenantId === request.panel?.tenantId)
        ?.tenantName,
    };
  }

  /** Dono vê tudo e com contato; quem só lê vê as unidades dele, sem e-mail (RF05.CA08). */
  function scopeOf(request: FastifyRequest) {
    const actor = request.panel?.actor;
    if (actor == null) throw new Error("requirePanelContext não preencheu o contexto");
    return actor.role === "owner" && actor.units === "all"
      ? OWNER_SCOPE
      : { unitIds: actor.units, includeContact: false };
  }

  /**
   * O e-mail é do usuário, não do vínculo: quem tem vínculo em outra empresa não mostra o e-mail
   * aqui (CA02, nada de outra empresa chega ao dono). O celular fica: foi o dono quem o digitou.
   */
  async function shield(tenantId: string, record: MemberRecord): Promise<MemberRecord> {
    if (record.email == null) return record;
    if (!(await deps.directory.hasMembershipElsewhere(record.userId, tenantId))) return record;
    const { email: _hidden, ...rest } = record;
    return rest;
  }

  const idOf = (request: FastifyRequest): string | null => {
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    return parsed.success ? parsed.data : null;
  };

  function sendFailure(
    reply: FastifyReply,
    outcome: Exclude<MemberOutcome<unknown>, { kind: "ok" }>,
  ) {
    switch (outcome.kind) {
      case "domain":
        return sendDomainError(reply, outcome.error);
      case "contact":
        return sendContact(reply, outcome.issue);
      case "already_member":
        return reply.code(409).send({ code: "already_member" });
      case "not_found":
        return reply.code(404).send({ code: "not_found" });
    }
  }

  async function endSessions(request: FastifyRequest, userId: string) {
    try {
      await deps.deleteSessionsExcept(userId, null);
    } catch (error) {
      // A gravação já valeu; sem a sessão apagada o painel ainda recalcula o acesso a cada pedido.
      request.log.error(
        { errorName: error instanceof Error ? error.name : typeof error },
        "falha ao encerrar sessões do colaborador",
      );
    }
  }

  app.get("/api/settings/members", { preHandler: read }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const { tenantId } = callerOf(request);
    const items = await deps.members.list(tenantId, scopeOf(request), parsed.data);
    const shielded = await Promise.all(
      items.filter(isListable).map((item) => shield(tenantId, item)),
    );
    return { items: shielded.map(present) };
  });

  app.get("/api/settings/members/:id", { preHandler: read }, async (request, reply) => {
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId } = callerOf(request);
    const record = await deps.members.get(tenantId, id, scopeOf(request));
    // Fora do recorte do gerente responde igual a inexistente (sem 403 que confirme o id).
    if (record === null || !isListable(record)) return reply.code(404).send({ code: "not_found" });
    return present(await shield(tenantId, record));
  });

  app.post("/api/settings/members", { preHandler: write }, async (request, reply) => {
    const parsed = memberInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const caller = callerOf(request);
    const outcome = await createMember(caller, parsed.data);
    if (outcome.kind !== "ok") return sendFailure(reply, outcome);
    const { record, inviteEmail } = outcome.value;
    const tenantName = caller.tenantName ?? "";
    if (inviteEmail !== null) {
      try {
        await deps.email.sendMemberInvite({
          to: inviteEmail,
          tenantName,
          loginUrl: deps.loginUrl,
        });
      } catch (error) {
        // O cadastro fica; só o tipo do erro vai ao log (o endereço nunca).
        request.log.error(
          { errorName: error instanceof Error ? error.name : typeof error },
          "falha ao enviar o convite por e-mail",
        );
      }
    }
    return reply.code(201).send(
      memberCreatedSchema.parse({
        member: present(await shield(caller.tenantId, record)),
        inviteText: buildInviteText(record.displayName, tenantName),
      }),
    );
  });

  app.patch("/api/settings/members/:id", { preHandler: write }, async (request, reply) => {
    const parsed = memberPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "invalid_request" });
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const caller = callerOf(request);
    // Sessões encerradas assim que o vínculo é gravado, mesmo que o contato falhe depois (CA09).
    const outcome = await updateMember(caller, id, parsed.data, async (written) => {
      if (written.reducedAccess) await endSessions(request, written.userId);
    });
    if (outcome.kind !== "ok") return sendFailure(reply, outcome);
    const { record } = outcome.value;
    return present(await shield(caller.tenantId, record));
  });

  async function setStatus(
    request: FastifyRequest,
    reply: FastifyReply,
    action: "deactivated" | "reactivate",
  ) {
    const id = idOf(request);
    if (id === null) return reply.code(404).send({ code: "not_found" });
    const { tenantId, actorId } = callerOf(request);
    const current = await deps.members.get(tenantId, id, OWNER_SCOPE);
    if (current === null || !isListable(current))
      return reply.code(404).send({ code: "not_found" });
    const result = await deps.members.setStatus(tenantId, id, action, actorId);
    if (result === null) return reply.code(404).send({ code: "not_found" });
    if (!result.ok) return sendDomainError(reply, result.error);
    if (action === "deactivated") await endSessions(request, current.userId);
    const record = await deps.members.get(tenantId, id, OWNER_SCOPE);
    if (record === null) return reply.code(404).send({ code: "not_found" });
    return present(await shield(tenantId, record));
  }

  app.post("/api/settings/members/:id/deactivate", { preHandler: write }, (request, reply) =>
    setStatus(request, reply, "deactivated"),
  );
  app.post("/api/settings/members/:id/reactivate", { preHandler: write }, (request, reply) =>
    setStatus(request, reply, "reactivate"),
  );
};
