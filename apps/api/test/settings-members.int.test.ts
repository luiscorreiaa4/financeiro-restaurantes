import { resolveSender } from "@app/core";
import { memberCreatedSchema, memberSettingsSchema } from "@app/core/contracts";
import { createDatabase, createSenderDirectory, uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, PRODUCT_PHONE, startAuthHarness } from "./support/auth-harness";
import { MEMBERS_ROUTE_MATRIX, PERSONAS, type Persona } from "./support/route-matrix";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;
let phoneCounter = 0;
/** Celular brasileiro válido e único em cada chamada. */
const nextPhone = () => `+55119${String(80_000_000 + ++phoneCounter)}`;

interface Who {
  userId: string;
  session: string;
  ctx?: string;
}
type Member = Who & { membershipId: string; phone: string };

let who: Record<Persona, Who>;
let owner: Member;
let ownerB: Member;
let tenantA: string;
let tenantB: string;
let unit1: string;
let unit2: string;
let unitB: string;

const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);
const row = async (sql: string, params: unknown[]) => (await admin(sql, params)).rows;

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

/** Usuário com e-mail, senha e celular próprio; sem o vínculo padrão que o harness cria. */
async function addUser(): Promise<{ userId: string; email: string; phone: string }> {
  const user = await h.createUser({ password: PASSWORD });
  await admin("update memberships set status = 'deactivated' where user_id = $1", [user.userId]);
  const phone = nextPhone();
  await admin("update users set phone_e164 = $2 where id = $1", [user.userId, phone]);
  return { ...user, phone };
}

interface MembershipOptions {
  role: string;
  unitIds?: string[];
  permissions?: string[];
  panelAccess?: boolean;
}

async function addMembership(
  userId: string,
  tenantId: string,
  options: MembershipOptions,
): Promise<string> {
  const id = uuidv7();
  await admin(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, permissions)
     values ($1, $2, $3, $4, $5, $7, $6::jsonb)`,
    [
      id,
      tenantId,
      userId,
      options.role,
      options.unitIds === undefined,
      JSON.stringify(options.permissions ?? []),
      options.panelAccess ?? true,
    ],
  );
  if (options.unitIds?.[0] !== undefined) {
    await admin("update memberships set default_unit_id = $2 where id = $1", [
      id,
      options.unitIds[0],
    ]);
  }
  for (const unitId of options.unitIds ?? []) {
    await admin(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantId, id, unitId],
    );
  }
  return id;
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

async function member(tenantId: string, options: MembershipOptions, ctx: string): Promise<Member> {
  const user = await addUser();
  const membershipId = await addMembership(user.userId, tenantId, options);
  return {
    userId: user.userId,
    session: await login(user.email),
    ctx,
    membershipId,
    phone: user.phone,
  };
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

const memberBody = (overrides: Record<string, unknown> = {}) => ({
  displayName: "Colaborador Teste",
  phone: nextPhone(),
  email: null,
  role: "staff",
  allUnits: false,
  unitIds: [unit1],
  defaultUnitId: unit1,
  panelAccess: false,
  permissions: [],
  ...overrides,
});

const createMember = (user: Who, overrides: Record<string, unknown> = {}) =>
  call(user, "POST", "/api/settings/members", { body: memberBody(overrides) });

async function created(user: Who, overrides: Record<string, unknown> = {}) {
  const response = await createMember(user, overrides);
  expect(response.statusCode, response.body).toBe(201);
  return memberCreatedSchema.parse(response.json()).member;
}

const listOf = async (user: Who, query = "") => {
  const response = await call(user, "GET", `/api/settings/members${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { items: Array<Record<string, unknown> & { id: string }> }).items;
};

const fullPhoneOf = async (id: string): Promise<string> =>
  (await call(owner, "GET", `/api/settings/members/${id}`)).json().phone;

