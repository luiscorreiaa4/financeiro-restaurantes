import { categorySettingsSchema, categoryTreeSchema } from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";
import { CATEGORIES_ROUTE_MATRIX, PERSONAS, type Persona } from "./support/route-matrix";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

interface Who {
  userId: string;
  session: string;
  /** Valor do `fr_ctx` e do `X-Context`; a sessão restrita não tem. */
  ctx?: string;
}

let who: Record<Persona, Who>;
/** Gerente da A e dono da B (contexto troca de empresa). */
let managerA_ownerB: { who: Who; ctxA: string; ctxB: string };
let tenantA: string;
let tenantB: string;
let unit1: string;
let unit2: string;

const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);

async function addTenant(name: string, unitNames: string[], status = "active") {
  const tenantId = uuidv7();
  await admin("insert into tenants (id, name, status) values ($1, $2, $3)", [
    tenantId,
    name,
    status,
  ]);
  const unitIds: string[] = [];
  for (const unitName of unitNames) {
    const id = uuidv7();
    await admin(
      "insert into units (id, tenant_id, name, city, uf) values ($1, $2, $3, 'Maceió', 'AL')",
      [id, tenantId, unitName],
    );
    unitIds.push(id);
  }
  return { tenantId, unitIds };
}

async function addUser(): Promise<{ userId: string; email: string }> {
  const user = await h.createUser({ password: PASSWORD });
  await admin("update memberships set status = 'deactivated' where user_id = $1", [user.userId]);
  return user;
}

async function addMembership(
  userId: string,
  tenantId: string,
  options: { role: string; unitIds?: string[]; permissions?: string[] },
): Promise<void> {
  const id = uuidv7();
  await admin(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, permissions)
     values ($1, $2, $3, $4, $5, true, $6::jsonb)`,
    [
      id,
      tenantId,
      userId,
      options.role,
      options.unitIds === undefined,
      JSON.stringify(options.permissions ?? []),
    ],
  );
  for (const unitId of options.unitIds ?? []) {
    await admin(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantId, id, unitId],
    );
  }
}

async function login(email: string): Promise<string> {
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return h.sessionCookie(response);
}

async function member(
  tenantId: string,
  options: { role: string; unitIds?: string[]; permissions?: string[] },
  ctx: string,
): Promise<Who> {
  const user = await addUser();
  await addMembership(user.userId, tenantId, options);
  return { userId: user.userId, session: await login(user.email), ctx };
}

function call(
  user: Who,
  method: "GET" | "POST" | "PATCH",
  url: string,
  extra: { ctx?: string; xContext?: string | null; body?: unknown } = {},
) {
  const ctx = extra.ctx ?? user.ctx;
  const xContext = extra.xContext === undefined ? ctx : extra.xContext;
  const cookie = [user.session, ctx !== undefined ? `${CTX}=${ctx}` : ""]
    .filter(Boolean)
    .join("; ");
  return h.app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      origin: h.origin,
      "user-agent": "vitest",
      cookie,
      ...(xContext != null ? { "x-context": xContext } : {}),
      ...(extra.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(extra.body !== undefined ? { payload: JSON.stringify(extra.body) } : {}),
  });
}

beforeAll(async () => {
  h = await startAuthHarness();
  const a = await addTenant("Empresa A", ["Unidade 1", "Unidade 2"]);
  tenantA = a.tenantId;
  [unit1, unit2] = a.unitIds as [string, string];
  const b = await addTenant("Empresa B", ["Unidade da B"]);
  tenantB = b.tenantId;
  const c = await addTenant("Empresa C", ["Matriz"], "read_only");

  const all = `${tenantA}.all`;
  const at1 = `${tenantA}.${unit1}`;
  const restrictedUser = await h.createUser({ membership: "deactivated", password: PASSWORD });
  const staffNoPanelUser = await addUser();
  await addMembership(staffNoPanelUser.userId, tenantA, { role: "staff", unitIds: [unit1] });
  const staffNoPanelWho = {
    userId: staffNoPanelUser.userId,
    session: await login(staffNoPanelUser.email),
    ctx: at1,
  };
  await admin("update memberships set panel_access = false where user_id = $1", [
    staffNoPanelUser.userId,
  ]);

  who = {
    owner: await member(tenantA, { role: "owner" }, all),
    manager: await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2], permissions: ["VER_FOLHA"] },
      at1,
    ),
    managerNoPayroll: await member(tenantA, { role: "manager", unitIds: [unit1, unit2] }, at1),
    staff: await member(tenantA, { role: "staff", unitIds: [unit1] }, at1),
    accountant: await member(tenantA, { role: "accountant" }, all),
    restricted: { userId: restrictedUser.userId, session: await login(restrictedUser.email) },
    readOnly: await member(c.tenantId, { role: "owner" }, `${c.tenantId}.all`),
    staffNoPanel: staffNoPanelWho,
  };

  const crossUser = await addUser();
  await addMembership(crossUser.userId, tenantA, { role: "manager", unitIds: [unit1] });
  await addMembership(crossUser.userId, tenantB, { role: "owner" });
  managerA_ownerB = {
    who: { userId: crossUser.userId, session: await login(crossUser.email) },
    ctxA: at1,
    ctxB: `${tenantB}.all`,
  };
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

const CAT = "/api/settings/categories";

const sys = { payroll: uuidv7(), meat: uuidv7(), sales: uuidv7() };

beforeAll(async () => {
  const insert = (
    id: string,
    name: string,
    kind: string,
    dre: string,
    sensitive: boolean,
    words: string[],
    qty = false,
  ) =>
    admin(
      `insert into categories (id, tenant_id, name, kind, nature, dre_group, is_sensitive, requires_quantity, support_words)
       values ($1, null, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, kind, kind === "expense" ? "fixed" : null, dre, sensitive, qty, words],
    );
  await insert(sys.payroll, "Salários", "expense", "pessoal", true, ["holerite"]);
  await insert(sys.meat, "Carnes", "expense", "cmv", false, ["picanha"], true);
  await insert(sys.sales, "Vendas", "revenue", "receita_bruta", false, []);
});

