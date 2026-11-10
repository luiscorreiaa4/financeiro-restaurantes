import {
  ACTIONS,
  type AccountStatus,
  type Actor,
  accountAllows,
  can,
  type PanelMembership,
  ROLES,
  type Role,
} from "@app/core";
import type { PanelAccessStore } from "@app/db";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { CheckSession } from "../../modules/auth/check-session";
import {
  CONTEXT_COOKIE,
  contextCookieHeader,
  decoratePanelRequest,
  requirePanelContext,
  requirePermission,
  requireTenantRoute,
  requireWritable,
} from "./panel-context";

const TENANT = "0198a000-0000-7000-8000-000000000001";
const UNIT_A = "0198a000-0000-7000-8000-0000000000a1";
const UNIT_B = "0198a000-0000-7000-8000-0000000000b2";

function membership(over: Partial<PanelMembership> = {}): PanelMembership {
  return {
    membershipId: "0198a000-0000-7000-8000-0000000000c1",
    tenantId: TENANT,
    tenantName: "Bistrô",
    accountStatus: "active",
    role: "owner",
    permissions: [],
    panelAccess: true,
    allUnits: false,
    unitIds: [UNIT_A],
    defaultUnitId: UNIT_A,
    preferredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

const session = {
  sessionId: "s1",
  userId: "u1",
  name: "Ana",
  email: "ana@example.com",
  keepConnected: false,
  updatedAt: new Date("2026-11-10T00:00:00Z"),
};

interface Setup {
  checkSession?: CheckSession;
  memberships?: PanelMembership[];
  secure?: boolean;
  route?: ReturnType<typeof requirePermission>[];
  logStream?: { write(line: string): void };
}

function build(setup: Setup = {}) {
  const secure = setup.secure ?? false;
  const checkSession: CheckSession =
    setup.checkSession ?? (async () => ({ ok: true, session, setCookies: [] }));
  const access: PanelAccessStore = {
    listPanelMemberships: async () => setup.memberships ?? [membership()],
  };
  const app = Fastify(
    setup.logStream ? { logger: { level: "error", stream: setup.logStream } } : {},
  );
  app.decorateRequest("session", null);
  decoratePanelRequest(app);
  app.get(
    "/t",
    {
      preHandler: [
        requirePanelContext({ checkSession, access, secure }),
        requireTenantRoute(),
        ...(setup.route ?? []),
      ],
    },
    async (request) => ({
      tenantId: request.panel?.tenantId,
      unitId: request.panel?.unitId,
      source: request.panel?.source,
      companies: request.panel?.companies.length,
    }),
  );
  return app;
}

const ctx = (unit: string = UNIT_A) => `${TENANT}.${unit}`;

describe("guards do painel", () => {
  it("sem sessão responde 401", async () => {
    const app = build({ checkSession: async () => ({ ok: false }) });
    const res = await app.inject({ method: "GET", url: "/t" });
    expect(res.statusCode).toBe(401);
  });

  it("sem nenhum vínculo de painel (no_access) responde 401", async () => {
    const app = build({ memberships: [] });
    const res = await app.inject({ method: "GET", url: "/t", headers: { "x-context": ctx() } });
    expect(res.statusCode).toBe(401);
  });

  it("cookie de empresa sem vínculo em rota de tenant responde 403 context_invalid sem dados", async () => {
    const app = build();
    const stranger = "0198a000-0000-7000-8000-0000000000ff";
    const res = await app.inject({
      method: "GET",
      url: "/t",
      headers: { cookie: `fr_ctx=${stranger}.${UNIT_A}`, "x-context": ctx() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "context_invalid" });
  });

  it("gerente da unidade A com cookie 'all' ou da unidade B tem contexto inválido (RF06.R5)", async () => {
    const app = build({ memberships: [membership({ role: "manager" })] });
    for (const unit of ["all", UNIT_B]) {
      const res = await app.inject({
        method: "GET",
        url: "/t",
        headers: { cookie: `fr_ctx=${TENANT}.${unit}`, "x-context": ctx() },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "context_invalid" });
    }
  });

  it("cookie fora do formato vale como ausente: cai no fallback, sem 500", async () => {
    const app = build();
    const res = await app.inject({
      method: "GET",
      url: "/t",
      headers: { cookie: "fr_ctx=lixo; outro=1", "x-context": ctx() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe("fallback");
  });

  it("X-Context ausente responde 409 context_changed", async () => {
    const res = await build().inject({ method: "GET", url: "/t" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "context_changed" });
  });

  it("X-Context fora do formato responde 409", async () => {
    const res = await build().inject({ method: "GET", url: "/t", headers: { "x-context": "x" } });
    expect(res.statusCode).toBe(409);
  });

  it("X-Context diferente do contexto efetivo responde 409 sem dados (duas abas)", async () => {
    const other = "0198a000-0000-7000-8000-000000000002";
    const res = await build().inject({
      method: "GET",
      url: "/t",
      headers: { cookie: `fr_ctx=${ctx()}`, "x-context": `${other}.${UNIT_A}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "context_changed" });
  });

  it("papel sem a ação responde 403 forbidden", async () => {
    const app = build({
      memberships: [membership({ role: "accountant" })],
      route: [requirePermission("user:manage")],
    });
    const res = await app.inject({ method: "GET", url: "/t", headers: { "x-context": ctx() } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "forbidden" });
  });

  it("conta read_only em requireWritable responde 403 account_read_only", async () => {
    const app = build({
      memberships: [membership({ accountStatus: "read_only" })],
      route: [requireWritable()],
    });
    const res = await app.inject({ method: "GET", url: "/t", headers: { "x-context": ctx() } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "account_read_only" });
  });

  it("conta active em requireWritable passa", async () => {
    const app = build({ route: [requireWritable()] });
    const res = await app.inject({ method: "GET", url: "/t", headers: { "x-context": ctx() } });
    expect(res.statusCode).toBe(200);
  });

  it("tudo certo responde 200 com request.panel preenchido (cookie)", async () => {
    const res = await build().inject({
      method: "GET",
      url: "/t",
      headers: { cookie: `fr_ctx=${ctx()}`, "x-context": ctx() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tenantId: TENANT,
      unitId: UNIT_A,
      source: "cookie",
      companies: 1,
    });
  });

  it("usa o nome __Secure-fr_ctx quando secure e ignora o nome simples", async () => {
    const app = build({ secure: true });
    const res = await app.inject({
      method: "GET",
      url: "/t",
      headers: { cookie: `__Secure-fr_ctx=${ctx()}`, "x-context": ctx() },
    });
    expect(res.json().source).toBe("cookie");
    const plain = await app.inject({
      method: "GET",
      url: "/t",
      headers: { cookie: `fr_ctx=${ctx()}`, "x-context": ctx() },
    });
    expect(plain.json().source).toBe("fallback");
  });

  it("repassa o set-cookie da sessão renovada", async () => {
    const app = build({
      checkSession: async () => ({ ok: true, session, setCookies: ["sess=novo; Path=/"] }),
    });
    const res = await app.inject({ method: "GET", url: "/t", headers: { "x-context": ctx() } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toEqual(["sess=novo; Path=/"]);
  });

  it("mudar o papel no banco entre duas requisições vale já na segunda", async () => {
    let role: Role = "owner";
    const checkSession: CheckSession = async () => ({ ok: true, session, setCookies: [] });
    const access: PanelAccessStore = { listPanelMemberships: async () => [membership({ role })] };
    const app = Fastify();
    app.decorateRequest("session", null);
    decoratePanelRequest(app);
    app.get(
      "/t",
      {
        preHandler: [
          requirePanelContext({ checkSession, access, secure: false }),
          requireTenantRoute(),
          requirePermission("user:manage"),
        ],
      },
      async () => ({ ok: true }),
    );
    const headers = { "x-context": ctx() };
    expect((await app.inject({ method: "GET", url: "/t", headers })).statusCode).toBe(200);
    role = "manager";
    expect((await app.inject({ method: "GET", url: "/t", headers })).statusCode).toBe(403);
  });
});

describe("guards do painel: correções da revisão", () => {
  const headers = (h: Record<string, string>) => ({
    method: "GET" as const,
    url: "/t",
    headers: h,
  });

  it("erro do banco ao ler vínculos vira 500 internal sem vazar a mensagem nem logá-la", async () => {
    const lines: string[] = [];
    const boom = "SELECT * FROM memberships WHERE user_id = 'user-123'";
    const failing = Fastify({
      logger: { level: "error", stream: { write: (l) => lines.push(l) } },
    });
    failing.decorateRequest("session", null);
    decoratePanelRequest(failing);
    failing.get(
      "/t",
      {
        preHandler: [
          requirePanelContext({
            checkSession: async () => ({ ok: true, session, setCookies: [] }),
            access: {
              listPanelMemberships: async () => {
                throw new Error(boom);
              },
            },
            secure: false,
          }),
        ],
      },
      async () => ({ ok: true }),
    );
    const res = await failing.inject(headers({ "x-context": ctx() }));
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: "internal" });
    expect(res.body).not.toContain("SELECT");
    const log = lines.join("");
    expect(log).toContain("falha ao ler os vínculos do painel");
    expect(log).not.toContain("SELECT");
    expect(log).not.toContain("user-123");
  });

  const multi = membership({ allUnits: true, unitIds: [UNIT_A, UNIT_B] });

  it("mesmo tenant com unidade diferente no X-Context responde 409", async () => {
    const app = build({ memberships: [multi] });
    const res = await app.inject(
      headers({ cookie: `fr_ctx=${ctx(UNIT_A)}`, "x-context": ctx(UNIT_B) }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("X-Context 'all' contra contexto em unidade responde 409", async () => {
    const app = build({ memberships: [multi] });
    const res = await app.inject(
      headers({ cookie: `fr_ctx=${ctx(UNIT_A)}`, "x-context": ctx("all") }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("X-Context de unidade contra contexto 'all' responde 409", async () => {
    const app = build({ memberships: [multi] });
    const res = await app.inject(
      headers({ cookie: `fr_ctx=${ctx("all")}`, "x-context": ctx(UNIT_A) }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("set-cookie da sessão renovada sobrevive ao 401 de no_access", async () => {
    const app = build({
      memberships: [],
      checkSession: async () => ({ ok: true, session, setCookies: ["sess=novo; Path=/"] }),
    });
    const res = await app.inject(headers({ "x-context": ctx() }));
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toEqual(["sess=novo; Path=/"]);
  });

  it("cookie fr_ctx duplicado: vale o primeiro", async () => {
    const app = build({ memberships: [multi] });
    const res = await app.inject(
      headers({ cookie: `fr_ctx=${ctx(UNIT_B)}; fr_ctx=${ctx(UNIT_A)}`, "x-context": ctx(UNIT_B) }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().unitId).toBe(UNIT_B);
  });

  it("decoratePanelRequest é idempotente", () => {
    const app = Fastify();
    decoratePanelRequest(app);
    expect(() => decoratePanelRequest(app)).not.toThrow();
  });

  const writable: Record<AccountStatus, (role: Role) => boolean> = {
    active: () => true,
    read_only: () => false,
    canceled: () => false,
    closed: () => false,
  };
  const statusCases = (["active", "read_only", "canceled", "closed"] as const).flatMap((st) =>
    ROLES.map((role) => [st, role] as const),
  );

  it.each(statusCases)("requireWritable com conta %s e papel %s", async (st, role) => {
    const app = build({
      memberships: [membership({ role, accountStatus: st, allUnits: true })],
      route: [requireWritable()],
    });
    const res = await app.inject(headers({ "x-context": ctx("all") }));
    // canceled/closed: o painel nem resolve para quem não lê (401); quem lê não escreve.
    const reads =
      accountAllows(st, role).read &&
      can({ role, permissions: [], units: "all", panelAccess: true }, "panel:access");
    if (!reads) expect(res.statusCode).toBe(401);
    else expect(res.statusCode).toBe(writable[st](role) ? 200 : 403);
  });

  const scoped = ROLES.flatMap((role) => ACTIONS.map((action) => [role, action] as const));
  it.each(scoped)("%s com %s numa unidade específica, ator sem allUnits", async (role, action) => {
    const m = membership({ role, panelAccess: true, allUnits: false, unitIds: [UNIT_A] });
    const actor: Actor = { role, permissions: [], units: [UNIT_A], panelAccess: true };
    const inside = build({ memberships: [m], route: [requirePermission(action)] });
    const ok = await inside.inject(headers({ "x-context": ctx(UNIT_A) }));
    expect(ok.statusCode).toBe(can(actor, action, { unitId: UNIT_A }) ? 200 : 403);
    // Unidade fora do acesso nunca chega ao guard de permissão: o contexto é inválido.
    const outside = await inside.inject(
      headers({ cookie: `fr_ctx=${ctx(UNIT_B)}`, "x-context": ctx(UNIT_A) }),
    );
    expect(outside.statusCode).toBe(403);
    expect(outside.json().code).toBe("context_invalid");
  });
});

describe("cookie de contexto", () => {
  it("monta o Set-Cookie com os atributos exigidos", () => {
    expect(contextCookieHeader(ctx(), false)).toBe(
      `fr_ctx=${ctx()}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`,
    );
    expect(contextCookieHeader(ctx(), true)).toBe(
      `__Secure-fr_ctx=${ctx()}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(CONTEXT_COOKIE(true)).toBe("__Secure-fr_ctx");
  });
});

describe("matriz de permissões nos guards (RF06.CA06)", () => {
  const actorFor = (role: Role): PanelMembership =>
    membership({ role, panelAccess: true, allUnits: true, unitIds: [UNIT_A] });
  const cases = ROLES.flatMap((role) => ACTIONS.map((action) => [role, action] as const));

  it.each(cases)("%s com %s: status igual ao de can()", async (role, action) => {
    const m = actorFor(role);
    const app = build({
      memberships: [m],
      route: [requirePermission(action)],
    });
    const actor: Actor = {
      role,
      permissions: m.permissions,
      units: "all",
      panelAccess: m.panelAccess,
    };
    // Contexto "all": o guard checa a ação sem unidade (can sem unitId).
    const res = await app.inject({
      method: "GET",
      url: "/t",
      headers: { "x-context": `${TENANT}.all` },
    });
    expect(res.statusCode).toBe(can(actor, action) ? 200 : 403);
  });

  it("cobre 4 papéis x 18 ações", () => {
    expect(cases).toHaveLength(72);
  });
});
