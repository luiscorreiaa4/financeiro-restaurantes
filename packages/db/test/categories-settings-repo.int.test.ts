import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCategoriesSettingsRepo } from "../src/categories-settings-repo";
import { createDatabase } from "../src/client";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;
const sys = { payroll: uuidv7(), meat: uuidv7(), sales: uuidv7(), inactive: uuidv7() };

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
  const insert = (
    id: string,
    name: string,
    kind: string,
    nature: string | null,
    dre: string,
    sensitive: boolean,
    qty: boolean,
    words: string[],
    status = "active",
  ) =>
    db.admin.query(
      `insert into categories (id, tenant_id, name, kind, nature, dre_group, is_sensitive, requires_quantity, support_words, status)
       values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, kind, nature, dre, sensitive, qty, words, status],
    );
  await insert(sys.payroll, "Salários", "expense", "fixed", "pessoal", true, false, ["holerite"]);
  await insert(sys.meat, "Carnes", "expense", "variable", "cmv", false, true, ["picanha"]);
  await insert(sys.sales, "Vendas", "revenue", null, "receita_bruta", false, false, []);
  await insert(
    sys.inactive,
    "Descontinuada",
    "expense",
    "variable",
    "outras",
    false,
    false,
    [],
    "inactive",
  );
});

afterAll(async () => {
  await db?.stop();
});

const repo = () => createCategoriesSettingsRepo(createDatabase(db.app));
const seeAll = { includeSensitive: true };
const noPayroll = { includeSensitive: false };

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown } | null): T {
  if (!result?.ok) throw new Error(`esperava ok, veio ${JSON.stringify(result)}`);
  return result.value;
}
const failure = (result: { ok: boolean; error?: unknown } | null) => {
  if (result === null || result.ok) throw new Error("esperava falha");
  return result.error;
};

const names = (tree: { name: string; children: { name: string }[] }[]) =>
  tree.flatMap((n) => [n.name, ...n.children.map((c) => c.name)]);

describe("CategoriesSettingsRepo: leitura (RF07)", () => {
  it("devolve árvore de dois níveis com origem system e company", async () => {
    const created = unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.meat, name: "Bovinos", supportWords: ["boi"] },
        seeAll,
      ),
    );
    const tree = await repo().list(a.tenantId, seeAll);
    const meat = tree.find((n) => n.id === sys.meat);
    expect(meat).toMatchObject({
      origin: "system",
      children: [{ id: created.id, origin: "company" }],
    });
    expect(tree.find((n) => n.name === "Categoria própria")?.origin).toBe("company");
  });

  it("sem VER_FOLHA: nem a categoria sensível nem as subcategorias dela aparecem", async () => {
    unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.payroll, name: "Diaristas", supportWords: ["diária"] },
        seeAll,
      ),
    );
    const hidden = names(await repo().list(a.tenantId, noPayroll));
    expect(hidden).not.toContain("Salários");
    expect(hidden).not.toContain("Diaristas");
    expect(hidden).toContain("Carnes");
    const visible = names(await repo().list(a.tenantId, seeAll));
    expect(visible).toEqual(expect.arrayContaining(["Salários", "Diaristas"]));
  });

  it("sem VER_FOLHA: busca por nome ou palavra de apoio não revela a folha", async () => {
    for (const search of ["sal", "holerite", "diaria", "diária", "Diaristas"]) {
      const found = names(await repo().list(a.tenantId, { ...noPayroll, search }));
      expect(found, search).toEqual([]);
      expect(names(await repo().list(a.tenantId, { ...seeAll, search })), search).not.toEqual([]);
    }
  });

  it("subcategoria sensível sob pai não sensível também fica oculta (falha fechado)", async () => {
    await db.admin.query(
      `insert into categories (id, tenant_id, parent_id, name, kind, dre_group, is_sensitive)
       values ($1, $2, $3, 'Subcategoria sensível solta', 'expense', 'cmv', true)`,
      [uuidv7(), a.tenantId, sys.meat],
    );
    expect(names(await repo().list(a.tenantId, noPayroll))).not.toContain(
      "Subcategoria sensível solta",
    );
    expect(names(await repo().list(a.tenantId, seeAll))).toContain("Subcategoria sensível solta");
  });

  it("subcategoria marcada não sensível sob pai sensível também fica oculta (falha fechado)", async () => {
    const id = uuidv7();
    await db.admin.query(
      `insert into categories (id, tenant_id, parent_id, name, kind, dre_group, is_sensitive, support_words)
       values ($1, $2, $3, 'Filha mal marcada', 'expense', 'pessoal', false, '{marcada}')`,
      [id, a.tenantId, sys.payroll],
    );
    expect(names(await repo().list(a.tenantId, noPayroll))).not.toContain("Filha mal marcada");
    expect(names(await repo().list(a.tenantId, { ...noPayroll, search: "marcada" }))).toEqual([]);
    expect(
      await repo().updateSubcategory(a.tenantId, a.userId, id, { name: "Vazou" }, noPayroll),
    ).toBeNull();
    expect(names(await repo().list(a.tenantId, seeAll))).toContain("Filha mal marcada");
  });

  it("busca por palavra de apoio, sem caixa nem acento, traz a pai da subcategoria", async () => {
    const tree = await repo().list(a.tenantId, { ...noPayroll, search: "BOI" });
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: sys.meat, children: [{ name: "Bovinos" }] });
    expect(names(await repo().list(a.tenantId, { ...noPayroll, search: "picanha" }))).toContain(
      "Carnes",
    );
  });

  it("filtra por tipo e por situação", async () => {
    const revenue = await repo().list(a.tenantId, { ...seeAll, kind: "revenue" });
    expect(names(revenue)).toEqual(["Vendas"]);
    const inactive = await repo().list(a.tenantId, { ...seeAll, status: "inactive" });
    expect(names(inactive)).toEqual(["Descontinuada"]);
  });

  it("A não vê categoria nem subcategoria de B", async () => {
    unwrap(
      await repo().createSubcategory(
        b.tenantId,
        b.userId,
        { parentId: sys.sales, name: "Só da B", supportWords: [] },
        seeAll,
      ),
    );
    expect(names(await repo().list(a.tenantId, seeAll))).not.toContain("Só da B");
    expect(names(await repo().list(b.tenantId, seeAll))).toContain("Só da B");
  });
});

describe("CategoriesSettingsRepo: criar subcategoria (RF07.R1 a R8)", () => {
  it("herda tipo, grupo, sensível e quantidade do pai; grava origem company e auditoria", async () => {
    const created = unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.meat, name: "  Suínos ", supportWords: [" porco "] },
        seeAll,
      ),
    );
    expect(created).toMatchObject({
      name: "Suínos",
      parentId: sys.meat,
      kind: "expense",
      nature: "variable",
      dreGroup: "cmv",
      requiresQuantity: true,
      isSensitive: false,
      origin: "company",
      status: "active",
      supportWords: ["porco"],
    });
    const row = await db.admin.query("select tenant_id from categories where id = $1", [
      created.id,
    ]);
    expect(row.rows[0].tenant_id).toBe(a.tenantId);
    const audit = await db.admin.query(
      "select actor_id, metadata from audit_log where tenant_id = $1 and action = 'category.create' and target = $2",
      [a.tenantId, created.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(a.userId);
    expect(audit.rows[0].metadata.after).toMatchObject({ name: "Suínos", parentId: sys.meat });
  });

  it("subcategoria de folha herda sensível", async () => {
    const created = unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.payroll, name: "Cozinheiros", supportWords: [] },
        seeAll,
      ),
    );
    expect(created.isSensitive).toBe(true);
  });

  it("natureza: troca em despesa; recusa em receita", async () => {
    const fixed = unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.meat, name: "Fixa", nature: "fixed", supportWords: [] },
        seeAll,
      ),
    );
    expect(fixed.nature).toBe("fixed");
    const bad = failure(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.sales, name: "Com natureza", nature: "fixed", supportWords: [] },
        seeAll,
      ),
    );
    expect(bad).toMatchObject({ code: "InvalidCategory", field: "nature" });
  });

  it("pai de outra empresa, inexistente ou subcategoria: UnknownReference ou too_deep", async () => {
    const ofB = unwrap(
      await repo().createSubcategory(
        b.tenantId,
        b.userId,
        { parentId: sys.sales, name: "Filha da B", supportWords: [] },
        seeAll,
      ),
    );
    for (const parentId of [ofB.id, uuidv7(), b.categoryId]) {
      const error = failure(
        await repo().createSubcategory(
          a.tenantId,
          a.userId,
          { parentId, name: "Invasora", supportWords: [] },
          seeAll,
        ),
      );
      expect(error, parentId).toMatchObject({ code: "UnknownReference" });
    }
    const rows = await db.admin.query("select 1 from categories where name = 'Invasora'");
    expect(rows.rowCount).toBe(0);
  });

  it("pai da própria empresa (não do sistema) é recusado; pai inativo também", async () => {
    expect(
      failure(
        await repo().createSubcategory(
          a.tenantId,
          a.userId,
          { parentId: a.categoryId, name: "Filha de própria", supportWords: [] },
          seeAll,
        ),
      ),
    ).toMatchObject({ code: "InvalidCategory", field: "parent", reason: "not_system" });
    expect(
      failure(
        await repo().createSubcategory(
          a.tenantId,
          a.userId,
          { parentId: sys.inactive, name: "Filha de inativa", supportWords: [] },
          seeAll,
        ),
      ),
    ).toMatchObject({ code: "InvalidCategory", field: "parent", reason: "inactive" });
  });

  it("pai sensível que o ator não vê responde como pai inexistente", async () => {
    const error = failure(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.payroll, name: "Escondida", supportWords: [] },
        noPayroll,
      ),
    );
    expect(error).toMatchObject({ code: "UnknownReference" });
  });

  it("nome repetido entre irmãs: duplicate (sem caixa nem acento); em pai diferente pode", async () => {
    unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.sales, name: "Eventos", supportWords: [] },
        seeAll,
      ),
    );
    expect(
      failure(
        await repo().createSubcategory(
          a.tenantId,
          a.userId,
          { parentId: sys.sales, name: "EVENTOS", supportWords: [] },
          seeAll,
        ),
      ),
    ).toMatchObject({ code: "InvalidCategory", field: "name", reason: "duplicate" });
    unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId: sys.meat, name: "Eventos", supportWords: [] },
        seeAll,
      ),
    );
  });

  it("corrida: nome exato igual pego pelo índice vira NameTaken", async () => {
    const parent = sys.sales;
    const results = await Promise.all(
      [1, 2].map(() =>
        repo().createSubcategory(
          a.tenantId,
          a.userId,
          { parentId: parent, name: "Corrida", supportWords: [] },
          seeAll,
        ),
      ),
    );
    const oks = results.filter((r) => r.ok);
    const errs = results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error));
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({
      code: expect.stringMatching(/^(NameTaken|InvalidCategory)$/),
    });
  });
});

describe("CategoriesSettingsRepo: editar subcategoria", () => {
  const make = async (name: string, parentId = sys.meat) =>
    unwrap(
      await repo().createSubcategory(
        a.tenantId,
        a.userId,
        { parentId, name, supportWords: [] },
        seeAll,
      ),
    );

  it("muda só o que veio e audita antes e depois apenas dos campos alterados", async () => {
    const created = await make("Para editar");
    const updated = unwrap(
      await repo().updateSubcategory(
        a.tenantId,
        a.userId,
        created.id,
        { name: "Editada", supportWords: ["x1"] },
        seeAll,
      ),
    );
    expect(updated).toMatchObject({ name: "Editada", supportWords: ["x1"], nature: "variable" });
    const audit = await db.admin.query(
      "select metadata from audit_log where tenant_id = $1 and action = 'category.update' and target = $2",
      [a.tenantId, created.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({
      before: { name: "Para editar", supportWords: [] },
      after: { name: "Editada", supportWords: ["x1"] },
    });
  });

  it("sem mudança real não grava auditoria", async () => {
    const created = await make("Sem mudança");
    unwrap(
      await repo().updateSubcategory(
        a.tenantId,
        a.userId,
        created.id,
        { name: "Sem mudança" },
        seeAll,
      ),
    );
    const audit = await db.admin.query(
      "select 1 from audit_log where action = 'category.update' and target = $1",
      [created.id],
    );
    expect(audit.rowCount).toBe(0);
  });

  it("categoria do sistema não se edita (CA01)", async () => {
    const result = await repo().updateSubcategory(
      a.tenantId,
      a.userId,
      sys.meat,
      { name: "Hack" },
      seeAll,
    );
    expect(failure(result)).toEqual({ code: "SystemCategoryReadOnly" });
    const row = await db.admin.query("select name from categories where id = $1", [sys.meat]);
    expect(row.rows[0].name).toBe("Carnes");
  });

  it("subcategoria de outra empresa e id inexistente devolvem null", async () => {
    const ofB = unwrap(
      await repo().createSubcategory(
        b.tenantId,
        b.userId,
        { parentId: sys.sales, name: "Da B para editar", supportWords: [] },
        seeAll,
      ),
    );
    expect(
      await repo().updateSubcategory(a.tenantId, a.userId, ofB.id, { name: "Invadida" }, seeAll),
    ).toBeNull();
    expect(
      await repo().updateSubcategory(a.tenantId, a.userId, uuidv7(), { name: "Nada" }, seeAll),
    ).toBeNull();
    const row = await db.admin.query("select name from categories where id = $1", [ofB.id]);
    expect(row.rows[0].name).toBe("Da B para editar");
  });

  it("subcategoria sensível que o ator não vê devolve null", async () => {
    const hidden = await make("Folha oculta", sys.payroll);
    expect(
      await repo().updateSubcategory(a.tenantId, a.userId, hidden.id, { name: "Vazou" }, noPayroll),
    ).toBeNull();
  });

  it("nome repetido entre irmãs: duplicate; trocar o pai não existe no contrato, mas o domínio recusa", async () => {
    await make("Irmã 1");
    const second = await make("Irmã 2");
    expect(
      failure(
        await repo().updateSubcategory(a.tenantId, a.userId, second.id, { name: "irmã 1" }, seeAll),
      ),
    ).toMatchObject({ code: "InvalidCategory", field: "name", reason: "duplicate" });
  });

  it("natureza só em despesa; inativar mantém a linha (RF07.R10)", async () => {
    const income = await make("Receita extra", sys.sales);
    expect(
      failure(
        await repo().updateSubcategory(
          a.tenantId,
          a.userId,
          income.id,
          { nature: "fixed" },
          seeAll,
        ),
      ),
    ).toEqual({ code: "NatureOnlyForExpense" });
    const off = unwrap(
      await repo().updateSubcategory(
        a.tenantId,
        a.userId,
        income.id,
        { status: "inactive" },
        seeAll,
      ),
    );
    expect(off.status).toBe("inactive");
    const row = await db.admin.query("select status from categories where id = $1", [income.id]);
    expect(row.rows[0].status).toBe("inactive");
  });
});