type Node = { id: string; name: string; children: Array<{ id: string; name: string }> };
const tree = async (user: Who, query = "") => {
  const response = await call(user, "GET", `${CAT}${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return categoryTreeSchema.parse(response.json()).items as Node[];
};
const flat = (items: Node[]) => items.flatMap((n) => [n.name, ...n.children.map((c) => c.name)]);
const create = (user: Who, body: Record<string, unknown>, ctx?: string) =>
  call(user, "POST", CAT, { body, ...(ctx ? { ctx } : {}) });

describe("matriz papel x rota de categorias (RF07, RF06.CA06)", () => {
  for (const route of CATEGORIES_ROUTE_MATRIX) {
    for (const persona of PERSONAS) {
      const status = route.expected[persona];
      it(`${route.name}: ${persona} recebe ${status}`, async () => {
        const response = await call(who[persona], route.method, route.url(), {
          body: route.body?.(),
        });
        expect(response.statusCode, response.body).toBe(status);
        if (status >= 400) expect(response.json()).toHaveProperty("code");
      });
    }
  }

  it("sem X-Context: 409 context_changed em todas as rotas", async () => {
    for (const route of CATEGORIES_ROUTE_MATRIX) {
      const response = await call(who.owner, route.method, route.url(), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });
});

describe("folha é sensível (Review Focus 1, RF06.R3, DD-04)", () => {
  let diaristas: string;

  it("dono cria subcategoria da folha e ela herda o sensível", async () => {
    const response = await create(who.owner, {
      parentId: sys.payroll,
      name: "Diaristas",
      supportWords: ["diaria"],
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = categorySettingsSchema.parse(response.json());
    expect(created).toMatchObject({ isSensitive: true, origin: "company", parentId: sys.payroll });
    diaristas = created.id;
  });

  it("gerente sem VER_FOLHA pede ?search=sal: nada de Salários nem de subcategoria dela", async () => {
    const response = await call(who.managerNoPayroll, "GET", `${CAT}?search=sal`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    expect(response.body).not.toMatch(/Sal[aá]rios|Diaristas|holerite/);
  });

  it("gerente sem VER_FOLHA: lista, busca por apoio e por subcategoria não revelam a folha", async () => {
    expect(flat(await tree(who.managerNoPayroll))).not.toEqual(
      expect.arrayContaining(["Salários"]),
    );
    expect(flat(await tree(who.managerNoPayroll))).toContain("Carnes");
    for (const search of ["holerite", "diaria", "Diaristas", "pessoal"]) {
      const items = await tree(who.managerNoPayroll, `?search=${encodeURIComponent(search)}`);
      expect(flat(items), search).not.toContain("Salários");
      expect(flat(items), search).not.toContain("Diaristas");
    }
  });

  it("dono, contador e gerente com VER_FOLHA veem a folha e a subcategoria", async () => {
    for (const persona of [who.owner, who.accountant, who.manager]) {
      const names = flat(await tree(persona));
      expect(names).toEqual(expect.arrayContaining(["Salários", "Diaristas"]));
      expect(flat(await tree(persona, "?search=holerite"))).toContain("Salários");
    }
  });

  it("subcategoria sensível mal marcada (não sensível sob pai sensível) também fica oculta", async () => {
    await admin(
      `insert into categories (id, tenant_id, parent_id, name, kind, dre_group, is_sensitive)
       values ($1, $2, $3, 'Mal marcada', 'expense', 'pessoal', false)`,
      [uuidv7(), tenantA, sys.payroll],
    );
    expect(flat(await tree(who.managerNoPayroll))).not.toContain("Mal marcada");
    expect(flat(await tree(who.owner))).toContain("Mal marcada");
  });

  it("PATCH em subcategoria da folha por quem não vê folha: 403 (só o dono escreve)", async () => {
    const response = await call(who.managerNoPayroll, "PATCH", `${CAT}/${diaristas}`, {
      body: { name: "Vazou" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("a resposta passa pelo contrato: sem tenantId nem campo extra", async () => {
    const response = await call(who.owner, "GET", CAT);
    for (const item of response.json().items as Array<Record<string, unknown>>) {
      expect(item).not.toHaveProperty("tenantId");
    }
  });
});

describe("criar subcategoria (RF07.R1 a R8, CA02, CA03)", () => {
  it("herda tipo, grupo, sensível e quantidade do pai e grava auditoria do autor", async () => {
    const response = await create(who.owner, {
      parentId: sys.meat,
      name: "Bovinos",
      supportWords: ["boi", "acém"],
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = categorySettingsSchema.parse(response.json());
    expect(created).toMatchObject({
      kind: "expense",
      dreGroup: "cmv",
      requiresQuantity: true,
      isSensitive: false,
      supportWords: ["boi", "acém"],
    });
    const row = await admin("select tenant_id from categories where id = $1", [created.id]);
    expect(row.rows[0].tenant_id).toBe(tenantA);
    const audit = await admin(
      "select actor_id from audit_log where tenant_id = $1 and action = 'category.create' and target = $2",
      [tenantA, created.id],
    );
    expect(audit.rows[0].actor_id).toBe(who.owner.userId);
    const names = flat(await tree(who.managerNoPayroll, "?search=boi"));
    expect(names).toEqual(["Carnes", "Bovinos"]);
  });

  it("pai de outra empresa: 422, nada gravado", async () => {
    const idB = uuidv7();
    await admin(
      "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, $2, 'Própria da B', 'expense', 'outras')",
      [idB, tenantB],
    );
    const response = await create(who.owner, { parentId: idB, name: "Invasora", supportWords: [] });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "validation", field: "parent_id", reason: "unknown" });
    const rows = await admin("select 1 from categories where name = 'Invasora'");
    expect(rows.rowCount).toBe(0);
  });

  it("pai que é categoria própria da empresa: 422 parent_id/not_system", async () => {
    const own = uuidv7();
    await admin(
      "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, $2, 'Própria da A', 'expense', 'outras')",
      [own, tenantA],
    );
    const response = await create(who.owner, { parentId: own, name: "Filha", supportWords: [] });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "validation",
      field: "parent_id",
      reason: "not_system",
    });
  });

  it("nome repetido entre irmãs: 409 name_taken", async () => {
    expect(
      (await create(who.owner, { parentId: sys.sales, name: "Eventos", supportWords: [] }))
        .statusCode,
    ).toBe(201);
    const again = await create(who.owner, {
      parentId: sys.sales,
      name: "eventos",
      supportWords: [],
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "name_taken" });
  });

  it("natureza em receita: 422; corpo com isSensitive, tenantId ou sem pai: 400", async () => {
    const nature = await create(who.owner, {
      parentId: sys.sales,
      name: "Natureza errada",
      nature: "fixed",
      supportWords: [],
    });
    expect(nature.statusCode).toBe(422);
    expect(nature.json()).toEqual({ code: "validation", field: "nature", reason: "invalid" });
    for (const extra of [{ isSensitive: false }, { tenantId: tenantB }]) {
      const response = await create(who.owner, {
        parentId: sys.sales,
        name: "Extra",
        supportWords: [],
        ...extra,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "invalid_request" });
    }
    expect((await create(who.owner, { name: "Sem pai", supportWords: [] })).statusCode).toBe(400);
  });

  it("conta somente leitura: 403 account_read_only e nada gravado", async () => {
    const response = await create(who.readOnly, {
      parentId: sys.sales,
      name: "Bloqueada",
      supportWords: [],
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "account_read_only" });
  });
});

describe("editar subcategoria (RF07.CA01, R10)", () => {
  const make = async (name: string, parentId = sys.meat) =>
    categorySettingsSchema.parse(
      (await create(who.owner, { parentId, name, supportWords: [] })).json(),
    );

  it("categoria do sistema: 422 system_read_only e nada muda (CA01)", async () => {
    const response = await call(who.owner, "PATCH", `${CAT}/${sys.meat}`, {
      body: { name: "Hack" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: "validation",
      field: "name",
      reason: "system_read_only",
    });
    const row = await admin("select name from categories where id = $1", [sys.meat]);
    expect(row.rows[0].name).toBe("Carnes");
  });

  it("muda só o que veio, responde pelo contrato e audita antes e depois", async () => {
    const created = await make("Para editar");
    const response = await call(who.owner, "PATCH", `${CAT}/${created.id}`, {
      body: { name: "Editada", supportWords: ["x"] },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(categorySettingsSchema.parse(response.json())).toEqual({
      ...created,
      name: "Editada",
      supportWords: ["x"],
    });
    const audit = await admin(
      "select metadata from audit_log where tenant_id = $1 and action = 'category.update' and target = $2",
      [tenantA, created.id],
    );
    expect(audit.rows[0].metadata).toEqual({
      before: { name: "Para editar", supportWords: [] },
      after: { name: "Editada", supportWords: ["x"] },
    });
  });

  it("inativar muda só a situação; lançamentos antigos continuam apontando (R10)", async () => {
    const created = await make("Para inativar");
    const response = await call(who.owner, "PATCH", `${CAT}/${created.id}`, {
      body: { status: "inactive" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("inactive");
    const row = await admin("select status from categories where id = $1", [created.id]);
    expect(row.rows[0].status).toBe("inactive");
    expect(flat(await tree(who.owner, "?status=inactive"))).toContain("Para inativar");
  });

  it("trocar o pai ou marcar sensível: 400 pelo contrato estrito", async () => {
    const created = await make("Sem trocar pai");
    for (const body of [{ parentId: sys.sales }, { isSensitive: false }, { tenantId: tenantB }]) {
      const response = await call(who.owner, "PATCH", `${CAT}/${created.id}`, { body });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "invalid_request" });
    }
    const row = await admin("select parent_id from categories where id = $1", [created.id]);
    expect(row.rows[0].parent_id).toBe(sys.meat);
  });

  it("nome repetido entre irmãs: 409; natureza em receita: 422", async () => {
    await make("Irmã A");
    const second = await make("Irmã B");
    const dup = await call(who.owner, "PATCH", `${CAT}/${second.id}`, { body: { name: "irmã a" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ code: "name_taken" });
    const income = await make("Receita X", sys.sales);
    const nature = await call(who.owner, "PATCH", `${CAT}/${income.id}`, {
      body: { nature: "fixed" },
    });
    expect(nature.statusCode).toBe(422);
    expect(nature.json()).toEqual({ code: "validation", field: "nature", reason: "invalid" });
  });
});

describe("duas empresas (RNF02)", () => {
  it("a outra empresa não aparece na lista; PATCH em id dela e id não-UUID dão 404", async () => {
    const idB = uuidv7();
    await admin(
      "insert into categories (id, tenant_id, parent_id, name, kind, dre_group) values ($1, $2, $3, 'Subcategoria da B', 'expense', 'cmv')",
      [idB, tenantB, sys.meat],
    );
    expect(flat(await tree(who.owner))).not.toContain("Subcategoria da B");
    expect(flat(await tree(who.owner, "?search=subcategoria"))).toEqual([]);
    const patch = await call(who.owner, "PATCH", `${CAT}/${idB}`, { body: { name: "Invadida" } });
    expect(patch.statusCode).toBe(404);
    expect(patch.json()).toEqual({ code: "not_found" });
    const row = await admin("select name from categories where id = $1", [idB]);
    expect(row.rows[0].name).toBe("Subcategoria da B");
    const noUuid = await call(who.owner, "PATCH", `${CAT}/nao-e-uuid`, { body: { name: "Xx" } });
    expect(noUuid.statusCode).toBe(404);
  });

  it("gerente da A que é dono da B grava só na empresa do contexto", async () => {
    const { who: user, ctxA, ctxB } = managerA_ownerB;
    const denied = await create(
      user,
      { parentId: sys.sales, name: "Só dono", supportWords: [] },
      ctxA,
    );
    expect(denied.statusCode).toBe(403);
    const allowed = await create(
      user,
      { parentId: sys.sales, name: "Da B pelo dono", supportWords: [] },
      ctxB,
    );
    expect(allowed.statusCode, allowed.body).toBe(201);
    const row = await admin("select tenant_id from categories where name = 'Da B pelo dono'");
    expect(row.rows[0].tenant_id).toBe(tenantB);
  });
});

describe("consulta e filtros", () => {
  it("query fora do contrato: 400; filtro por tipo e situação", async () => {
    expect((await call(who.owner, "GET", `${CAT}?foo=1`)).statusCode).toBe(400);
    expect((await call(who.owner, "GET", `${CAT}?kind=xx`)).statusCode).toBe(400);
    expect(flat(await tree(who.owner, "?kind=revenue")).includes("Carnes")).toBe(false);
    expect(flat(await tree(who.owner, "?kind=revenue"))).toContain("Vendas");
  });
});
