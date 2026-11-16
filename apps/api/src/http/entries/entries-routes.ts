import {
  type Action,
  type Actor,
  accountAllows,
  type ChangeContext,
  type Clock,
  can,
  diffVersion,
  type Entry,
  type EntryChange,
  type EntryScope,
  type EntryStore,
  editEntry,
  entryActions,
  entryScopeFor,
  findSupplier,
  markEntryReviewed,
  type PanelPatch,
  parseVersionSnapshot,
  preparePanelEdit,
  type Result,
  restoreEntry,
  softDeleteEntry,
} from "@app/core";
import {
  type BatchPreview,
  batchBodySchema,
  batchPreviewSchema,
  type EntryDetail,
  type EntryItem,
  type EntryListQuery,
  type EntryListResponse,
  type EntryOptions,
  type EntrySource,
  type EntryTotals,
  type EntryVersion,
  entryDeleteBodySchema,
  entryDetailSchema,
  entryListQuerySchema,
  entrySourceSchema,
  entryStaleSchema,
  entryUpdateBodySchema,
  type TrashResponse,
  trashQuerySchema,
  trashResponseSchema,
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
  requireWritable,
} from "../panel/panel-context";

/** O relógio dá o "hoje" do detalhe e da lixeira (RF24.R2); as rotas de lista não o usam. */
export type EntriesRoutesDeps = PanelDeps & {
  readonly clock: Clock;
  /** Cadastro e gravação da edição (F3b): o mesmo `EntryStore` do canal, pelo papel `app`. */
  readonly store: EntryStore;
  /** UUID v7 do fornecedor criado na edição. */
  readonly newId: () => string;
};

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

