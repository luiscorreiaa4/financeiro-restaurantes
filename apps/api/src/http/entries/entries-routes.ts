import {
  type Action,
  type Actor,
  accountAllows,
  type Clock,
  can,
  diffVersion,
  type EntryScope,
  entryActions,
  entryScopeFor,
  parseVersionSnapshot,
} from "@app/core";
import {
  type EntryDetail,
  type EntryItem,
  type EntryListQuery,
  type EntryListResponse,
  type EntryOptions,
  type EntrySource,
  type EntryTotals,
  type EntryVersion,
  entryDetailSchema,
  entryListQuerySchema,
  entrySourceSchema,
} from "@app/core/contracts";
import {
  type EntryNames,
  type EntryRow,
  type EntryVersionRow,
  entryReader,
  InvalidCursorError,
  withTenant,
} from "@app/db";
import type {
  FastifyError,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { z } from "zod";
import {
  decoratePanelRequest,
  type PanelDeps,
  type PanelRequestContext,
  requirePanelContext,
  requireTenantRoute,
} from "../panel/panel-context";

/** O relógio dá o "hoje" do detalhe e da lixeira (RF24.R2); as rotas de lista não o usam. */
export type EntriesRoutesDeps = PanelDeps & { readonly clock: Clock };

interface Caller {
  readonly panel: PanelRequestContext;
  readonly userId: string;
}

function callerOf(request: FastifyRequest): Caller {
  if (request.panel == null || request.session == null) {
    throw new Error("requirePanelContext não preencheu o contexto");
  }
  return { panel: request.panel, userId: request.session.userId };
}

/**
 * Recorte do chamador (1.6 do desenho): toda consulta de lançamentos passa por aqui. `null`
 * quando o pedido cita unidade fora do acesso; a rota responde 403 sem dado (RF06.R5).
 */
export function scopeOf(
  request: FastifyRequest,
  requestedUnitIds?: readonly string[],
): EntryScope | null {
  const { panel, userId } = callerOf(request);
  const scope = entryScopeFor({
    actor: panel.actor,
    userId,
    activeUnitId: panel.unitId,
    requestedUnitIds,
  });
  return scope.ok ? scope.value : null;
}

/**
 * Recorte pelas unidades de ACESSO do ator, e não pela do seletor nem pela de um filtro.
 * Vale para as opções de filtro (o filtro de unidade oferece todas as que ele pode consultar,
 * RF22.R2) e para o detalhe e a origem: a lista aceita filtro de unidade fora do seletor, e o
 * lançamento que ela mostrou tem de abrir. Autor e sensível continuam valendo.
 */
function accessScopeOf(request: FastifyRequest): EntryScope | null {
  const { panel, userId } = callerOf(request);
  const scope = entryScopeFor({ actor: panel.actor, userId, activeUnitId: "all" });
  return scope.ok ? scope.value : null;
}

/**
 * Linha do leitor para o item do contrato: tira os campos internos e acrescenta o que o ator
 * pode fazer (conforto para a tela; cada mutação repete a checagem). Categoria não resolvida
 * chega do leitor como sensível e é tratada assim. Com a conta sem gravação (`writable`
 * falso, a mesma condição de `requireWritable`), nenhuma ação é oferecida. `writable` não
 * tem padrão de propósito: quem chama tem de dizer, para não oferecer ação por esquecimento.
 */
export function toItem<Row extends EntryRow>(
  row: Row,
  actor: Actor,
  userId: string,
  writable: boolean,
): Omit<Row, "categoryIsSensitive" | "createdById" | "deletedAt"> &
  Pick<EntryItem, "canEdit" | "canDelete" | "canRestore"> {
  const { categoryIsSensitive, createdById, deletedAt, ...item } = row;
  if (!writable) return { ...item, canEdit: false, canDelete: false, canRestore: false };
  return {
    ...item,
    ...entryActions(
      actor,
      {
        unitId: row.unit.id,
        createdBy: createdById,
        categoryIsSensitive,
        deleted: deletedAt !== null,
      },
      userId,
    ),
  };
}

/**
 * Guard de permissão das rotas de lançamentos: use no lugar de `requirePermission(action)`
 * em toda rota de `/api/entries` (leitura agora; edição, exclusão e restauração no F3b).
 *
 * `requirePermission` pergunta `can(actor, action, { unitId })`, e para o lançador o `can`
 * só libera ver, editar, excluir e restaurar os PRÓPRIOS lançamentos: sem `isOwnEntry` ele
 * seria barrado em toda rota, contra o RF22.R3. Aqui a pergunta é pelo melhor caso
 * (lançamento próprio, não sensível, na unidade do seletor): o guard só barra quem não tem a
 * ação em lançamento nenhum (o contador nas escritas, por exemplo). Quem decide lançamento a
 * lançamento é o recorte (`entryScopeFor`), em cada consulta, e `can`/`entryActions` com o
 * lançamento carregado, em cada mutação. Passar por este guard não autoriza nada sozinho.
 */
export function requireEntryAction(action: Action): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const { panel } = callerOf(request);
    const unitId = panel.unitId === "all" ? undefined : panel.unitId;
    if (!can(panel.actor, action, { unitId, isOwnEntry: true })) {
      return forbidden(reply);
    }
  };
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ code: "forbidden" });
}

