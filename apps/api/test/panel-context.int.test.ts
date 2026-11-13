import { createDatabase, createPool, uuidv7 } from "@app/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { type AuthHarness, setCookies, startAuthHarness } from "./support/auth-harness";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

beforeAll(async () => {
  h = await startAuthHarness();
});

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.reset();
});

interface Tenant {
  tenantId: string;
  unitIds: string[];
}

/** Empresa nova com unidades ativas, na ordem em que foram dadas. */
async function addTenant(unitNames: string[] = ["Matriz"], status = "active"): Promise<Tenant> {
  const tenantId = uuidv7();
  await h.db.admin.query("insert into tenants (id, name, status) values ($1, $2, $3)", [
    tenantId,
    `Empresa ${tenantId.slice(-4)}`,
    status,
  ]);
  const unitIds: string[] = [];
  for (const name of unitNames) {
    const id = uuidv7();
    await h.db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, $3)", [
      id,
      tenantId,
      name,
    ]);
    unitIds.push(id);
  }
  return { tenantId, unitIds };
}

async function addMembership(
  userId: string,
  tenant: Tenant,
  options: {
    role?: string;
    allUnits?: boolean;
    unitIds?: string[];
    preferredAt?: Date | null;
    panelAccess?: boolean;
    defaultUnitId?: string | null;
  } = {},
): Promise<string> {
  const id = uuidv7();
  await h.db.admin.query(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, preferred_at, default_unit_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      tenant.tenantId,
      userId,
      options.role ?? "owner",
      options.allUnits ?? true,
      options.panelAccess ?? true,
      options.preferredAt ?? null,
      options.defaultUnitId ?? null,
    ],
  );
  for (const unitId of options.unitIds ?? []) {
    await h.db.admin.query(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenant.tenantId, id, unitId],
    );
  }
  return id;
}

const login = async (address: string) => h.sessionCookie(await h.signInPassword(address, PASSWORD));

/** Usuário com senha e uma empresa própria (dono, todas as unidades) criada pelo harness. */
async function ownerOfOne() {
  const user = await h.createUser({ password: PASSWORD });
  const { rows } = await h.db.admin.query<{ tenant_id: string; unit_id: string }>(
    `select m.tenant_id, (select id from units u where u.tenant_id = m.tenant_id) as unit_id
       from memberships m where m.user_id = $1`,
    [user.userId],
  );
  const own: Tenant = {
    tenantId: rows[0]?.tenant_id as string,
    unitIds: [rows[0]?.unit_id as string],
  };
  return { ...user, own, session: await login(user.email) };
}

/** Usuário sem vínculo ativo na empresa do harness; os vínculos vêm dos testes. */
async function loneUser() {
  const user = await h.createUser({ password: PASSWORD });
  await h.db.admin.query("update memberships set status = 'deactivated' where user_id = $1", [
    user.userId,
  ]);
  return user;
}

function call(
  method: "GET" | "POST",
  url: string,
  cookie: string,
  extra: { ctx?: string; xContext?: string; body?: unknown } = {},
) {
  const cookies = [cookie, extra.ctx !== undefined ? `${CTX}=${extra.ctx}` : ""]
    .filter(Boolean)
    .join("; ");
  return h.app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      origin: h.origin,
      "user-agent": "vitest",
      cookie: cookies,
      ...(extra.xContext ? { "x-context": extra.xContext } : {}),
      ...(extra.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(extra.body !== undefined ? { payload: JSON.stringify(extra.body) } : {}),
  });
}

const me = (session: string, ctx?: string) => call("GET", "/api/me", session, { ctx });
const units = (session: string, ctx: string, xContext = ctx) =>
  call("GET", "/api/units", session, { ctx, xContext });

interface MeBody {
  email: string;
  companies: {
    tenantId: string;
    role: string;
    accountStatus: string;
    startUnitId: string;
  }[];
  context: {
    tenantId: string;
    unitId: string;
    role: string;
    allUnits: boolean;
    unitIds: string[];
    allowedActions: string[];
  };
  contextSource: string;
}

