import {
  type AccountStatus,
  type Action,
  accountAllows,
  type ContextSource,
  can,
  formatContextValue,
  type PanelContext,
  type PanelMembership,
  parseContextValue,
  resolvePanelContext,
} from "@app/core";
import type { Database, PanelAccessStore } from "@app/db";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import type { CheckSession } from "../../modules/auth/check-session";
import { authError } from "../auth/auth-messages";
import { toWebHeaders } from "../auth/require-session";

export type PanelRequestContext = PanelContext & {
  source: ContextSource;
  companies: readonly PanelMembership[];
};

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchida por `requirePanelContext`; nas rotas sem ela fica `null`. */
    panel: PanelRequestContext | null;
  }
}

/** O que as rotas do painel recebem da composição: sessão, vínculos e o banco do papel `app`. */
export interface PanelDeps {
  readonly checkSession: CheckSession;
  readonly access: PanelAccessStore;
  /** Banco do papel `app` (RLS): dado de tenant só dentro de `withTenant` (regra 2). */
  readonly appDb: Database;
  /** Cookie `__Secure-` e atributo `Secure` (fora de development). */
  readonly secure: boolean;
}

/** Um ano, em segundos (RF02.CA06: o contexto lembrado sobrevive entre sessões). */
const CONTEXT_MAX_AGE = 31_536_000;

export const CONTEXT_COOKIE = (secure: boolean): "fr_ctx" | "__Secure-fr_ctx" =>
  secure ? "__Secure-fr_ctx" : "fr_ctx";

/** Valor já no formato `<tenantId>.<unitId|all>` (validado por quem chama). */
export function contextCookieHeader(value: string, secure: boolean): string {
  const parts = [
    `${CONTEXT_COOKIE(secure)}=${value}`,
    `Max-Age=${CONTEXT_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Apaga o contexto lembrado (login, cadastro e sair): a próxima pessoa nunca herda a empresa. */
export function expiredContextCookie(secure: boolean): string {
  return `${CONTEXT_COOKIE(secure)}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Lê o cookie de contexto; ausente ou fora do formato vale como ausente, nunca erro. */
export function readContextCookie(
  request: FastifyRequest,
  secure: boolean,
): { tenantId: string; unitId: string } | null {
  const header = request.headers.cookie;
  if (typeof header !== "string") return null;
  const name = CONTEXT_COOKIE(secure);
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    if (piece.slice(0, eq).trim() !== name) continue;
    return parseContextValue(piece.slice(eq + 1).trim());
  }
  return null;
}

/** Decora `request.panel` uma vez só (vários plugins podem pedir). */
export function decoratePanelRequest(app: FastifyInstance): void {
  if (!app.hasRequestDecorator("panel")) app.decorateRequest("panel", null);
}

function requirePanel(request: FastifyRequest): PanelRequestContext {
  if (request.panel == null) throw new Error("requirePanelContext não preencheu o contexto");
  return request.panel;
}

/**
 * Sessão válida e contexto efetivo (cookie ou fallback). 401 sem sessão ou sem nenhum vínculo
 * de painel (DD-25, RF02.CA07). Nunca loga o cookie (regra 9).
 */
export function requirePanelContext(deps: {
  checkSession: CheckSession;
  access: PanelAccessStore;
  secure: boolean;
}): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await deps.checkSession(toWebHeaders(request));
    if (!result.ok) return reply.code(401).send(authError(401));
    if (result.setCookies.length > 0) reply.header("set-cookie", result.setCookies);
    let memberships: PanelMembership[];
    try {
      memberships = await deps.access.listPanelMemberships(result.session.userId);
    } catch (error) {
      // Só o tipo do erro: a mensagem do driver traz SQL e parâmetros (regra 9).
      request.log.error(
        { errorName: error instanceof Error ? error.name : typeof error },
        "falha ao ler os vínculos do painel",
      );
      return reply.code(500).send({ code: "internal" });
    }
    const resolution = resolvePanelContext(memberships, readContextCookie(request, deps.secure));
    if (!resolution.ok) return reply.code(401).send(authError(401));
    request.session = result.session;
    request.panel = {
      ...resolution.context,
      source: resolution.source,
      companies: resolution.companies,
    };
  };
}

/** Rotas de dado de tenant: cookie inválido é 403; `X-Context` velho é 409 (duas abas). */
export function requireTenantRoute(): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const panel = requirePanel(request);
    if (panel.source === "invalid_cookie") {
      return reply.code(403).send({ code: "context_invalid" });
    }
    const raw = request.headers["x-context"];
    const sent = parseContextValue(typeof raw === "string" ? raw : null);
    if (sent === null || formatContextValue(sent) !== formatContextValue(panel)) {
      return reply.code(409).send({ code: "context_changed" });
    }
  };
}

export function requirePermission(action: Action): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const panel = requirePanel(request);
    const unitId = panel.unitId === "all" ? undefined : panel.unitId;
    if (!can(panel.actor, action, { unitId })) {
      return reply.code(403).send({ code: "forbidden" });
    }
  };
}

export function requireWritable(): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const panel = requirePanel(request);
    const status: AccountStatus = panel.accountStatus;
    if (!accountAllows(status, panel.actor.role).write) {
      return reply.code(403).send({ code: "account_read_only" });
    }
  };
}