function invalidRequest(reply: FastifyReply) {
  return reply.code(400).send({ code: "invalid_request" });
}

/**
 * Uma resposta só para lançamento que não existe, é de outra empresa, está fora do recorte
 * (unidade, autor, sensível) ou na lixeira vencida: o chamador não descobre qual (1.6).
 */
function notFound(reply: FastifyReply) {
  return reply.code(404).send({ code: "not_found" });
}

const entryIdSchema = z.uuid();

/** O `:id` da rota, ou `null` quando não é UUID. */
function entryIdOf(request: FastifyRequest): string | null {
  const parsed = entryIdSchema.safeParse((request.params as { id?: unknown }).id);
  return parsed.success ? parsed.data : null;
}

/** O diff de uma versão como está no banco; `after` ilegível conta como sensível. */
function diffOf(row: EntryVersionRow, names: EntryNames) {
  const after = parseVersionSnapshot(row.after) ?? {};
  return diffVersion(parseVersionSnapshot(row.before), after, names);
}

/**
 * O lançamento já esteve em categoria sensível em alguma versão, pelo mesmo critério do
 * histórico (falha fechado). A mensagem de origem foi escrita quando ele nasceu: se nasceu na
 * folha, o texto cita o dado restrito mesmo depois de reclassificado.
 */
export function hasSensitiveVersion(versions: readonly EntryVersionRow[], names: EntryNames) {
  return versions.some((version) => diffOf(version, names).sensitive);
}

/**
 * Versão do histórico para a resposta (RF25.R4). Versão que passou por categoria sensível
 * (antes ou depois) vai sem campo nenhum para quem não vê sensíveis: o lançamento que saiu da
 * folha não mostra o salário antigo. A regra do que é sensível é de `diffVersion`.
 */
export function toVersion(
  row: EntryVersionRow,
  names: EntryNames,
  includeSensitive: boolean,
): EntryVersion {
  const diff = diffOf(row, names);
  const restricted = diff.sensitive && !includeSensitive;
  return {
    version: row.version,
    action: row.action as EntryVersion["action"],
    channel: row.channel as EntryVersion["channel"],
    changedBy: row.changedBy,
    changedAt: row.changedAt,
    restricted,
    changes: restricted ? [] : [...diff.changes],
  };
}

/**
 * Lançamentos do painel (F3a, RF22, RF25): lista, totais, opções de filtro, detalhe com
 * histórico e origem. É a fronteira de
 * autorização: o recorte sai de `entryScopeFor` e o dado só é lido dentro de `withTenant`.
 * Erros só com `{ code }`; nada de conteúdo de lançamento, nome, e-mail, valor, cookie ou
 * `X-Context` em log (regra 9, RNF11).
 */