describe("/api/me com contexto", () => {
  it("sem cookie de contexto: fallback pela empresa de preferred_at mais recente", async () => {
    const user = await ownerOfOne();
    const other = await addTenant(["Centro"]);
    await addMembership(user.userId, other, { preferredAt: new Date("2026-11-01T00:00:00Z") });
    const response = await me(user.session);
    expect(response.statusCode).toBe(200);
    const body = response.json() as MeBody;
    expect(body.contextSource).toBe("fallback");
    expect(body.context.tenantId).toBe(other.tenantId);
    expect(body.context.unitId).toBe("all");
    expect(body.context.allUnits).toBe(true);
    expect(body.email).toBe(user.email);
    expect(body.companies.map((c) => c.tenantId).sort()).toEqual(
      [user.own.tenantId, other.tenantId].sort(),
    );
    expect(body.companies.every((c) => c.startUnitId === "all")).toBe(true);
    expect(body.context.allowedActions).toContain("panel:access");
  });

  it("cookie com formato torto vale como ausente, nunca 500", async () => {
    const user = await ownerOfOne();
    for (const raw of ["lixo", "a.b", `${user.own.tenantId}.`, ""]) {
      const response = await me(user.session, raw);
      expect(response.statusCode, raw).toBe(200);
      expect((response.json() as MeBody).contextSource).toBe("fallback");
    }
  });

  it("papel trocado no banco muda allowedActions na requisição seguinte, sem novo login", async () => {
    const user = await ownerOfOne();
    const before = (await me(user.session)).json() as MeBody;
    expect(before.context.role).toBe("owner");
    await h.db.admin.query("update memberships set role = 'accountant' where user_id = $1", [
      user.userId,
    ]);
    const after = (await me(user.session)).json() as MeBody;
    expect(after.context.role).toBe("accountant");
    expect(after.context.allowedActions).not.toEqual(before.context.allowedActions);
    expect(after.context.allowedActions.length).toBeLessThan(before.context.allowedActions.length);
  });

  it("RF02.CA07: vínculo desativado depois do login dá 401 na próxima chamada", async () => {
    const user = await ownerOfOne();
    expect((await me(user.session)).statusCode).toBe(200);
    await h.db.admin.query("update memberships set status = 'deactivated' where user_id = $1", [
      user.userId,
    ]);
    // Sem vínculo ativo o usuário vira restrito (DD-33): /api/me aceita, as rotas de tenant não.
    const restricted = await me(user.session);
    expect(restricted.statusCode).toBe(200);
    expect(restricted.json().access).toBe("restricted");
    expect((await call("GET", "/api/units", user.session)).statusCode).toBe(401);
  });

  it("sem sessão: 401", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/me" });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/context", () => {
  it("válido: 204 com o cookie fr_ctx e o próximo /api/me vem com source cookie", async () => {
    const user = await ownerOfOne();
    const other = await addTenant(["Centro"]);
    await addMembership(user.userId, other, { preferredAt: new Date("2026-11-01T00:00:00Z") });
    const value = `${user.own.tenantId}.all`;
    const response = await call("POST", "/api/context", user.session, {
      body: { tenantId: user.own.tenantId, unitId: "all" },
    });
    expect(response.statusCode).toBe(204);
    const cookie = setCookies(response).find((c) => c.startsWith(`${CTX}=`));
    expect(cookie).toContain(`${CTX}=${value}`);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Secure/);
    const next = (await me(user.session, value)).json() as MeBody;
    expect(next.contextSource).toBe("cookie");
    expect(next.context.tenantId).toBe(user.own.tenantId);
  });

  it("empresa alheia: 403 context_invalid e nenhum Set-Cookie fr_ctx", async () => {
    const user = await ownerOfOne();
    const foreign = await addTenant();
    const response = await call("POST", "/api/context", user.session, {
      body: { tenantId: foreign.tenantId, unitId: "all" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "context_invalid" });
    expect(setCookies(response).some((c) => c.includes("fr_ctx"))).toBe(false);
  });

  it("gerente limitado a uma unidade: all e unidade de outro são 403", async () => {
    const user = await loneUser();
    const t = await addTenant(["A", "B"]);
    await addMembership(user.userId, t, {
      role: "manager",
      allUnits: false,
      unitIds: [t.unitIds[0] as string],
    });
    const session = await login(user.email);
    for (const unitId of ["all", t.unitIds[1] as string]) {
      const response = await call("POST", "/api/context", session, {
        body: { tenantId: t.tenantId, unitId },
      });
      expect(response.statusCode, unitId).toBe(403);
      expect(setCookies(response).some((c) => c.includes("fr_ctx"))).toBe(false);
    }
    const ok = await call("POST", "/api/context", session, {
      body: { tenantId: t.tenantId, unitId: t.unitIds[0] },
    });
    expect(ok.statusCode).toBe(204);
  });

  it("corpo torto: 400", async () => {
    const user = await ownerOfOne();
    for (const body of [
      {},
      { tenantId: "nao-uuid", unitId: "all" },
      { tenantId: user.own.tenantId, unitId: "todas" },
      { tenantId: user.own.tenantId },
    ]) {
      const response = await call("POST", "/api/context", user.session, { body });
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("GET /api/units e o contexto", () => {
  it("RF02.CA06: cookie de empresa cujo vínculo foi desativado depois: units 403 e me com invalid_cookie", async () => {
    const user = await ownerOfOne();
    const second = await addTenant(["Centro"]);
    const membership = await addMembership(user.userId, second);
    const ctx = `${second.tenantId}.all`;
    expect((await units(user.session, ctx)).statusCode).toBe(200);
    await h.db.admin.query("update memberships set status = 'deactivated' where id = $1", [
      membership,
    ]);
    expect((await units(user.session, ctx)).statusCode).toBe(403);
    const body = (await me(user.session, ctx)).json() as MeBody;
    expect(body.contextSource).toBe("invalid_cookie");
    expect(body.context.tenantId).toBe(user.own.tenantId);
  });

  it("cookie forjado para empresa alheia: me com invalid_cookie e units 403", async () => {
    const user = await ownerOfOne();
    const foreign = await addTenant(["Segredo"]);
    const ctx = `${foreign.tenantId}.${foreign.unitIds[0]}`;
    const body = (await me(user.session, ctx)).json() as MeBody;
    expect(body.contextSource).toBe("invalid_cookie");
    expect(body.context.tenantId).toBe(user.own.tenantId);
    const response = await units(user.session, ctx);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "context_invalid" });
    expect(response.body).not.toContain("Segredo");
  });

  it("RNF02.CA01: as unidades de A nunca trazem unidade de B", async () => {
    const user = await ownerOfOne();
    const foreign = await addTenant(["Alheia"]);
    const response = await units(user.session, `${user.own.tenantId}.all`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ units: [{ id: user.own.unitIds[0], name: "Matriz" }] });
    expect(response.body).not.toContain(foreign.unitIds[0] as string);
  });

  it("RF06.R5: gerente com unidades [A] vê só A; cookie all ou da B é contexto inválido, sem listar B", async () => {
    const user = await loneUser();
    const t = await addTenant(["A", "B"]);
    const [a, b] = t.unitIds as [string, string];
    await addMembership(user.userId, t, { role: "manager", allUnits: false, unitIds: [a] });
    const session = await login(user.email);

    const ok = await units(session, `${t.tenantId}.${a}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ units: [{ id: a, name: "A" }] });

    for (const ctx of [`${t.tenantId}.all`, `${t.tenantId}.${b}`]) {
      const response = await units(session, ctx);
      expect(response.statusCode, ctx).toBe(403);
      expect(response.body).not.toContain(b);
      const body = (await me(session, ctx)).json() as MeBody;
      expect(body.contextSource).toBe("invalid_cookie");
      expect(body.context.unitId).toBe(a);
      expect(body.context.unitIds).toEqual([a]);
    }
  });

  it("unidade inativada com cookie apontando para ela: mantém a empresa, devolve outra unidade, invalid_cookie", async () => {
    const user = await loneUser();
    const t = await addTenant(["A", "B"]);
    const [a, b] = t.unitIds as [string, string];
    await addMembership(user.userId, t, { role: "manager", allUnits: false, unitIds: [a, b] });
    const session = await login(user.email);
    const ctx = `${t.tenantId}.${a}`;
    expect(((await me(session, ctx)).json() as MeBody).contextSource).toBe("cookie");
    await h.db.admin.query("update units set status = 'inactive' where id = $1", [a]);
    const body = (await me(session, ctx)).json() as MeBody;
    expect(body.contextSource).toBe("invalid_cookie");
    expect(body.context.tenantId).toBe(t.tenantId);
    expect(body.context.unitId).toBe(b);
    const response = await units(session, `${t.tenantId}.${b}`);
    expect(response.json()).toEqual({ units: [{ id: b, name: "B" }] });
  });

  it("duas abas: X-Context antigo depois da troca de empresa dá 409 context_changed e nenhum dado", async () => {
    const user = await ownerOfOne();
    const second = await addTenant(["Centro"]);
    await addMembership(user.userId, second);
    const oldCtx = `${user.own.tenantId}.all`;
    const newCtx = `${second.tenantId}.all`;
    expect((await units(user.session, oldCtx)).statusCode).toBe(200);
    // A aba 1 troca de empresa: o cookie compartilhado passa a ser o novo; a aba 2 ainda manda o antigo.
    const response = await units(user.session, newCtx, oldCtx);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "context_changed" });
    expect(response.body).not.toContain("Matriz");
    expect(response.body).not.toContain("Centro");
    const bare = await call("GET", "/api/units", user.session, { ctx: newCtx });
    expect(bare.statusCode).toBe(409);
  });
});

describe("GET /api/units: permissão panel:access", () => {
  it("dono, gerente e contador listam (200)", async () => {
    for (const role of ["owner", "manager", "accountant"]) {
      const user = await loneUser();
      const t = await addTenant(["A"]);
      await addMembership(user.userId, t, { role });
      const response = await units(await login(user.email), `${t.tenantId}.all`);
      expect(response.statusCode, role).toBe(200);
      expect(response.json()).toEqual({ units: [{ id: t.unitIds[0], name: "A" }] });
    }
  });

  it("lançador sem panelAccess não entra no painel: sem vínculo de painel, /api/me e /api/units dão 401", async () => {
    const user = await ownerOfOne();
    expect((await me(user.session)).statusCode).toBe(200);
    await h.db.admin.query(
      "update memberships set role = 'staff', panel_access = false where user_id = $1",
      [user.userId],
    );
    expect((await me(user.session)).statusCode).toBe(401);
    const response = await units(user.session, `${user.own.tenantId}.all`);
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("units");
  });

  it("lançador com panelAccess lista só as suas unidades", async () => {
    const user = await loneUser();
    const t = await addTenant(["A", "B"]);
    const [a] = t.unitIds as [string, string];
    await addMembership(user.userId, t, {
      role: "staff",
      allUnits: false,
      unitIds: [a],
      panelAccess: true,
    });
    const response = await units(await login(user.email), `${t.tenantId}.${a}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ units: [{ id: a, name: "A" }] });
  });
});

describe("startUnitId em /api/me", () => {
  it("gerente limitado: a unidade padrão acessível; quem tem todas: all", async () => {
    const user = await loneUser();
    const limited = await addTenant(["A", "B"]);
    const [, b] = limited.unitIds as [string, string];
    await addMembership(user.userId, limited, {
      role: "manager",
      allUnits: false,
      unitIds: limited.unitIds,
      defaultUnitId: b,
    });
    const everything = await addTenant(["C"]);
    await addMembership(user.userId, everything, { role: "owner" });
    const body = (await me(await login(user.email))).json() as MeBody;
    const start = (t: Tenant) => body.companies.find((c) => c.tenantId === t.tenantId)?.startUnitId;
    expect(start(limited)).toBe(b);
    expect(start(everything)).toBe("all");
  });

  it("padrão inacessível: cai na unidade acessível de menor id", async () => {
    const user = await loneUser();
    const t = await addTenant(["A", "B", "C"]);
    const [a, b, c] = t.unitIds as [string, string, string];
    await addMembership(user.userId, t, {
      role: "manager",
      allUnits: false,
      unitIds: [c, b],
      defaultUnitId: a,
    });
    const body = (await me(await login(user.email))).json() as MeBody;
    expect(body.companies[0]?.startUnitId).toBe([b, c].sort()[0]);
  });
});

describe("contador e situação da conta", () => {
  it("contador com 2 empresas lista as 2", async () => {
    const user = await loneUser();
    const t1 = await addTenant(["A"]);
    const t2 = await addTenant(["B"]);
    await addMembership(user.userId, t1, { role: "accountant" });
    await addMembership(user.userId, t2, { role: "accountant" });
    const body = (await me(await login(user.email))).json() as MeBody;
    expect(body.companies.map((c) => c.tenantId).sort()).toEqual([t1.tenantId, t2.tenantId].sort());
    expect(body.companies.every((c) => c.role === "accountant")).toBe(true);
  });

  it("contador em empresa canceled: ela some de companies e o fallback vai para outra; se era a única, 401", async () => {
    const user = await loneUser();
    const t1 = await addTenant(["A"]);
    const t2 = await addTenant(["B"], "canceled");
    await addMembership(user.userId, t1, {
      role: "accountant",
      preferredAt: new Date("2026-11-01T00:00:00Z"),
    });
    await addMembership(user.userId, t2, {
      role: "accountant",
      preferredAt: new Date("2026-11-05T00:00:00Z"),
    });
    const session = await login(user.email);
    const body = (await me(session, `${t2.tenantId}.all`)).json() as MeBody;
    expect(body.companies.map((c) => c.tenantId)).toEqual([t1.tenantId]);
    expect(body.context.tenantId).toBe(t1.tenantId);
    expect(body.contextSource).toBe("invalid_cookie");
    await h.db.admin.query("update tenants set status = 'canceled' where id = $1", [t1.tenantId]);
    expect((await me(session)).statusCode).toBe(401);
  });
});

describe("cookie de contexto e login", () => {
  const ctxCookies = (response: { headers: Record<string, unknown> }): string[] => {
    const header = response.headers["set-cookie"];
    const all = Array.isArray(header) ? (header as string[]) : header ? [header as string] : [];
    return all.filter((c) => c.includes("fr_ctx="));
  };
  const isExpired = (cookies: string[]) =>
    cookies.some((c) => /Max-Age=0/.test(c) && c.startsWith(`${CTX}=;`));

  it("login por senha, por código e sair expiram o fr_ctx; login que falha não mexe nele", async () => {
    const user = await ownerOfOne();

    const byPassword = await h.signInPassword(user.email, PASSWORD);
    expect(isExpired(ctxCookies(byPassword))).toBe(true);

    await h.requestCode(user.email);
    const byCode = await h.signInCode(user.email, h.lastCode());
    expect(byCode.statusCode).toBe(200);
    expect(isExpired(ctxCookies(byCode))).toBe(true);

    const out = await h.post("/api/auth/sign-out", {}, h.sessionCookie(byCode));
    expect(out.statusCode).toBe(200);
    expect(isExpired(ctxCookies(out))).toBe(true);

    // Sessão já inválida: sair responde erro, mas o contexto lembrado é apagado do mesmo jeito.
    const stale = await h.post("/api/auth/sign-out", {}, "__Secure-better-auth.session_token=lixo");
    expect(isExpired(ctxCookies(stale))).toBe(true);

    const failed = await h.signInPassword(user.email, "senhaErrada9");
    expect(failed.statusCode).toBeGreaterThanOrEqual(400);
    expect(ctxCookies(failed)).toHaveLength(0);
  });
});

describe("registro de log", () => {
  it("nenhuma linha de log traz o valor do cookie, o e-mail ou o cookie de sessão", async () => {
    const user = await ownerOfOne();
    const value = `${user.own.tenantId}.${user.own.unitIds[0]}`;
    h.logLines.length = 0;
    await me(user.session, value);
    await units(user.session, value);
    await units(user.session, `${uuidv7()}.all`, value);
    await call("POST", "/api/context", user.session, {
      body: { tenantId: user.own.tenantId, unitId: "all" },
    });
    expect(h.logLines.length).toBeGreaterThan(0);
    const logs = h.logLines.join("\n");
    expect(logs).not.toContain(value);
    expect(logs).not.toContain(user.own.unitIds[0] as string);
    expect(logs).not.toContain(user.email);
    expect(logs).not.toContain(user.session.split("=")[1] as string);
  });
});

describe("registro de log em falha (500)", () => {
  const NAME = "Maria Segredo";
  const EMAIL = "maria.segredo@exemplo.com";
  const TENANT = uuidv7();
  const UNIT = uuidv7();
  const membership = {
    membershipId: uuidv7(),
    tenantId: TENANT,
    tenantName: "Bistrô",
    accountStatus: "active" as const,
    role: "owner" as const,
    permissions: [],
    panelAccess: true,
    allUnits: true,
    unitIds: [UNIT],
    defaultUnitId: null,
    preferredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const checkSession = async () => ({
    ok: true as const,
    setCookies: [],
    session: {
      sessionId: "s1",
      userId: uuidv7(),
      name: NAME,
      email: EMAIL,
      keepConnected: false,
      updatedAt: new Date("2026-11-10T00:00:00Z"),
    },
  });

  async function failing(kind: "vinculos" | "banco") {
    const lines: string[] = [];
    // Porta fechada: toda consulta falha, e a mensagem do driver traz endereço e SQL.
    const pool = createPool("postgres://u:p@127.0.0.1:1/nada");
    const app = buildApp(
      { LOG_LEVEL: "debug", APP_URL: "http://localhost:3000" },
      {
        panel: {
          checkSession,
          checkEntry: async () => ({ ...(await checkSession()), access: "full" as const }),
          access: {
            listPanelMemberships: async () => {
              if (kind === "vinculos") throw new Error(`select ... ${EMAIL} ${NAME}`);
              return [membership];
            },
          },
          appDb: createDatabase(pool),
          secure: true,
        },
        logStream: { write: (line) => lines.push(line) },
      },
    );
    return {
      app,
      lines,
      close: async () => {
        await app.close();
        await pool.end();
      },
    };
  }

  it("falha ao ler os vínculos: 500 genérico e log sem nome nem e-mail", async () => {
    const { app, lines, close } = await failing("vinculos");
    const response = await app.inject({ method: "GET", url: "/api/me" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: "internal" });
    const logs = lines.join("\n");
    expect(logs).toContain("falha ao ler os vínculos do painel");
    expect(logs).not.toContain(NAME);
    expect(logs).not.toContain(EMAIL);
    await close();
  });

  it("falha do banco do tenant em /api/units: 500 genérico e log sem nome, e-mail nem cookie", async () => {
    const { app, lines, close } = await failing("banco");
    const value = `${TENANT}.all`;
    const response = await app.inject({
      method: "GET",
      url: "/api/units",
      headers: { cookie: `${CTX}=${value}`, "x-context": value },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: "internal" });
    expect(response.body).not.toContain(NAME);
    const logs = lines.join("\n");
    expect(logs).toContain("falha no painel");
    expect(logs).not.toContain(NAME);
    expect(logs).not.toContain(EMAIL);
    expect(logs).not.toContain(value);
    await close();
  });
});

describe("modo restrito (DD-33, RNF02)", () => {
  const post = (url: string, cookie: string, body: unknown = {}) =>
    h.post(url, body, cookie, nextIp());
  const get = (url: string, cookie: string) =>
    h.app.inject({ method: "GET", url, headers: { cookie }, remoteAddress: nextIp() });
  const patchName = (cookie: string) =>
    h.app.inject({
      method: "PATCH",
      url: "/api/profile/name",
      remoteAddress: nextIp(),
      headers: { cookie, origin: h.origin, "content-type": "application/json" },
      payload: JSON.stringify({ name: "Outro" }),
    });

  async function restrictedPersonas() {
    const ownerNoUnit = await h.createUser({ withUnit: false, password: PASSWORD });
    const onlyDeactivated = await h.createUser({ membership: "deactivated", password: PASSWORD });
    return [
      { reason: "owner_no_unit", user: ownerNoUnit, session: await login(ownerNoUnit.email) },
      {
        reason: "no_membership",
        user: onlyDeactivated,
        session: await login(onlyDeactivated.email),
      },
    ] as const;
  }

  it("/api/me restrito devolve só access, reason, userId, name e email, sem companies, context nem fr_ctx", async () => {
    for (const { reason, user, session } of await restrictedPersonas()) {
      const response = await me(session);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        access: "restricted",
        reason,
        userId: user.userId,
        name: "Pessoa",
        email: user.email,
      });
      expect(setCookies(response).some((c) => c.includes("fr_ctx"))).toBe(false);
    }
  });

  it("/api/me completo ganha access full", async () => {
    const user = await ownerOfOne();
    const body = (await me(user.session)).json();
    expect(body.access).toBe("full");
    expect(body.companies).toHaveLength(1);
  });

  it("sessão restrita em /api/units, /api/context e /api/profile/*: 401", async () => {
    for (const { session } of await restrictedPersonas()) {
      expect((await get("/api/units", session)).statusCode).toBe(401);
      expect((await get("/api/profile", session)).statusCode).toBe(401);
      const context = { tenantId: uuidv7(), unitId: "all" };
      expect((await post("/api/context", session, context)).statusCode).toBe(401);
      expect((await patchName(session)).statusCode).toBe(401);
      const password = { newPassword: "outraSenha1" };
      expect((await post("/api/profile/password", session, password)).statusCode).toBe(401);
      expect((await post("/api/profile/password/link", session)).statusCode).toBe(401);
      expect((await post("/api/profile/sessions/revoke-others", session)).statusCode).toBe(401);
    }
  });

  it("sessão restrita consegue sair (sign-out)", async () => {
    for (const { session } of await restrictedPersonas()) {
      expect((await post("/api/auth/sign-out", session)).statusCode).toBe(200);
      expect((await me(session)).statusCode).toBe(401);
    }
  });

  it("sessão de usuário que virou recusado (gerente sem unidade) recebe 401 em tudo", async () => {
    const user = await h.createUser({ password: PASSWORD });
    const session = await login(user.email);
    expect((await me(session)).statusCode).toBe(200);
    await h.db.admin.query("update memberships set role = 'manager' where user_id = $1", [
      user.userId,
    ]);
    await h.db.admin.query(
      "delete from units where tenant_id = (select tenant_id from memberships where user_id = $1)",
      [user.userId],
    );
    expect((await me(session)).statusCode).toBe(401);
    expect((await get("/api/units", session)).statusCode).toBe(401);
  });
});