beforeAll(async () => {
  h = await startAuthHarness();
  const a = await addTenant("Empresa A", ["Unidade 1", "Unidade 2"]);
  tenantA = a.tenantId;
  [unit1, unit2] = a.unitIds as [string, string];
  const b = await addTenant("Empresa B", ["Unidade da B"]);
  tenantB = b.tenantId;
  unitB = b.unitIds[0] as string;
  const c = await addTenant("Empresa C", ["Matriz"], "read_only");

  const at1 = `${tenantA}.${unit1}`;
  const restrictedUser = await h.createUser({ membership: "deactivated", password: PASSWORD });
  const staffNoPanelUser = await addUser();
  await addMembership(staffNoPanelUser.userId, tenantA, {
    role: "staff",
    unitIds: [unit1],
  });
  const staffNoPanelSession = await login(staffNoPanelUser.email);
  await admin("update memberships set panel_access = false where user_id = $1", [
    staffNoPanelUser.userId,
  ]);
  owner = await member(tenantA, { role: "owner" }, `${tenantA}.all`);
  who = {
    owner,
    manager: await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2], permissions: ["VER_FOLHA"] },
      at1,
    ),
    managerNoPayroll: await member(tenantA, { role: "manager", unitIds: [unit1, unit2] }, at1),
    staff: await member(tenantA, { role: "staff", unitIds: [unit1] }, at1),
    accountant: await member(tenantA, { role: "accountant" }, `${tenantA}.all`),
    restricted: { userId: restrictedUser.userId, session: await login(restrictedUser.email) },
    readOnly: await member(c.tenantId, { role: "owner" }, `${c.tenantId}.all`),
    staffNoPanel: {
      userId: staffNoPanelUser.userId,
      session: staffNoPanelSession,
      ctx: at1,
    },
  };
  ownerB = await member(tenantB, { role: "owner" }, `${tenantB}.all`);
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("matriz papel × rota dos colaboradores (RF05, RF06.CA06)", () => {
  for (const route of MEMBERS_ROUTE_MATRIX) {
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
    for (const route of MEMBERS_ROUTE_MATRIX) {
      const response = await call(who.owner, route.method, route.url(), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });

  it("cookie de contexto forjado para a empresa B: 403 context_invalid", async () => {
    const response = await call(who.owner, "GET", "/api/settings/members", {
      ctx: `${tenantB}.all`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "context_invalid" });
  });
});

describe("cadastrar colaborador (RF05)", () => {
  it("cria o vínculo convidado, responde pelo contrato com o texto do convite e audita", async () => {
    const response = await createMember(who.owner, {
      displayName: "  Ana Souza ",
      phone: "(11) 98877-6655",
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = memberCreatedSchema.parse(response.json());
    expect(body.member).toMatchObject({
      displayName: "Ana Souza",
      phone: "+5511988776655",
      phoneMasked: "•••• 6655",
      status: "invited",
      role: "staff",
      unitIds: [unit1],
    });
    expect(body.inviteText).toContain("Empresa A");
    expect(body.inviteText).toContain("Ana");
    const audits = await row(
      "select metadata::text as m from audit_log where tenant_id = $1 and action = 'member.invite' and target = $2",
      [tenantA, body.member.id],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].m).not.toContain("98877");
    expect(audits[0].m).not.toContain("Ana");
    expect(h.email.sentInvites).toEqual([]);
  });

  it("com acesso ao painel e e-mail, o convite sai pelo envio de e-mail", async () => {
    const before = h.email.sentInvites.length;
    const m = await created(who.owner, { panelAccess: true, email: "Painel.Pessoa@Ex.com" });
    expect(m.email).toBe("painel.pessoa@ex.com");
    expect(h.email.sentInvites).toHaveLength(before + 1);
    expect(h.email.sentInvites.at(-1)).toEqual({
      to: "painel.pessoa@ex.com",
      tenantName: "Empresa A",
      loginUrl: `${h.origin}/login`,
    });
  });

  it("falha no envio do convite não desfaz o cadastro e o log não leva o e-mail", async () => {
    h.email.failInvites = true;
    try {
      const response = await createMember(who.owner, {
        panelAccess: true,
        email: "falha.envio@ex.com",
      });
      expect(response.statusCode, response.body).toBe(201);
    } finally {
      h.email.failInvites = false;
    }
    expect(await row("select 1 from users where email = 'falha.envio@ex.com'", [])).toHaveLength(1);
    expect(h.logLines.join("\n")).not.toContain("falha.envio");
  });

  it("nada de nome, celular ou e-mail vai para o log", async () => {
    await created(who.owner, {
      displayName: "Fulana Muito Secreta",
      phone: "+5511977665544",
      email: "secreta.log@ex.com",
      panelAccess: true,
    });
    const logs = h.logLines.join("\n");
    expect(logs).not.toContain("Secreta");
    expect(logs).not.toContain("secreta.log");
    expect(logs).not.toContain("977665544");
  });

  it("CA02: número que é dono em outra empresa ganha só o vínculo, sem nada da outra", async () => {
    const otherPhone = "+5511987650001";
    const otherUser = uuidv7();
    await admin(
      "insert into users (id, name, email, phone_e164, email_verified) values ($1, 'Dono Sigiloso da B', 'sigiloso@b.com', $2, true)",
      [otherUser, otherPhone],
    );
    await addMembership(otherUser, tenantB, { role: "owner" });

    const response = await createMember(who.owner, {
      displayName: "Nome na A",
      phone: "(11) 98765-0001",
      // O dono da A só reaproveita o número se digitar o e-mail exato da pessoa (sem vazar o dela).
      email: "sigiloso@b.com",
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.body).not.toContain("Sigiloso");
    expect(response.body).not.toContain("Empresa B");
    expect(response.body).not.toContain("sigiloso@b.com");
    expect(memberCreatedSchema.parse(response.json()).member).not.toHaveProperty("email");
    expect(memberCreatedSchema.parse(response.json()).member.displayName).toBe("Nome na A");

    expect(await row("select name, email from users where phone_e164 = $1", [otherPhone])).toEqual([
      { name: "Dono Sigiloso da B", email: "sigiloso@b.com" },
    ]);
    const links = await row("select tenant_id, display_name from memberships where user_id = $1", [
      otherUser,
    ]);
    expect(links).toHaveLength(2);
    expect(links).toContainEqual({ tenant_id: tenantA, display_name: "Nome na A" });
    expect(h.logLines.join("\n")).not.toContain("Sigiloso");

    // O mesmo número sem o 9º dígito já tem vínculo aqui: 409, sem duplicar.
    const again = await createMember(who.owner, {
      phone: "11 8765-0001",
      email: "sigiloso@b.com",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "already_member" });
    expect(await row("select 1 from memberships where user_id = $1", [otherUser])).toHaveLength(2);
  });

  it("e-mail diferente do que a pessoa já tem, ou de outra pessoa: 422 contact_conflict neutro", async () => {
    const holder = await addUser();
    const phone = nextPhone();
    const known = uuidv7();
    await admin(
      "insert into users (id, name, email, phone_e164) values ($1, 'Conhecido', 'conhecido@ex.com', $2)",
      [known, phone],
    );
    await addMembership(known, tenantB, { role: "staff", panelAccess: false });
    const neutral = { code: "contact_conflict", field: "email", reason: "conflict" };

    const differentEmail = await createMember(who.owner, {
      phone,
      email: "outro.email@ex.com",
      panelAccess: true,
    });
    expect(differentEmail.statusCode).toBe(422);
    expect(differentEmail.json()).toEqual(neutral);
    expect(differentEmail.body).not.toContain("conhecido@ex.com");

    const emailOfOther = await createMember(who.owner, { email: holder.email, panelAccess: true });
    expect(emailOfOther.statusCode).toBe(422);
    expect(emailOfOther.json()).toEqual(neutral);
    expect(emailOfOther.body).not.toContain(holder.email);

    expect(await row("select email from users where id = $1", [known])).toEqual([
      { email: "conhecido@ex.com" },
    ]);
    expect(
      await row("select 1 from memberships where tenant_id = $1 and user_id = $2", [
        tenantA,
        known,
      ]),
    ).toHaveLength(0);
  });

  it("sequestro antecipado: e-mail do atacante no número de um futuro funcionário de outra empresa", async () => {
    const victimPhone = nextPhone();
    const neutral = { code: "contact_conflict", field: "email", reason: "conflict" };
    // O atacante (dono da A) cadastra o número da vítima com o e-mail dele.
    const planted = await createMember(who.owner, {
      phone: victimPhone,
      email: "atacante@ex.com",
      panelAccess: true,
    });
    expect(planted.statusCode, planted.body).toBe(201);
    // O dono da X cadastra o mesmo número sem e-mail (gerente ou lançador): recusado.
    const victimTenant = await addTenant("Empresa X", ["UX"]);
    const ownerX = await member(
      victimTenant.tenantId,
      { role: "owner" },
      `${victimTenant.tenantId}.all`,
    );
    const [unitX] = victimTenant.unitIds as [string];
    const asVictim = (overrides: Record<string, unknown>) =>
      call(ownerX, "POST", "/api/settings/members", {
        body: {
          ...memberBody(),
          phone: victimPhone,
          unitIds: [unitX],
          defaultUnitId: unitX,
          ...overrides,
        },
      });
    const noEmail = await asVictim({ role: "manager" });
    expect(noEmail.statusCode, noEmail.body).toBe(422);
    expect(noEmail.json()).toEqual(neutral);
    const staffNoEmail = await asVictim({ role: "staff" });
    expect(staffNoEmail.statusCode).toBe(422);
    expect(staffNoEmail.json()).toEqual(neutral);
    expect(noEmail.body).not.toContain("atacante");
    expect(
      await row(
        "select 1 from memberships m join users u on u.id = m.user_id where m.tenant_id = $1 and u.phone_e164 = $2",
        [victimTenant.tenantId, victimPhone],
      ),
    ).toHaveLength(0);
    // Digitar outro e-mail também é recusado; o e-mail exato do usuário é o caminho legítimo.
    const other = await asVictim({ email: "outro@ex.com", panelAccess: true });
    expect(other.statusCode).toBe(422);
    const legit = await asVictim({ email: "atacante@ex.com", panelAccess: true });
    expect(legit.statusCode, legit.body).toBe(201);
  });

  it("usuário sem e-mail: só reaproveita com e-mail nulo; usuário com e-mail e digitado nulo é recusado", async () => {
    const noEmailPhone = nextPhone();
    const noEmailUser = uuidv7();
    await admin("insert into users (id, name, phone_e164) values ($1, 'Sem Email', $2)", [
      noEmailUser,
      noEmailPhone,
    ]);
    await addMembership(noEmailUser, tenantB, { role: "staff", panelAccess: false });
    const typedEmail = await createMember(who.owner, {
      phone: noEmailPhone,
      email: "preenchido@ex.com",
      panelAccess: true,
    });
    expect(typedEmail.statusCode).toBe(422);
    expect(typedEmail.json().code).toBe("contact_conflict");
    const nullEmail = await createMember(who.owner, { phone: noEmailPhone });
    expect(nullEmail.statusCode, nullEmail.body).toBe(201);
    expect(nullEmail.json().member).not.toHaveProperty("email");

    const withEmailPhone = nextPhone();
    const withEmailUser = uuidv7();
    await admin(
      "insert into users (id, name, email, phone_e164) values ($1, 'Com Email', 'com.email@ex.com', $2)",
      [withEmailUser, withEmailPhone],
    );
    const nullTyped = await createMember(who.owner, { phone: withEmailPhone });
    expect(nullTyped.statusCode).toBe(422);
    expect(nullTyped.json().code).toBe("contact_conflict");
  });

  it("a resposta do cadastro com e-mail nulo é igual para usuário novo e para número de outra empresa", async () => {
    const fresh = await createMember(who.owner, { displayName: "Novo Usuario" });
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json().member).not.toHaveProperty("email");
    const sharedPhone = nextPhone();
    const sharedUser = uuidv7();
    await admin("insert into users (id, name, phone_e164) values ($1, 'Outra Empresa', $2)", [
      sharedUser,
      sharedPhone,
    ]);
    await addMembership(sharedUser, tenantB, { role: "staff", panelAccess: false });
    const shared = await createMember(who.owner, { phone: sharedPhone });
    expect(shared.statusCode).toBe(201);
    expect(shared.json().member).not.toHaveProperty("email");
    const detail = await call(who.owner, "GET", `/api/settings/members/${fresh.json().member.id}`);
    expect(detail.json()).not.toHaveProperty("email");
  });

  it("usuário existente com o mesmo e-mail entra só com o vínculo", async () => {
    const user = await addUser();
    const response = await createMember(who.owner, {
      phone: user.phone,
      email: user.email,
      panelAccess: true,
    });
    expect(response.statusCode, response.body).toBe(201);
  });

  it("duplo envio do mesmo cadastro: um 201 e um 409, sem duplicar", async () => {
    const body = memberBody({ displayName: "Duplo Envio" });
    const responses = await Promise.all([
      call(who.owner, "POST", "/api/settings/members", { body }),
      call(who.owner, "POST", "/api/settings/members", { body }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(
      await row(
        "select 1 from memberships m join users u on u.id = m.user_id where m.tenant_id = $1 and u.phone_e164 = $2",
        [tenantA, body.phone],
      ),
    ).toHaveLength(1);
  });

  it("validação: 422 com field e reason, sem gravar", async () => {
    const cases: Array<[Record<string, unknown>, { field: string; reason: string }]> = [
      [{ phone: "+1 415 555 0100" }, { field: "phone", reason: "foreign" }],
      [{ phone: PRODUCT_PHONE }, { field: "phone", reason: "product_number" }],
      [{ phone: "12" }, { field: "phone", reason: "invalid" }],
      [
        { panelAccess: true, email: null },
        { field: "email", reason: "required" },
      ],
      [{ defaultUnitId: unit2 }, { field: "defaultUnitId", reason: "outside_access" }],
      [
        { unitIds: [unitB], defaultUnitId: unitB },
        { field: "unitIds", reason: "unknown" },
      ],
      [
        { unitIds: [], defaultUnitId: null },
        { field: "unitIds", reason: "required" },
      ],
      [
        { role: "owner", allUnits: false, unitIds: [unit1] },
        { field: "allUnits", reason: "needs_all" },
      ],
      [{ displayName: "  x " }, { field: "displayName", reason: "invalid" }],
    ];
    for (const [overrides, expected] of cases) {
      const response = await createMember(who.owner, overrides);
      expect(response.statusCode, JSON.stringify(overrides)).toBe(422);
      expect(response.json(), JSON.stringify(overrides)).toEqual({
        code: "validation",
        ...expected,
      });
    }
  });

  it("corpo fora do contrato: 400 invalid_request", async () => {
    const extra = await call(who.owner, "POST", "/api/settings/members", {
      body: { ...memberBody(), tenantId: tenantB },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual({ code: "invalid_request" });
  });
});

describe("leitura: dono e gerente (RF05.CA08)", () => {
  it("o gerente vê só os colaboradores das suas unidades, celular mascarado e sem e-mail", async () => {
    const m1 = await created(who.owner, { displayName: "Na Unidade 1" });
    const m2 = await created(who.owner, {
      displayName: "Na Unidade 2",
      unitIds: [unit2],
      defaultUnitId: unit2,
      email: "u2@ex.com",
    });
    const limited = await member(
      tenantA,
      { role: "manager", unitIds: [unit1] },
      `${tenantA}.${unit1}`,
    );

    const items = await listOf(limited);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(m1.id);
    expect(ids).not.toContain(m2.id);
    for (const item of items) {
      expect(item).not.toHaveProperty("email");
      expect(item).not.toHaveProperty("phone");
      expect(String(item.phoneMasked)).toMatch(/^•••• \d{4}$|^$/);
    }
    // TODAS conta: o dono (todas as unidades) aparece para o gerente.
    expect(items.some((i) => i.role === "owner")).toBe(true);

    const ownerView = (await listOf(who.owner)).find((i) => i.id === m2.id);
    expect(ownerView).toMatchObject({ email: "u2@ex.com" });
    expect(String(ownerView?.phoneMasked)).toMatch(/^•••• \d{4}$/);
    expect(ownerView).not.toHaveProperty("phone");

    // Review Focus 2: fora do recorte do gerente é 404, igual a inexistente.
    const hidden = await call(limited, "GET", `/api/settings/members/${m2.id}`);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ code: "not_found" });
    const visible = await call(limited, "GET", `/api/settings/members/${m1.id}`);
    expect(visible.statusCode).toBe(200);
    const body = memberSettingsSchema.parse(visible.json());
    expect(body.phone).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(body.phoneMasked).toMatch(/^•••• \d{4}$/);
  });

  it("o dono abre o detalhe com celular inteiro e e-mail, sem o id do usuário", async () => {
    const m = await created(who.owner, { phone: "+5511966554433", email: "inteiro@ex.com" });
    const response = await call(who.owner, "GET", `/api/settings/members/${m.id}`);
    expect(response.statusCode).toBe(200);
    expect(memberSettingsSchema.parse(response.json())).toMatchObject({
      phone: "+5511966554433",
      email: "inteiro@ex.com",
    });
    expect(response.body).not.toContain("userId");
  });

  it("filtros por busca, papel, unidade e situação", async () => {
    const tenant = await addTenant("Empresa Filtros", ["F1", "F2"]);
    const filterOwner = await member(tenant.tenantId, { role: "owner" }, `${tenant.tenantId}.all`);
    const [f1, f2] = tenant.unitIds as [string, string];
    const post = (overrides: Record<string, unknown>) =>
      call(filterOwner, "POST", "/api/settings/members", {
        body: { ...memberBody(), unitIds: [f1], defaultUnitId: f1, ...overrides },
      });
    await post({ displayName: "Maria Filtro", phone: "+5511955112233" });
    const joao = (
      await post({ displayName: "João Filtro", role: "manager", unitIds: [f2], defaultUnitId: f2 })
    ).json().member;
    await call(filterOwner, "POST", `/api/settings/members/${joao.id}/deactivate`);

    const names = async (q: string) => (await listOf(filterOwner, q)).map((i) => i.displayName);
    expect(await names("?search=maria")).toEqual(["Maria Filtro"]);
    expect(await names("?search=2233")).toEqual(["Maria Filtro"]);
    expect(await names("?role=manager")).toEqual(["João Filtro"]);
    expect(await names(`?unitId=${f2}`)).toContain("João Filtro");
    expect(await names(`?unitId=${f2}`)).not.toContain("Maria Filtro");
    expect(await names("?status=deactivated")).toEqual(["João Filtro"]);
    expect(await names("?status=invited")).toEqual(["Maria Filtro"]);
    expect((await call(filterOwner, "GET", "/api/settings/members?role=zzz")).statusCode).toBe(400);
  });
});

describe("empresas isoladas (RNF02)", () => {
  it("a lista e o id de uma empresa não aparecem na outra", async () => {
    const mine = await created(who.owner);
    const theirs = await created(ownerB, { unitIds: [unitB], defaultUnitId: unitB });
    expect((await listOf(who.owner)).map((i) => i.id)).not.toContain(theirs.id);
    expect((await listOf(ownerB)).map((i) => i.id)).not.toContain(mine.id);
    const base = `/api/settings/members/${theirs.id}`;
    expect((await call(who.owner, "GET", base)).statusCode).toBe(404);
    const patch = await call(who.owner, "PATCH", base, { body: { displayName: "Invadido" } });
    expect(patch.statusCode).toBe(404);
    expect((await call(who.owner, "POST", `${base}/deactivate`)).statusCode).toBe(404);
    expect((await call(who.owner, "POST", `${base}/reactivate`)).statusCode).toBe(404);
    expect(await row("select status from memberships where id = $1", [theirs.id])).toEqual([
      { status: "invited" },
    ]);
    expect((await call(who.owner, "GET", "/api/settings/members/nao-uuid")).statusCode).toBe(404);
  });
});

describe("alterar colaborador (RF05, Alteração)", () => {
  it("edita nome e unidades e audita com máscara", async () => {
    const m = await created(who.owner, { displayName: "Antes Nome" });
    const response = await call(who.owner, "PATCH", `/api/settings/members/${m.id}`, {
      body: { displayName: "Depois Nome", unitIds: [unit1, unit2] },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = memberSettingsSchema.parse(response.json());
    expect(body.displayName).toBe("Depois Nome");
    expect([...body.unitIds].sort()).toEqual([unit1, unit2].sort());
    const audits = await row(
      "select metadata::text as m from audit_log where target = $1 and action = 'member.update'",
      [m.id],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].m).not.toContain("Depois Nome");
    expect(audits[0].m).not.toContain("Antes Nome");
  });

  it("trocar o celular exige confirmação (400) e vale para a próxima mensagem", async () => {
    const m = await created(who.owner);
    const oldPhone = await fullPhoneOf(m.id);
    const newPhone = nextPhone();
    const url = `/api/settings/members/${m.id}`;
    expect((await call(who.owner, "PATCH", url, { body: { phone: newPhone } })).statusCode).toBe(
      400,
    );
    const ok = await call(who.owner, "PATCH", url, {
      body: { phone: newPhone, confirmPhoneChange: true },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().phone).toBe(newPhone);
    const directory = createSenderDirectory(createDatabase(h.db.ingest));
    expect(resolveSender(await directory.findMemberships([oldPhone])).kind).toBe("unknown");
    expect(resolveSender(await directory.findMemberships([newPhone])).kind).toBe("known");
  });

  it("celular de quem tem vínculo em outra empresa: 422 phone_shared; e-mail também", async () => {
    const m = await created(who.owner, { email: "compartilhado@ex.com" });
    const [{ user_id: userId }] = await row("select user_id from memberships where id = $1", [
      m.id,
    ]);
    await addMembership(userId, tenantB, { role: "staff", panelAccess: false });
    const url = `/api/settings/members/${m.id}`;
    const phone = await call(who.owner, "PATCH", url, {
      body: { phone: nextPhone(), confirmPhoneChange: true },
    });
    expect(phone.statusCode).toBe(422);
    expect(phone.json()).toEqual({ code: "phone_shared", field: "phone", reason: "shared" });
    const email = await call(who.owner, "PATCH", url, {
      body: { email: "novo.compartilhado@ex.com" },
    });
    expect(email.statusCode).toBe(422);
    expect(email.json()).toEqual({ code: "email_shared", field: "email", reason: "shared" });
    expect(await row("select email from users where id = $1", [userId])).toEqual([
      { email: "compartilhado@ex.com" },
    ]);
  });

  it("celular de outro usuário: 422 phone_in_use; e-mail de outra pessoa: 422 contact_conflict", async () => {
    const first = await created(who.owner);
    const second = await created(who.owner, { email: "segundo@ex.com" });
    const url = `/api/settings/members/${second.id}`;
    const inUse = await call(who.owner, "PATCH", url, {
      body: { phone: await fullPhoneOf(first.id), confirmPhoneChange: true },
    });
    expect(inUse.statusCode).toBe(422);
    expect(inUse.json()).toEqual({ code: "phone_in_use", field: "phone", reason: "in_use" });
    const other = await addUser();
    const conflict = await call(who.owner, "PATCH", url, { body: { email: other.email } });
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json()).toEqual({
      code: "contact_conflict",
      field: "email",
      reason: "conflict",
    });
    expect(conflict.body).not.toContain(other.email);
  });

  it("ganhar painel ou subir de papel com vínculo em outra empresa exige o e-mail exato da pessoa", async () => {
    const m = await created(who.owner, { email: "ganha.painel@ex.com" });
    const [{ user_id: userId }] = await row("select user_id from memberships where id = $1", [
      m.id,
    ]);
    await addMembership(userId, tenantB, { role: "staff", panelAccess: false });
    const url = `/api/settings/members/${m.id}`;
    const neutral = { code: "contact_conflict", field: "email", reason: "conflict" };

    const noEmail = await call(who.owner, "PATCH", url, { body: { panelAccess: true } });
    expect(noEmail.statusCode, noEmail.body).toBe(422);
    expect(noEmail.json()).toEqual(neutral);
    const wrongEmail = await call(who.owner, "PATCH", url, {
      body: { panelAccess: true, email: "outro@ex.com" },
    });
    expect(wrongEmail.statusCode).toBe(422);
    expect(await row("select panel_access from memberships where id = $1", [m.id])).toEqual([
      { panel_access: false },
    ]);
    const promote = await call(who.owner, "PATCH", url, { body: { role: "manager" } });
    expect(promote.statusCode).toBe(422);
    expect(promote.json()).toEqual(neutral);

    const legit = await call(who.owner, "PATCH", url, {
      body: { panelAccess: true, email: "Ganha.Painel@ex.com" },
    });
    expect(legit.statusCode, legit.body).toBe(200);
    expect(legit.json()).not.toHaveProperty("email");
  });

  it("trocar o celular ou o e-mail encerra a sessão do colaborador", async () => {
    for (const body of [
      { phone: nextPhone(), confirmPhoneChange: true },
      { email: "troca.sessao@ex.com" },
    ]) {
      const target = await member(
        tenantA,
        { role: "manager", unitIds: [unit1] },
        `${tenantA}.${unit1}`,
      );
      await admin("delete from memberships where user_id = $1 and tenant_id <> $2", [
        target.userId,
        tenantA,
      ]);
      expect((await call(target, "GET", "/api/settings/units")).statusCode).toBe(200);
      const response = await call(
        who.owner,
        "PATCH",
        `/api/settings/members/${target.membershipId}`,
        {
          body,
        },
      );
      expect(response.statusCode, response.body).toBe(200);
      expect((await call(target, "GET", "/api/settings/units")).statusCode).toBe(401);
    }
  });

  it("a auditoria não grava o e-mail de quem tem vínculo em outra empresa", async () => {
    const m = await created(who.owner, { email: "auditoria.oculta@ex.com" });
    const [{ user_id: userId }] = await row("select user_id from memberships where id = $1", [
      m.id,
    ]);
    await addMembership(userId, tenantB, { role: "staff", panelAccess: false });
    const response = await call(who.owner, "PATCH", `/api/settings/members/${m.id}`, {
      body: { displayName: "Nome Auditado" },
    });
    expect(response.statusCode, response.body).toBe(200);
    const audits = await row(
      "select metadata::text as m from audit_log where target = $1 and action = 'member.update'",
      [m.id],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].m).not.toContain("ex.com");
    expect(audits[0].m).not.toContain("a•••");
  });

  it("troca de e-mail de quem só tem este vínculo funciona", async () => {
    const m = await created(who.owner, { email: "troca.antes@ex.com" });
    const response = await call(who.owner, "PATCH", `/api/settings/members/${m.id}`, {
      body: { email: "troca.depois@ex.com" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().email).toBe("troca.depois@ex.com");
  });

  it("CA06: o único dono ativo não rebaixa o próprio papel", async () => {
    const tenant = await addTenant("Empresa Dono Único", ["U"]);
    const solo = await member(tenant.tenantId, { role: "owner" }, `${tenant.tenantId}.all`);
    const response = await call(solo, "PATCH", `/api/settings/members/${solo.membershipId}`, {
      body: { role: "manager" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "last_active_owner" });
    expect(await row("select role from memberships where id = $1", [solo.membershipId])).toEqual([
      { role: "owner" },
    ]);
  });

  it("CA09: rebaixar o gerente encerra a sessão dele; editar só o nome não encerra", async () => {
    const manager = await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2] },
      `${tenantA}.${unit1}`,
    );
    const url = `/api/settings/members/${manager.membershipId}`;
    expect((await call(manager, "GET", "/api/settings/units")).statusCode).toBe(200);
    const rename = await call(who.owner, "PATCH", url, { body: { displayName: "Gerente Novo" } });
    expect(rename.statusCode, rename.body).toBe(200);
    expect((await call(manager, "GET", "/api/settings/units")).statusCode).toBe(200);

    const demote = await call(who.owner, "PATCH", url, { body: { role: "staff" } });
    expect(demote.statusCode, demote.body).toBe(200);
    expect((await call(manager, "GET", "/api/settings/units")).statusCode).toBe(401);
  });

  it("retirar o acesso ao painel encerra a sessão", async () => {
    const manager = await member(
      tenantA,
      { role: "manager", unitIds: [unit1] },
      `${tenantA}.${unit1}`,
    );
    const response = await call(
      who.owner,
      "PATCH",
      `/api/settings/members/${manager.membershipId}`,
      { body: { panelAccess: false } },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect((await call(manager, "GET", "/api/settings/units")).statusCode).toBe(401);
  });

  it("rebaixar com troca de celular que falha no contato (23505) ainda encerra a sessão", async () => {
    const manager = await member(
      tenantA,
      { role: "manager", unitIds: [unit1] },
      `${tenantA}.${unit1}`,
    );
    // O vínculo padrão do harness (desativado, noutra empresa) contaria como vínculo alheio.
    await admin("delete from memberships where user_id = $1 and tenant_id <> $2", [
      manager.userId,
      tenantA,
    ]);
    // Provoca a violação de unicidade só na gravação do contato, depois do pré-plano e do vínculo.
    await admin(`create or replace function fail_contact_update() returns trigger as $fn$
      begin
        if new.id = '${manager.userId}'::uuid and new.phone_e164 is distinct from old.phone_e164 then
          raise unique_violation using constraint = 'users_phone_e164_key';
        end if;
        return new;
      end $fn$ language plpgsql`);
    await admin(
      "create trigger fail_contact_update before update on users for each row execute function fail_contact_update()",
    );
    try {
      const response = await call(
        who.owner,
        "PATCH",
        `/api/settings/members/${manager.membershipId}`,
        { body: { role: "staff", phone: nextPhone(), confirmPhoneChange: true } },
      );
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toEqual({ code: "phone_in_use", field: "phone", reason: "in_use" });
      // O vínculo já mudou e o contato não: a sessão tem de cair do mesmo jeito.
      expect(
        await row("select role from memberships where id = $1", [manager.membershipId]),
      ).toEqual([{ role: "staff" }]);
      expect((await call(manager, "GET", "/api/settings/units")).statusCode).toBe(401);
    } finally {
      await admin("drop trigger fail_contact_update on users");
      await admin("drop function fail_contact_update()");
    }
  });

  it("retirar uma unidade encerra a sessão", async () => {
    const manager = await member(
      tenantA,
      { role: "manager", unitIds: [unit1, unit2] },
      `${tenantA}.${unit1}`,
    );
    const response = await call(
      who.owner,
      "PATCH",
      `/api/settings/members/${manager.membershipId}`,
      { body: { unitIds: [unit1], defaultUnitId: unit1 } },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect((await call(manager, "GET", "/api/settings/units")).statusCode).toBe(401);
  });
});

describe("desativar e reativar (RF05.R8, CA05)", () => {
  it("desativar encerra a sessão e o canal passa a tratar o número como desconhecido", async () => {
    const worker = await member(
      tenantA,
      { role: "manager", unitIds: [unit1] },
      `${tenantA}.${unit1}`,
    );
    const directory = createSenderDirectory(createDatabase(h.db.ingest));
    expect(resolveSender(await directory.findMemberships([worker.phone])).kind).toBe("known");
    expect((await call(worker, "GET", "/api/settings/units")).statusCode).toBe(200);

    const base = `/api/settings/members/${worker.membershipId}`;
    const off = await call(who.owner, "POST", `${base}/deactivate`);
    expect(off.statusCode, off.body).toBe(200);
    expect(memberSettingsSchema.parse(off.json()).status).toBe("deactivated");
    expect((await call(worker, "GET", "/api/settings/units")).statusCode).toBe(401);
    expect(resolveSender(await directory.findMemberships([worker.phone])).kind).toBe("unknown");

    const on = await call(who.owner, "POST", `${base}/reactivate`);
    expect(on.statusCode, on.body).toBe(200);
    // Sem opt-in registrado, volta como convidado.
    expect(on.json()).toMatchObject({ status: "invited", deactivatedAt: null });
  });

  it("o último dono ativo não se desativa: 422 last_active_owner", async () => {
    const tenant = await addTenant("Empresa Solo Dono", ["U"]);
    const solo = await member(tenant.tenantId, { role: "owner" }, `${tenant.tenantId}.all`);
    const response = await call(
      solo,
      "POST",
      `/api/settings/members/${solo.membershipId}/deactivate`,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "last_active_owner" });
    expect((await call(solo, "GET", "/api/settings/members")).statusCode).toBe(200);
  });
});