export const entriesRoutes: FastifyPluginAsync<{ deps: EntriesRoutesDeps }> = async (
  app,
  { deps },
) => {
  decoratePanelRequest(app);
  if (!app.hasRequestDecorator("session")) app.decorateRequest("session", null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Cursor adulterado, ilegível ou de outra ordenação é pedido inválido, nunca 500.
    if (error instanceof InvalidCursorError) return invalidRequest(reply);
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      // Só o tipo do erro: a mensagem do driver traz SQL e parâmetros.
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha nos lançamentos");
      return reply.code(500).send({ code: "internal" });
    }
    return reply.code(status).send({ code: "invalid_request" });
  });

  const guards = [
    requirePanelContext(deps),
    requireTenantRoute(),
    requireEntryAction("entry:view"),
  ];

  /** Query validada e recorte resolvido, ou a resposta de erro já enviada. */
  function readRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): { query: EntryListQuery; scope: EntryScope } | null {
    const parsed = entryListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      invalidRequest(reply);
      return null;
    }
    const scope = scopeOf(request, parsed.data.unitIds);
    if (scope === null) {
      forbidden(reply);
      return null;
    }
    return { query: parsed.data, scope };
  }

  app.get("/api/entries", { preHandler: guards }, async (request, reply) => {
    const input = readRequest(request, reply);
    if (input === null) return reply;
    const { panel, userId } = callerOf(request);
    const page = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      entryReader.list(tx, input.scope, input.query),
    );
    // Mesma condição de `requireWritable` (RF37): conta somente leitura não altera nada.
    const writable = accountAllows(panel.accountStatus, panel.actor.role).write;
    const body: EntryListResponse = {
      items: page.rows.map((row) => toItem(row, panel.actor, userId, writable)),
      nextCursor: page.nextCursor,
    };
    return body;
  });

  app.get("/api/entries/totals", { preHandler: guards }, async (request, reply) => {
    const input = readRequest(request, reply);
    if (input === null) return reply;
    const { panel } = callerOf(request);
    const totals = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      entryReader.totals(tx, input.scope, input.query),
    );
    const body: EntryTotals = {
      revenueCents: totals.revenueCents,
      expenseCents: totals.expenseCents,
      // Inteiros em centavos: a subtração é exata (RNF13); a tela não soma (RF22.Obs2).
      resultCents: totals.revenueCents - totals.expenseCents,
      count: totals.count,
      hasRestricted: totals.hasRestricted,
    };
    return body;
  });

  app.get("/api/entries/options", { preHandler: guards }, async (request, reply) => {
    const scope = accessScopeOf(request);
    if (scope === null) return forbidden(reply);
    const { panel } = callerOf(request);
    const body: EntryOptions = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      entryReader.options(tx, scope),
    );
    return body;
  });

  app.get("/api/entries/:id", { preHandler: guards }, async (request, reply) => {
    const id = entryIdOf(request);
    if (id === null) return invalidRequest(reply);
    const scope = accessScopeOf(request);
    if (scope === null) return forbidden(reply);
    const { panel, userId } = callerOf(request);
    // Hoje como data de negócio: decide se a lixeira ainda é restaurável (RF24.R2).
    const today = deps.clock.today();
    const found = await withTenant(deps.appDb, panel.tenantId, async (tx) => {
      const row = await entryReader.find(tx, scope, id, today);
      // Histórico e nomes não têm recorte: só depois de o lançamento passar pelo `find`.
      if (row === null) return null;
      return {
        row,
        versions: await entryReader.versions(tx, row.id),
        names: await entryReader.names(tx),
      };
    });
    if (found === null) return notFound(reply);

    const writable = accountAllows(panel.accountStatus, panel.actor.role).write;
    const body: EntryDetail = {
      ...toItem(found.row, panel.actor, userId, writable),
      versions: found.versions.map((version) =>
        toVersion(version, found.names, scope.includeSensitive),
      ),
    };
    // O contrato é a última barreira: versão restrita com campos não sai (vira 500).
    return entryDetailSchema.parse(body);
  });

  app.get("/api/entries/:id/source", { preHandler: guards }, async (request, reply) => {
    const id = entryIdOf(request);
    if (id === null) return invalidRequest(reply);
    const scope = accessScopeOf(request);
    if (scope === null) return forbidden(reply);
    const { panel } = callerOf(request);
    const today = deps.clock.today();
    const found = await withTenant(deps.appDb, panel.tenantId, async (tx) => {
      // A origem e o histórico não têm recorte: só depois de o lançamento passar pelo `find`.
      const row = await entryReader.find(tx, scope, id, today);
      if (row === null) return null;
      const source = await entryReader.source(tx, row.id);
      if (source === null) return null;
      // Quem vê sensíveis recebe a origem inteira: não precisa do histórico.
      if (scope.includeSensitive) return { source, restricted: false };
      // A mensagem cita dado restrito quando gerou outro lançamento de categoria sensível
      // (RF25.Obs1) ou quando este lançamento já esteve em uma, mesmo reclassificado depois.
      const restricted =
        source.siblingsSensitive ||
        hasSensitiveVersion(await entryReader.versions(tx, row.id), await entryReader.names(tx));
      return { source, restricted };
    });
    if (found === null) return notFound(reply);
    const { source, restricted } = found;

    const body: EntrySource = {
      channel: source.channel as EntrySource["channel"],
      kind: source.kind,
      text: restricted ? null : source.text,
      transcription: restricted ? null : source.transcription,
      accessKey: restricted ? null : source.accessKey,
      sentBy: source.sentBy,
      sentAt: source.sentAt,
      restricted,
      // Áudio e imagem só na E10 (DD-36, F3-1).
      mediaAvailable: false,
    };
    return entrySourceSchema.parse(body);
  });
};
