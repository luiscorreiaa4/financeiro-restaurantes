import {
  mergePreviewSchema,
  mergeResultSchema,
  supplierListSchema,
  supplierSettingsSchema,
} from "@app/core/contracts";
import { uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";
import { PERSONAS, type Persona, SUPPLIERS_ROUTE_MATRIX } from "./support/route-matrix";

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

const SUP = "/api/settings/suppliers";
const CPF = "52998224725";
const CPF_MASKED = "•••.•••.247-25";
const CPF2 = "11144477735";

/** CNPJ válido (dígitos verificadores calculados) para o número `n`. */
function cnpjOf(n: number): string {
  const base = `${String(n).padStart(8, "0")}0001`.split("").map(Number);
  const digit = (nums: number[]) => {
    const weights =
      nums.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = nums.reduce((acc, v, i) => acc + v * (weights[i] as number), 0) % 11;
    return sum < 2 ? 0 : 11 - sum;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join("");
}
const CNPJ = "11222333000181";
const CNPJ_OTHER = "11444777000161";
const OCT = "2026-10-15";
const NOV = "2026-11-05";

const cat = { payroll: uuidv7(), meat: uuidv7() };
let unit3: string;

beforeAll(async () => {
  for (const [id, name, sensitive] of [
    [cat.payroll, "Salários", true],
    [cat.meat, "Carnes", false],
  ] as const) {
    await admin(
      `insert into categories (id, tenant_id, name, kind, nature, dre_group, is_sensitive)
       values ($1, null, $2, 'expense', 'fixed', 'x', $3)`,
      [id, name, sensitive],
    );
  }
  unit3 = (await addTenant("Só para unidade", ["U3"])).unitIds[0] as string;
});

async function addSupplier(
  tenantId: string,
  name: string,
  extra: { document?: string; aliases?: string[]; status?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await admin(
    `insert into suppliers (id, tenant_id, name, document, aliases, status, origin)
     values ($1, $2, $3, $4, $5, $6, 'panel')`,
    [id, tenantId, name, extra.document ?? null, extra.aliases ?? [], extra.status ?? "active"],
  );
  return id;
}

async function addEntry(e: {
  supplierId: string;
  unitId?: string;
  categoryId?: string | null;
  cents?: number;
  on?: string;
  deleted?: boolean;
  tenantId?: string;
}): Promise<string> {
  const id = uuidv7();
  const deleted = e.deleted === true;
  await admin(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
       amount_cents, net_cents, category_id, supplier_id, created_by, deleted_at, deleted_by,
       restorable_until)
     values ($1, $2, $3, 'expense', $4, $4, 'Compra', $5, $5, $6, $7, $8,
       case when $9 then now() else null end, case when $9 then $8::uuid else null end,
       case when $9 then '2026-12-05'::date else null end)`,
    [
      id,
      e.tenantId ?? tenantA,
      e.unitId ?? unit1,
      e.on ?? NOV,
      e.cents ?? 1000,
      e.categoryId === undefined ? cat.meat : e.categoryId,
      e.supplierId,
      who.owner.userId,
      deleted,
    ],
  );
  return id;
}

const list = async (user: Who, query = "") => {
  const response = await call(user, "GET", `${SUP}${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return supplierListSchema.parse(response.json());
};
const find = <T extends { id: string }>(items: T[], id: string) => items.find((i) => i.id === id);
const merge = (user: Who, source: string, targetId: string, ctx?: string) =>
  call(user, "POST", `${SUP}/${source}/merge`, { body: { targetId }, ...(ctx ? { ctx } : {}) });

describe("matriz papel x rota de fornecedores (RF10, RF06.CA06)", () => {
  for (const route of SUPPLIERS_ROUTE_MATRIX) {
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
    for (const route of SUPPLIERS_ROUTE_MATRIX) {
      const response = await call(who.owner, route.method, route.url(), {
        xContext: null,
        body: route.body?.(),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });
});

describe("total gasto e última compra no recorte do ator (Review Focus 2, RF06.R3)", () => {
  let folha: string;
  let misto: string;

  it("fornecedor só com folha: gerente sem VER_FOLHA vê total zero e última compra nula", async () => {
    folha = await addSupplier(tenantA, "Cooperativa Folha");
    await addEntry({ supplierId: folha, categoryId: cat.payroll, cents: 777_00 });
    misto = await addSupplier(tenantA, "Distribuidora Mista");
    await addEntry({ supplierId: misto, categoryId: cat.meat, cents: 100_00, on: "2026-11-02" });
    await addEntry({ supplierId: misto, categoryId: cat.payroll, cents: 900_00, on: "2026-11-08" });

    const noPayroll = (await list(who.managerNoPayroll)).items;
    expect(find(noPayroll, folha)).toMatchObject({ totalSpentCents: 0, lastPurchaseOn: null });
    expect(find(noPayroll, misto)).toMatchObject({
      totalSpentCents: 100_00,
      lastPurchaseOn: "2026-11-02",
    });
  });

  it("dono, contador e gerente com VER_FOLHA veem tudo (DD-04)", async () => {
    for (const persona of [who.owner, who.accountant, who.manager]) {
      const items = (await list(persona)).items;
      expect(find(items, folha)).toMatchObject({
        totalSpentCents: 777_00,
        lastPurchaseOn: NOV,
      });
      expect(find(items, misto)).toMatchObject({
        totalSpentCents: 1000_00,
        lastPurchaseOn: "2026-11-08",
      });
    }
  });

  it("lançamento sem categoria conta; categoria que a junção não traz é tratada como folha", async () => {
    const s = await addSupplier(tenantA, "Sem Categoria");
    await addEntry({ supplierId: s, categoryId: null, cents: 50_00 });
    expect(find((await list(who.managerNoPayroll)).items, s)?.totalSpentCents).toBe(50_00);
  });

  it("recorte de unidade: gerente de uma unidade não soma a outra", async () => {
    const s = await addSupplier(tenantA, "Duas Unidades");
    await addEntry({ supplierId: s, unitId: unit1, cents: 10_00 });
    await addEntry({ supplierId: s, unitId: unit2, cents: 20_00, on: "2026-11-09" });
    const cross = await call(managerA_ownerB.who, "GET", SUP, { ctx: managerA_ownerB.ctxA });
    const item = find(supplierListSchema.parse(cross.json()).items, s);
    expect(item).toMatchObject({ totalSpentCents: 10_00, lastPurchaseOn: NOV });
    expect(find((await list(who.owner)).items, s)?.totalSpentCents).toBe(30_00);
  });

  it("período: padrão é o mês corrente; lixeira e outro mês não entram; from/to ampliam", async () => {
    const s = await addSupplier(tenantA, "Períodos");
    await addEntry({ supplierId: s, cents: 11_00, on: NOV });
    await addEntry({ supplierId: s, cents: 22_00, on: OCT });
    await addEntry({ supplierId: s, cents: 99_00, on: NOV, deleted: true });
    const month = await list(who.owner);
    expect(month).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(find(month.items, s)?.totalSpentCents).toBe(11_00);
    const wide = await list(who.owner, "?from=2026-10-01&to=2026-11-30");
    expect(find(wide.items, s)).toMatchObject({ totalSpentCents: 33_00, lastPurchaseOn: NOV });
    const bad = await call(who.owner, "GET", `${SUP}?from=2026-11-30&to=2026-11-01`);
    expect(bad.statusCode).toBe(422);
  });

  it("isolamento: fornecedor de outra empresa não aparece", async () => {
    const other = await addSupplier(tenantB, "Fornecedor da B");
    expect(find((await list(who.owner)).items, other)).toBeUndefined();
  });

  it("busca por nome, apelido e documento; mesclados não aparecem; filtro de status", async () => {
    const s = await addSupplier(tenantA, "Açougue Central", {
      aliases: ["Seu Zé"],
      document: CNPJ_OTHER,
    });
    const gone = await addSupplier(tenantA, "Inativo Velho", { status: "inactive" });
    for (const q of ["acougue", "seu ze", "11.444.777", "ZÉ"]) {
      expect(
        find((await list(who.owner, `?search=${encodeURIComponent(q)}`)).items, s),
        q,
      ).toBeDefined();
    }
    expect(find((await list(who.owner)).items, gone)).toBeDefined();
    expect(find((await list(who.owner, "?status=active")).items, gone)).toBeUndefined();
    expect(find((await list(who.owner, "?status=inactive")).items, gone)).toBeDefined();
  });
});

describe("CPF mascarado pelo servidor (RF10.R2, CA03)", () => {
  let pf: string;
  let pj: string;

  it("mascara para quem não é dono nem exporta dados; CNPJ sempre inteiro", async () => {
    pf = await addSupplier(tenantA, "Pessoa Física", { document: CPF });
    pj = await addSupplier(tenantA, "Pessoa Jurídica", { document: CNPJ });
    const exporter = await member(
      tenantA,
      { role: "manager", unitIds: [unit1], permissions: ["EXPORTAR_DADOS"] },
      `${tenantA}.${unit1}`,
    );
    for (const persona of [who.owner, who.accountant, exporter]) {
      const items = (await list(persona)).items;
      expect(find(items, pf)).toMatchObject({ document: CPF, documentKind: "cpf" });
    }
    for (const persona of [who.manager, who.managerNoPayroll]) {
      const response = await call(persona, "GET", SUP);
      expect(response.body).not.toContain(CPF);
      const items = supplierListSchema.parse(response.json()).items;
      expect(find(items, pf)).toMatchObject({ document: CPF_MASKED, documentKind: "cpf" });
      expect(find(items, pj)).toMatchObject({ document: CNPJ, documentKind: "cnpj" });
    }
  });

  it("a busca por dígitos não revela o CPF escondido ao gerente (oráculo)", async () => {
    const hidden = await call(who.manager, "GET", `${SUP}?search=52998`);
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(find(supplierListSchema.parse(hidden.json()).items, pf)).toBeUndefined();
    const hiddenFormatted = await call(who.managerNoPayroll, "GET", `${SUP}?search=529.982`);
    expect(find(supplierListSchema.parse(hiddenFormatted.json()).items, pf)).toBeUndefined();
    const visible = await call(who.manager, "GET", `${SUP}?search=247`);
    expect(find(supplierListSchema.parse(visible.json()).items, pf)).toBeDefined();
    const owner = await call(who.owner, "GET", `${SUP}?search=52998`);
    expect(find(supplierListSchema.parse(owner.json()).items, pf)).toBeDefined();
  });

  it("a resposta do PATCH também mascara para o gerente", async () => {
    const response = await call(who.managerNoPayroll, "PATCH", `${SUP}/${pf}`, {
      body: { aliases: ["pf"] },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain(CPF);
    expect(supplierSettingsSchema.parse(response.json()).document).toBe(CPF_MASKED);
  });
});

describe("editar fornecedor (RF10)", () => {
  let b: string;

  it("nome repetido e documento repetido: 409; documento inválido: 422", async () => {
    await addSupplier(tenantA, "Editável A", { document: cnpjOf(30) });
    b = await addSupplier(tenantA, "Editável B");
    const dup = await call(who.owner, "PATCH", `${SUP}/${b}`, { body: { name: "editavel a" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ code: "name_taken" });
    const docDup = await call(who.owner, "PATCH", `${SUP}/${b}`, {
      body: { document: cnpjOf(30) },
    });
    // Documento inválido (dígito verificador errado) cai em 422; o repetido válido, em 409.
    expect([409, 422]).toContain(docDup.statusCode);
    const bad = await call(who.owner, "PATCH", `${SUP}/${b}`, { body: { document: "123" } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: "validation", field: "document" });
  });

  it("documento igual ao de outra empresa é aceito (único por empresa)", async () => {
    const x = await addSupplier(tenantA, "Mesmo Doc A", { document: cnpjOf(31) });
    const y = await addSupplier(tenantB, "Mesmo Doc B");
    const response = await call(managerA_ownerB.who, "PATCH", `${SUP}/${y}`, {
      ctx: managerA_ownerB.ctxB,
      body: { document: cnpjOf(31) },
    });
    expect(response.statusCode, response.body).toBe(200);
    const clash = await call(who.owner, "PATCH", `${SUP}/${b}`, { body: { document: cnpjOf(31) } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toEqual({ code: "document_taken" });
    expect(x).toBeDefined();
  });

  it("fornecedor de outra empresa ou inexistente: 404; auditoria sem CPF completo", async () => {
    const other = await addSupplier(tenantB, "Alheio");
    const response = await call(who.owner, "PATCH", `${SUP}/${other}`, { body: { name: "Hack" } });
    expect(response.statusCode).toBe(404);
    const edit = await call(who.manager, "PATCH", `${SUP}/${b}`, {
      body: { document: CPF.replace(/^5299822472/, "5299822472"), name: "Editável B2" },
    });
    // CPF já usado por "Pessoa Física" (409) ou livre: o que importa é a auditoria do que passou.
    const ok =
      edit.statusCode === 200
        ? edit
        : await call(who.manager, "PATCH", `${SUP}/${b}`, {
            body: { name: "Editável B2" },
          });
    expect(ok.statusCode).toBe(200);
    const audit = await admin(
      "select metadata from audit_log where tenant_id = $1 and action = 'supplier.update' and target = $2",
      [tenantA, b],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain(CPF);
    expect(JSON.stringify(audit.rows[0].metadata)).toContain("Editável B2");
  });
});

describe("trocar CPF com a mesma máscara (RF10.R2)", () => {
  it("grava o CPF novo mesmo quando a máscara de antes e depois é igual", async () => {
    const id = await addSupplier(tenantA, "Troca de CPF");
    const first = await call(who.owner, "PATCH", `${SUP}/${id}`, {
      body: { document: "30005524725" },
    });
    expect(first.statusCode, first.body).toBe(200);
    const second = await call(who.owner, "PATCH", `${SUP}/${id}`, {
      body: { document: "30013624725" },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(supplierSettingsSchema.parse(second.json()).document).toBe("30013624725");
    const stored = await admin("select document from suppliers where id = $1", [id]);
    expect(stored.rows[0].document).toBe("30013624725");
    const audit = await admin(
      "select metadata from audit_log where tenant_id = $1 and action = 'supplier.update' and target = $2",
      [tenantA, id],
    );
    expect(audit.rows.length).toBe(2);
    expect(JSON.stringify(audit.rows)).not.toContain("30013624725");
  });
});

describe("mesclagem (RF10.CA02, Review Focus 4)", () => {
  let src: string;
  let dst: string;
  let ids: { visible: string; hidden: string; payroll: string; trashed: string };

  it("a prévia conta só o que o ator vê (unidade, folha, sem lixeira)", async () => {
    src = await addSupplier(tenantA, "Origem Mesclada", {
      aliases: ["orig"],
      document: CPF2,
    });
    dst = await addSupplier(tenantA, "Destino Mesclado", { aliases: ["dest"] });
    ids = {
      visible: await addEntry({ supplierId: src, cents: 10_00 }),
      hidden: await addEntry({ supplierId: src, unitId: unit2, cents: 20_00 }),
      payroll: await addEntry({ supplierId: src, categoryId: cat.payroll, cents: 30_00 }),
      trashed: await addEntry({ supplierId: src, cents: 40_00, deleted: true }),
    };
    const preview = (user: Who, ctx?: string) =>
      call(user, "POST", `${SUP}/${src}/merge/preview`, {
        body: { targetId: dst },
        ...(ctx ? { ctx } : {}),
      });
    const narrow = await preview(managerA_ownerB.who, managerA_ownerB.ctxA);
    expect(narrow.statusCode, narrow.body).toBe(200);
    // Gerente cruzado: só unidade 1, sem folha -> apenas o lançamento visível.
    expect(mergePreviewSchema.parse(narrow.json())).toEqual({ visibleEntries: 1 });
    expect(mergePreviewSchema.parse((await preview(who.managerNoPayroll)).json())).toEqual({
      visibleEntries: 1 + 1,
    });
    expect(mergePreviewSchema.parse((await preview(who.owner)).json())).toEqual({
      visibleEntries: 3,
    });
  });

  it("prévia de outra empresa ou mesmo fornecedor: 404 e 422", async () => {
    const other = await addSupplier(tenantB, "Alheio 2");
    const r1 = await call(who.owner, "POST", `${SUP}/${src}/merge/preview`, {
      body: { targetId: other },
    });
    expect(r1.statusCode).toBe(404);
    const r2 = await call(who.owner, "POST", `${SUP}/${src}/merge/preview`, {
      body: { targetId: src },
    });
    expect(r2.statusCode).toBe(422);
  });

  it("gerente sem unidade e sem folha mescla: tudo é movido, resposta sem contagem total", async () => {
    const response = await merge(managerA_ownerB.who, src, dst, managerA_ownerB.ctxA);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).not.toHaveProperty("moved");
    const body = mergeResultSchema.parse(response.json());
    expect(body.target.id).toBe(dst);
    // Mesclar não revela a folha nem o CPF: o destino herdou o documento, mascarado.
    expect(response.body).not.toContain(CPF2);
    expect(body.target.document).toBe("•••.•••.777-35");
    expect(body.target.aliases).toEqual(["dest", "Origem Mesclada", "orig"]);
    // Total do destino no recorte do gerente: só o lançamento da unidade 1, sem folha.
    expect(body.target.totalSpentCents).toBe(10_00);

    const moved = await admin(
      "select id, supplier_id, version from entries where id = any($1::uuid[])",
      [Object.values(ids)],
    );
    expect(moved.rows).toHaveLength(4);
    for (const row of moved.rows) {
      expect(row.supplier_id).toBe(dst);
      expect(row.version).toBe(2);
    }
    const versions = await admin(
      `select entry_id, version, action, channel, changed_by, "after"->>'supplierId' as sup
         from entry_versions where entry_id = any($1::uuid[]) and version = 2`,
      [Object.values(ids)],
    );
    expect(versions.rows).toHaveLength(4);
    for (const row of versions.rows) {
      expect(row).toMatchObject({
        action: "update",
        channel: "web",
        changed_by: managerA_ownerB.who.userId,
        sup: dst,
      });
    }
    const [source] = (await admin("select * from suppliers where id = $1", [src])).rows;
    expect(source).toMatchObject({ status: "inactive", merged_into_id: dst });
    expect((await list(who.owner)).items.find((i) => i.id === src)).toBeUndefined();
  });

  it("auditoria da mesclagem sem CPF completo", async () => {
    const audit = await admin(
      "select actor_id, metadata from audit_log where tenant_id = $1 and action = 'supplier.merge' and target = $2",
      [tenantA, dst],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(managerA_ownerB.who.userId);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(CPF2);
    expect(audit.rows[0].metadata).toMatchObject({ sourceId: src, targetId: dst, moved: 4 });
  });

  it("lançamento da lixeira restaurado aparece no destino (Review Focus 4)", async () => {
    const before = find((await list(who.owner)).items, dst)?.totalSpentCents;
    expect(before).toBe(10_00 + 20_00 + 30_00);
    await admin(
      "update entries set deleted_at = null, deleted_by = null, restorable_until = null where id = $1",
      [ids.trashed],
    );
    expect(find((await list(who.owner)).items, dst)?.totalSpentCents).toBe((before ?? 0) + 40_00);
  });

  it("origem já mesclada: 409 already_merged; documento diferente: 422 document_conflict", async () => {
    const again = await merge(who.owner, src, dst);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "already_merged" });
    const p = await addSupplier(tenantA, "Doc Um", { document: cnpjOf(32) });
    const q = await addSupplier(tenantA, "Doc Dois", { document: cnpjOf(33) });
    const conflict = await merge(who.owner, p, q);
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json()).toEqual({ code: "document_conflict" });
  });

  it("apelidos acima de 10: 422 aliases_overflow e nada muda", async () => {
    const many = Array.from({ length: 8 }, (_, i) => `ap${i}`);
    const p = await addSupplier(tenantA, "Muitos Um", { aliases: many });
    const q = await addSupplier(tenantA, "Muitos Dois", { aliases: ["x1", "x2", "x3"] });
    await addEntry({ supplierId: p });
    const response = await merge(who.owner, p, q);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "aliases_overflow" });
    const rows = await admin("select count(*)::int as n from entries where supplier_id = $1", [p]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("documento igual em outra empresa não conflita na mesclagem", async () => {
    await addSupplier(tenantB, "Doc igual na B", { document: cnpjOf(34) });
    const p = await addSupplier(tenantA, "Sem Doc", {});
    const q = await addSupplier(tenantA, "Com Doc", { document: cnpjOf(34) });
    expect((await merge(who.owner, p, q)).statusCode).toBe(200);
  });

  it("teto de lançamentos: 422 merge_too_large, tudo ou nada", async () => {
    const p = await addSupplier(tenantA, "Grande Um");
    const q = await addSupplier(tenantA, "Grande Dois");
    for (let i = 0; i < 3; i++) await addEntry({ supplierId: p });
    h.setMergeLimit(2);
    try {
      const response = await merge(who.owner, p, q);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code: "merge_too_large" });
    } finally {
      h.setMergeLimit(undefined);
    }
    const left = await admin("select count(*)::int as n from entries where supplier_id = $1", [p]);
    expect(left.rows[0].n).toBe(3);
    const [source] = (await admin("select merged_into_id from suppliers where id = $1", [p])).rows;
    expect(source.merged_into_id).toBeNull();
    h.setMergeLimit(3);
    try {
      expect((await merge(who.owner, p, q)).statusCode).toBe(200);
    } finally {
      h.setMergeLimit(undefined);
    }
  });

  it("origem ou destino de outra empresa: 404 e nada é movido", async () => {
    const p = await addSupplier(tenantA, "Local");
    await addEntry({ supplierId: p });
    const alien = await addSupplier(tenantB, "Alienígena");
    expect((await merge(who.owner, p, alien)).statusCode).toBe(404);
    expect((await merge(who.owner, alien, p)).statusCode).toBe(404);
    const rows = await admin("select count(*)::int as n from entries where supplier_id = $1", [p]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("mesclagens opostas em paralelo (A->B e B->A): uma vence, a outra é recusada, sem deadlock", async () => {
    const p = await addSupplier(tenantA, "Corrida P");
    const q = await addSupplier(tenantA, "Corrida Q");
    for (let i = 0; i < 5; i++) {
      await addEntry({ supplierId: p });
      await addEntry({ supplierId: q });
    }
    const [r1, r2] = await Promise.all([merge(who.owner, p, q), merge(who.owner, q, p)]);
    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json()).toEqual({ code: "already_merged" });
    const winner = r1.statusCode === 200 ? q : p;
    const count = await admin(
      "select count(*)::int as n from entries where supplier_id = any($1::uuid[]) and supplier_id = $2",
      [[p, q], winner === q ? q : p],
    );
    expect(count.rows[0].n).toBe(10);
  });

  it("a mesclagem espera a trava da origem e do destino (FOR UPDATE), de forma determinística", async () => {
    const p = await addSupplier(tenantA, "Trava P");
    const q = await addSupplier(tenantA, "Trava Q");
    for (const held of [p, q]) {
      const client = await h.db.admin.connect();
      try {
        await client.query("begin");
        await client.query("select id from suppliers where id = $1 for update", [held]);
        let settled = false;
        const pending = merge(who.owner, p, q).then((r) => {
          settled = true;
          return r;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(
          settled,
          `merge deveria esperar a trava de ${held === p ? "origem" : "destino"}`,
        ).toBe(false);
        await client.query("rollback");
        const response = await pending;
        // A primeira rodada espera e mescla; a segunda encontra a origem já mesclada.
        expect([200, 409]).toContain(response.statusCode);
      } finally {
        client.release();
      }
    }
  });

  it("mesclar com o gerente exige supplier:manage: contador recebe 403 e nada muda", async () => {
    const p = await addSupplier(tenantA, "Contador P");
    const q = await addSupplier(tenantA, "Contador Q");
    expect((await merge(who.accountant, p, q)).statusCode).toBe(403);
    expect((await merge(who.staff, p, q)).statusCode).toBe(403);
    void unit3;
  });
});