/** Erro de domínio da edição: o `reason` é o código, para a tela apontar o campo (1.7). */
function invalidEntry(reply: FastifyReply, reason: string) {
  return reply.code(422).send({ code: "invalid_entry", reason });
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

  /**
   * Detalhe do lançamento para o ator, ou `null` se ele não o enxerga. Serve o GET, a resposta
   * da edição e o `current` do 409: todos passam pelo mesmo recorte e pelo mesmo filtro das
   * versões restritas.
   */
  async function readDetail(
    request: FastifyRequest,
    scope: EntryScope,
    id: string,
  ): Promise<EntryDetail | null> {
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
    if (found === null) return null;

    const writable = accountAllows(panel.accountStatus, panel.actor.role).write;
    const body: EntryDetail = {
      ...toItem(found.row, panel.actor, userId, writable),
      versions: found.versions.map((version) =>
        toVersion(version, found.names, scope.includeSensitive),
      ),
    };
    // O contrato é a última barreira: versão restrita com campos não sai (vira 500).
    return entryDetailSchema.parse(body);
  }

  app.get("/api/entries/:id", { preHandler: guards }, async (request, reply) => {
    const id = entryIdOf(request);
    if (id === null) return invalidRequest(reply);
    const scope = accessScopeOf(request);
    if (scope === null) return forbidden(reply);
    const detail = await readDetail(request, scope, id);
    if (detail === null) return notFound(reply);
    return detail;
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

  /**
   * Edição (RF23): `{ expectedVersion, patch, markReviewed }`. Ordem: corpo, lançamento no
   * recorte (404), `can` no estado antigo (403), versão esperada (409 com o detalhe atual),
   * `can` no estado novo (403: categoria sensível ou unidade fora do alcance), fornecedor,
   * regras do domínio (422) e gravação guardada pela versão (`false` também é 409).
   * O `can` do estado antigo vem antes da versão para quem não pode editar nunca receber o
   * detalhe pelo 409.
   */
  app.patch(
    "/api/entries/:id",
    {
      preHandler: [
        requirePanelContext(deps),
        requireTenantRoute(),
        requireEntryAction("entry:edit"),
        requireWritable(),
      ],
    },
    async (request, reply) => {
      const id = entryIdOf(request);
      if (id === null) return invalidRequest(reply);
      const parsed = entryUpdateBodySchema.safeParse(request.body);
      let body: z.output<typeof entryUpdateBodySchema>;
      if (parsed.success) {
        body = parsed.data;
      } else if (parsed.error.issues.every((issue) => issue.message === "nothing_to_change")) {
        // Só a regra "algo para mudar" falhou: o resto do corpo é válido. O 422 sai depois de
        // o lançamento passar pelo recorte e pelas permissões, como qualquer outra edição.
        const { expectedVersion } = request.body as { expectedVersion: number };
        body = { expectedVersion, patch: {}, markReviewed: false };
      } else {
        return invalidRequest(reply);
      }

      const scope = accessScopeOf(request);
      if (scope === null) return forbidden(reply);
      const { panel, userId } = callerOf(request);
      const loaded = await withTenant(deps.appDb, panel.tenantId, (tx) =>
        entryReader.load(tx, scope, [id], deps.clock.today()),
      );
      const found = loaded[0];
      if (found === undefined) return notFound(reply);
      const { entry, categoryIsSensitive } = found;
      const isOwnEntry = entry.createdBy === userId;
      if (
        !can(panel.actor, "entry:edit", {
          unitId: entry.unitId,
          isOwnEntry,
          categoryIsSensitive,
        })
      ) {
        return forbidden(reply);
      }

      const stale = async () => {
        const current = await readDetail(request, scope, id);
        if (current === null) return notFound(reply);
        return reply.code(409).send(entryStaleSchema.parse({ code: "entry_stale", current }));
      };
      if (entry.version !== body.expectedVersion) return stale();

      const { patch } = body;
      const catalog = await deps.store.loadCatalog(panel.tenantId);
      // O estado novo também tem de estar ao alcance (1.6). Categoria enviada que o catálogo não
      // traz conta como sensível (falha fechado). Quem não vê sensíveis recebe, para sensível e
      // para inexistente, o mesmo 422 UnknownReference: o 403 deixaria sondar quais ids são folha.
      let newSensitive = categoryIsSensitive;
      if (patch.categoryId !== undefined) {
        const newCategory = catalog.categories.find((category) => category.id === patch.categoryId);
        newSensitive = newCategory === undefined || newCategory.isSensitive !== false;
        if (newSensitive && !scope.includeSensitive) return invalidEntry(reply, "UnknownReference");
      }
      const newUnitId = patch.unitId ?? entry.unitId;
      if (
        !can(panel.actor, "entry:edit", {
          unitId: newUnitId,
          isOwnEntry,
          categoryIsSensitive: newSensitive,
        })
      ) {
        return forbidden(reply);
      }

      // Fornecedor: existente, limpo, ou nome digitado, que associa o cadastrado (nome ou
      // apelido) ou cria um novo junto da gravação (RF12.R7, RF10).
      const { supplier, ...rest } = patch;
      const panelPatch: { -readonly [K in keyof PanelPatch]: PanelPatch[K] } = { ...rest };
      const newSuppliers: Array<{ id: string; name: string }> = [];
      let editCatalog = catalog;
      if (supplier !== undefined) {
        if (supplier === null) {
          panelPatch.supplier = null;
        } else if ("id" in supplier) {
          panelPatch.supplier = { id: supplier.id };
        } else {
          const known = findSupplier(catalog, supplier.name);
          if (known !== null) {
            panelPatch.supplier = { id: known.id };
          } else {
            const created = { id: deps.newId(), name: supplier.name };
            newSuppliers.push(created);
            panelPatch.supplier = { id: created.id };
            editCatalog = {
              ...catalog,
              suppliers: [...catalog.suppliers, { ...created, aliases: [] }],
            };
          }
        }
      }

      const context = { actorId: userId, channel: "web" as const, at: deps.clock.now() };
      const changes: EntryChange[] = [];
      let current = entry;
      const hasPatch = Object.values(patch).some((value) => value !== undefined);
      if (hasPatch) {
        // "Hoje" no fuso da unidade em que o lançamento fica (RF23.R1).
        const timezone = catalog.units.find((unit) => unit.id === newUnitId)?.timezone;
        const prepared = preparePanelEdit({
          entry,
          patch: panelPatch,
          catalog: editCatalog,
          today: deps.clock.today(timezone),
        });
        if (!prepared.ok) return invalidEntry(reply, prepared.error.code);
        const edited = editEntry(entry, prepared.value, context);
        if (edited.ok) {
          changes.push(edited.value);
          current = edited.value.entry;
        } else if (!(edited.error.code === "NothingToChange" && body.markReviewed)) {
          return invalidEntry(reply, edited.error.code);
        }
      }
      if (body.markReviewed) {
        // Sobre o resultado da edição: duas versões consecutivas na mesma gravação (S9).
        const reviewed = markEntryReviewed(current, context);
        if (reviewed.ok) {
          changes.push(reviewed.value);
        } else if (reviewed.error.code !== "NothingToChange") {
          return invalidEntry(reply, reviewed.error.code);
        }
      } else if (changes.length === 0) {
        return invalidEntry(reply, "NothingToChange");
      }

      // Revisar lançamento sem sinais e sem edição não grava versão: devolve o detalhe atual.
      if (changes.length > 0) {
        const applied = await deps.store.applyChanges(panel.tenantId, changes, { newSuppliers });
        if (!applied) return stale();
      }
      const detail = await readDetail(request, scope, id);
      if (detail === null) throw new Error("lançamento editado não encontrado");
      return detail;
    },
  );

  // -------------------------------------------------------------------------------------
  // Exclusão, restauração e lote (RF24). As rotas `/batch/*` vêm antes das de `:id`.
  // -------------------------------------------------------------------------------------

  /** Escrita de lançamento: mesmos guards da edição, com a ação pedida. */
  const writeGuards = (action: Action) => [
    requirePanelContext(deps),
    requireTenantRoute(),
    requireEntryAction(action),
    requireWritable(),
  ];

  /**
   * Lote só para dono e gerente (RF24.Obs3). O `can` do lançador vale para os próprios, e o
   * lote é de outro nível: ele recebe 403 antes de qualquer leitura.
   */
  function canBatch(request: FastifyRequest): boolean {
    const { role } = callerOf(request).panel.actor;
    return role === "owner" || role === "manager";
  }

  /**
   * Tudo ou nada: o lote só segue se `load` devolveu TODOS os ids, nenhum já excluído e com
   * `can("entry:delete")` válido para cada um. Qualquer falha é um 404 só (sem dizer qual id nem
   * por quê). Devolve a quantidade e a soma do banco para os ids lidos.
   */
  async function loadBatch(request: FastifyRequest, reply: FastifyReply) {
    if (!canBatch(request)) {
      forbidden(reply);
      return null;
    }
    const parsed = batchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      invalidRequest(reply);
      return null;
    }
    const scope = accessScopeOf(request);
    if (scope === null) {
      forbidden(reply);
      return null;
    }
    const { panel, userId } = callerOf(request);
    const today = deps.clock.today();
    const ids = parsed.data.ids;
    const loaded = await withTenant(deps.appDb, panel.tenantId, async (tx) => {
      const found = await entryReader.load(tx, scope, ids, today);
      if (found.length !== ids.length) return null;
      const allowed = found.every(
        ({ entry, categoryIsSensitive }) =>
          entry.deletedAt === null &&
          can(panel.actor, "entry:delete", {
            unitId: entry.unitId,
            isOwnEntry: entry.createdBy === userId,
            categoryIsSensitive,
          }),
      );
      if (!allowed) return null;
      const total = await entryReader.sum(
        tx,
        scope,
        found.map(({ entry }) => entry.id),
        today,
      );
      return { found, total };
    });
    if (loaded === null) {
      notFound(reply);
      return null;
    }
    return { ...loaded, reason: parsed.data.reason, panel, userId };
  }

  app.post(
    "/api/entries/batch/preview",
    { preHandler: writeGuards("entry:delete") },
    async (request, reply) => {
      const batch = await loadBatch(request, reply);
      if (batch === null) return reply;
      const body: BatchPreview = batchPreviewSchema.parse(batch.total);
      return body;
    },
  );

  app.post(
    "/api/entries/batch/delete",
    { preHandler: writeGuards("entry:delete") },
    async (request, reply) => {
      const batch = await loadBatch(request, reply);
      if (batch === null) return reply;
      const context = { actorId: batch.userId, channel: "web" as const, at: deps.clock.now() };
      const changes: EntryChange[] = [];
      for (const { entry } of batch.found) {
        const deleted = softDeleteEntry(entry, context, { reason: batch.reason });
        if (!deleted.ok) return invalidEntry(reply, deleted.error.code);
        changes.push(deleted.value);
      }
      // Uma gravação só: se algum lançamento mudou no meio, nenhum é excluído.
      const applied = await deps.store.applyChanges(batch.panel.tenantId, changes);
      if (!applied) return reply.code(409).send({ code: "entry_stale" });
      const body: BatchPreview = batchPreviewSchema.parse(batch.total);
      return body;
    },
  );

  /**
   * Exclusão e restauração de um lançamento: corpo, lançamento no recorte (404, inclusive
   * lixeira vencida), `can` com o lançamento carregado (403), regra do domínio (422) e gravação
   * guardada pela versão lida (409 com o detalhe atual). Responde o detalhe novo.
   */
  async function mutateOne(
    request: FastifyRequest,
    reply: FastifyReply,
    action: "entry:delete" | "entry:restore",
    run: (entry: Entry, context: ChangeContext) => Result<EntryChange, { code: string }>,
  ) {
    const id = entryIdOf(request);
    if (id === null) return invalidRequest(reply);
    const scope = accessScopeOf(request);
    if (scope === null) return forbidden(reply);
    const { panel, userId } = callerOf(request);
    const loaded = await withTenant(deps.appDb, panel.tenantId, (tx) =>
      entryReader.load(tx, scope, [id], deps.clock.today()),
    );
    const found = loaded[0];
    if (found === undefined) return notFound(reply);
    const { entry, categoryIsSensitive } = found;
    if (
      !can(panel.actor, action, {
        unitId: entry.unitId,
        isOwnEntry: entry.createdBy === userId,
        categoryIsSensitive,
      })
    ) {
      return forbidden(reply);
    }
    const context = { actorId: userId, channel: "web" as const, at: deps.clock.now() };
    const result = run(entry, context);
    if (!result.ok) return invalidEntry(reply, result.error.code);
    const applied = await deps.store.applyChanges(panel.tenantId, [result.value]);
    const detail = await readDetail(request, scope, id);
    if (detail === null) return notFound(reply);
    if (!applied) {
      return reply.code(409).send(entryStaleSchema.parse({ code: "entry_stale", current: detail }));
    }
    return detail;
  }

  app.delete(
    "/api/entries/:id",
    { preHandler: writeGuards("entry:delete") },
    async (request, reply) => {
      // Sem corpo é válido: o motivo é opcional (RF24.R1).
      const parsed = entryDeleteBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) return invalidRequest(reply);
      return mutateOne(request, reply, "entry:delete", (entry, context) =>
        softDeleteEntry(entry, context, { reason: parsed.data.reason }),
      );
    },
  );

  /**
   * Lixeira (RF24.R2): excluídos ainda restauráveis, no recorte de `entryScopeFor`. Quem não
   * restaura (contador) não tem lixeira: 403 pelo guard. "Hoje" é o mesmo relógio da
   * restauração, então o que aparece aqui é o que `restore` aceita. O filtro de quem excluiu
   * não vale para o lançador, que só vê os próprios (como "lançado por" na lista).
   */
  app.get(
    "/api/trash",
    {
      preHandler: [
        requirePanelContext(deps),
        requireTenantRoute(),
        requireEntryAction("entry:restore"),
      ],
    },
    async (request, reply) => {
      const parsed = trashQuerySchema.safeParse(request.query);
      if (!parsed.success) return invalidRequest(reply);
      const scope = scopeOf(request, parsed.data.unitIds);
      if (scope === null) return forbidden(reply);
      const query =
        scope.ownerUserId === null ? parsed.data : { ...parsed.data, deletedBy: undefined };
      const { panel, userId } = callerOf(request);
      const page = await withTenant(deps.appDb, panel.tenantId, (tx) =>
        entryReader.trash(tx, scope, query, deps.clock.today()),
      );
      const writable = accountAllows(panel.accountStatus, panel.actor.role).write;
      const body: TrashResponse = {
        items: page.rows.map((row) => toItem(row, panel.actor, userId, writable)),
        nextCursor: page.nextCursor,
      };
      // O contrato é a última barreira da saída (nada além do que ele declara).
      return trashResponseSchema.parse(body);
    },
  );

  app.post(
    "/api/entries/:id/restore",
    { preHandler: writeGuards("entry:restore") },
    async (request, reply) =>
      mutateOne(request, reply, "entry:restore", (entry, context) => restoreEntry(entry, context)),
  );
};
