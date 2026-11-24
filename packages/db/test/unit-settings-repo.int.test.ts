import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createUnitSettingsRepo } from "../src/unit-settings-repo";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
});

afterAll(async () => {
  await db?.stop();
});

const repo = () => createUnitSettingsRepo(createDatabase(db.app));

const unit = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  aliases: [],
  cnpj: null,
  uf: "AL" as const,
  city: "Maceió",
  timezone: "America/Sao_Paulo",
  status: "active" as const,
  defaultSalesChannelId: null,
  ...overrides,
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown } | null): T {
  if (!result?.ok) throw new Error(`esperava ok, veio ${JSON.stringify(result)}`);
  return result.value;
}

async function newTenant(name: string) {
  return createTenant(db.admin, name);
}

describe("UnitSettingsRepo: criar e listar (RF04.CA01)", () => {
  it("cria com apelidos, guarda o CNPJ só em dígitos e grava a auditoria", async () => {
    const created = unwrap(
      await repo().create(
        a.tenantId,
        a.userId,
        unit("Praia", { aliases: ["litoral", "loja 2"], cnpj: "11.222.333/0001-81" }),
      ),
    );
    expect(created).toMatchObject({
      name: "Praia",
      aliases: ["litoral", "loja 2"],
      cnpj: "11222333000181",
      status: "active",
      onlyUnitMemberCount: 0,
    });
    const audit = await db.admin.query(
      "select actor_id, metadata from audit_log where tenant_id = $1 and action = 'unit.create' and target = $2",
      [a.tenantId, created.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(a.userId);
    expect(audit.rows[0].metadata.after).toMatchObject({ name: "Praia", cnpj: "11222333000181" });
    expect(audit.rows[0].metadata.after).not.toHaveProperty("id");
    const listed = await repo().list(a.tenantId);
    expect(listed.map((u) => u.name)).toContain("Praia");
  });

  it("a outra empresa não vê a unidade criada", async () => {
    unwrap(await repo().create(a.tenantId, a.userId, unit("Só da A")));
    expect((await repo().list(b.tenantId)).map((u) => u.name)).not.toContain("Só da A");
  });

  it("nome repetido (sem diferenciar acento e caixa) e apelido igual a nome de outra unidade são recusados", async () => {
    unwrap(await repo().create(a.tenantId, a.userId, unit("Centro Histórico")));
    expect(await repo().create(a.tenantId, a.userId, unit("centro historico"))).toMatchObject({
      ok: false,
      error: { code: "InvalidUnit", field: "name", reason: "duplicate" },
    });
    expect(
      await repo().create(a.tenantId, a.userId, unit("Outra", { aliases: ["Centro Histórico"] })),
    ).toMatchObject({
      ok: false,
      error: { code: "InvalidUnit", field: "aliases", reason: "duplicate" },
    });
  });

  it("23505 do índice de nome (corrida) vira nome duplicado", async () => {
    const t = await newTenant("Corrida de nome");
    const results = await Promise.all([
      repo().create(t.tenantId, t.userId, unit("Mesma")),
      repo().create(t.tenantId, t.userId, unit("Mesma")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([
      { error: { code: "InvalidUnit", field: "name", reason: "duplicate" } },
    ]);
  });

  it("fuso inválido, UF e município fora da lista oficial são recusados", async () => {
    expect(
      await repo().create(a.tenantId, a.userId, unit("Fuso", { timezone: "Marte/Olympus" })),
    ).toMatchObject({ ok: false, error: { code: "InvalidUnit", field: "timezone" } });
    expect(
      await repo().create(a.tenantId, a.userId, unit("Cidade", { city: "Cidade Inexistente" })),
    ).toMatchObject({ ok: false, error: { code: "InvalidUnit", field: "city" } });
  });

  it("unidade nova aparece para quem tem TODAS (all_units) sem mexer em membership_units", async () => {
    const created = unwrap(await repo().create(a.tenantId, a.userId, unit("Para todas")));
    const rows = await db.admin.query(
      "select 1 from membership_units where tenant_id = $1 and unit_id = $2",
      [a.tenantId, created.id],
    );
    expect(rows.rows).toHaveLength(0);
  });
});

describe("UnitSettingsRepo: canal padrão (RF04.R6)", () => {
  it("aceita canal ativo da própria empresa", async () => {
    const created = unwrap(
      await repo().create(
        a.tenantId,
        a.userId,
        unit("Com canal", { defaultSalesChannelId: a.salesChannelId }),
      ),
    );
    expect(created.defaultSalesChannelId).toBe(a.salesChannelId);
  });

  it("canal de outra empresa vira UnknownReference e nada é gravado", async () => {
    const result = await repo().create(
      a.tenantId,
      a.userId,
      unit("Canal alheio", { defaultSalesChannelId: b.salesChannelId }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "UnknownReference", field: "sales_channel" },
    });
    const rows = await db.admin.query("select 1 from units where name = 'Canal alheio'");
    expect(rows.rows).toHaveLength(0);
  });

  it("canal inativo e 'Não informado' são recusados", async () => {
    const t = await newTenant("Canais");
    const inactive = uuidv7();
    const system = uuidv7();
    await db.admin.query(
      "insert into sales_channels (id, tenant_id, name, type, status) values ($1, $2, 'Antigo', 'other', 'inactive')",
      [inactive, t.tenantId],
    );
    await db.admin.query(
      "insert into sales_channels (id, tenant_id, name, type) values ($1, $2, 'Não informado', 'other')",
      [system, t.tenantId],
    );
    for (const [label, id] of [
      ["inativo", inactive],
      ["sistema", system],
    ] as const) {
      expect(
        await repo().create(
          t.tenantId,
          t.userId,
          unit(`Canal ${label}`, { defaultSalesChannelId: id }),
        ),
      ).toMatchObject({ ok: false, error: { code: "UnknownReference" } });
    }
  });

  it("PATCH com canal de outra empresa é recusado", async () => {
    const created = unwrap(await repo().create(a.tenantId, a.userId, unit("Patch canal")));
    expect(
      await repo().update(a.tenantId, a.userId, created.id, {
        defaultSalesChannelId: b.salesChannelId,
      }),
    ).toMatchObject({ ok: false, error: { code: "UnknownReference" } });
  });
});

describe("UnitSettingsRepo: editar", () => {
  it("auditoria guarda before e after só do que mudou", async () => {
    const created = unwrap(await repo().create(a.tenantId, a.userId, unit("Editável")));
    const updated = unwrap(
      await repo().update(a.tenantId, a.userId, created.id, {
        aliases: ["edit"],
        name: "Editável",
      }),
    );
    expect(updated.aliases).toEqual(["edit"]);
    const audit = await db.admin.query(
      "select metadata from audit_log where tenant_id = $1 and action = 'unit.update' and target = $2",
      [a.tenantId, created.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({
      before: { aliases: [] },
      after: { aliases: ["edit"] },
    });
  });

  it("PATCH em id de outra empresa devolve null e não altera nada", async () => {
    expect(await repo().update(a.tenantId, a.userId, b.unitId, { name: "Invadida" })).toBeNull();
    const row = await db.admin.query("select name from units where id = $1", [b.unitId]);
    expect(row.rows[0].name).toBe("Matriz");
  });

  it("apelido novo igual a nome de outra unidade é recusado; a própria unidade pode manter o nome", async () => {
    const x = unwrap(await repo().create(a.tenantId, a.userId, unit("Unidade X")));
    unwrap(await repo().create(a.tenantId, a.userId, unit("Unidade Y")));
    expect(
      await repo().update(a.tenantId, a.userId, x.id, { aliases: ["unidade y"] }),
    ).toMatchObject({ ok: false, error: { code: "InvalidUnit", field: "aliases" } });
    expect(await repo().update(a.tenantId, a.userId, x.id, { name: "Unidade X" })).toMatchObject({
      ok: true,
    });
  });

  it("trocar fuso e canal padrão não altera a data dos lançamentos existentes", async () => {
    const t = await newTenant("Fuso");
    const before = await db.admin.query(
      "select occurred_on::text as d from entries where id = $1",
      [t.entryId],
    );
    unwrap(
      await repo().update(t.tenantId, t.userId, t.unitId, {
        timezone: "America/Manaus",
        defaultSalesChannelId: t.salesChannelId,
      }),
    );
    const after = await db.admin.query("select occurred_on::text as d from entries where id = $1", [
      t.entryId,
    ]);
    expect(after.rows[0].d).toBe(before.rows[0].d);
    const row = await db.admin.query("select timezone from units where id = $1", [t.unitId]);
    expect(row.rows[0].timezone).toBe("America/Manaus");
  });

  it("unidade antiga sem cidade e UF edita só o apelido sem exigir endereço", async () => {
    const t = await newTenant("Legado");
    const result = await repo().update(t.tenantId, t.userId, t.unitId, { aliases: ["sede"] });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("UnitSettingsRepo: inativar e reativar (RF04.R5, CA02)", () => {
  it("a última unidade ativa não pode ser inativada", async () => {
    const t = await newTenant("Uma só");
    expect(await repo().deactivate(t.tenantId, t.userId, t.unitId)).toMatchObject({
      ok: false,
      error: { code: "LastActiveUnit" },
    });
    const row = await db.admin.query("select status from units where id = $1", [t.unitId]);
    expect(row.rows[0].status).toBe("active");
  });

  it("inativa quando há outra ativa, reativa sempre e audita as duas ações", async () => {
    const t = await newTenant("Duas");
    const second = unwrap(await repo().create(t.tenantId, t.userId, unit("Segunda")));
    const off = unwrap(await repo().deactivate(t.tenantId, t.userId, second.id));
    expect(off.status).toBe("inactive");
    const on = unwrap(await repo().reactivate(t.tenantId, t.userId, second.id));
    expect(on.status).toBe("active");
    const audit = await db.admin.query(
      "select action, metadata from audit_log where tenant_id = $1 and target = $2 and action in ('unit.deactivate', 'unit.reactivate') order by created_at",
      [t.tenantId, second.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["unit.deactivate", "unit.reactivate"]);
    expect(audit.rows[0].metadata).toEqual({
      before: { status: "active" },
      after: { status: "inactive" },
    });
  });

  it("duas inativações paralelas das duas últimas ativas: uma é recusada", async () => {
    const t = await newTenant("Paralelo");
    const second = unwrap(await repo().create(t.tenantId, t.userId, unit("Segunda")));
    const results = await Promise.all([
      repo().deactivate(t.tenantId, t.userId, t.unitId),
      repo().deactivate(t.tenantId, t.userId, second.id),
    ]);
    expect(results.filter((r) => r?.ok)).toHaveLength(1);
    expect(results.filter((r) => r && !r.ok)).toMatchObject([
      { error: { code: "LastActiveUnit" } },
    ]);
    const active = await db.admin.query(
      "select 1 from units where tenant_id = $1 and status = 'active'",
      [t.tenantId],
    );
    expect(active.rows).toHaveLength(1);
  });

  it("PATCH com status inactive na última ativa é recusado como a inativação direta", async () => {
    const t = await newTenant("Patch última");
    expect(
      await repo().update(t.tenantId, t.userId, t.unitId, { status: "inactive" }),
    ).toMatchObject({ ok: false, error: { code: "LastActiveUnit" } });
    const row = await db.admin.query("select status from units where id = $1", [t.unitId]);
    expect(row.rows[0].status).toBe("active");
  });

  it("PATCH vazio ou com o status atual não altera nem audita", async () => {
    const t = await newTenant("Sem mudança");
    const before = unwrap(await repo().update(t.tenantId, t.userId, t.unitId, {}));
    const same = unwrap(
      await repo().update(t.tenantId, t.userId, t.unitId, { status: "active", name: "Matriz" }),
    );
    expect(same).toEqual(before);
    const audit = await db.admin.query(
      "select 1 from audit_log where tenant_id = $1 and target = $2",
      [t.tenantId, t.unitId],
    );
    expect(audit.rows).toHaveLength(0);
  });

  it("unidade antiga sem cidade e UF volta com null na leitura", async () => {
    const t = await newTenant("Legado nulo");
    const [only] = await repo().list(t.tenantId);
    expect(only).toMatchObject({ city: null, uf: null });
  });

  it("id de outra empresa devolve null", async () => {
    expect(await repo().deactivate(a.tenantId, a.userId, b.unitId)).toBeNull();
    expect(await repo().reactivate(a.tenantId, a.userId, b.unitId)).toBeNull();
  });

  it("onlyUnitMemberCount conta colaboradores ativos sem TODAS cuja única unidade é esta", async () => {
    const t = await newTenant("Contagem");
    const second = unwrap(await repo().create(t.tenantId, t.userId, unit("Segunda")));
    const addMember = async (status: string, unitIds: string[], allUnits = false) => {
      const userId = uuidv7();
      const membershipId = uuidv7();
      await db.admin.query("insert into users (id, name) values ($1, 'Colab')", [userId]);
      await db.admin.query(
        "insert into memberships (id, tenant_id, user_id, role, all_units, status) values ($1, $2, $3, 'staff', $4, $5)",
        [membershipId, t.tenantId, userId, allUnits, status],
      );
      for (const unitId of unitIds) {
        await db.admin.query(
          "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
          [uuidv7(), t.tenantId, membershipId, unitId],
        );
      }
    };
    // A fixture já traz um gerente só da Matriz.
    await addMember("active", [second.id]);
    await addMember("active", [second.id, t.unitId]);
    await addMember("deactivated", [second.id]);
    await addMember("active", [], true);
    const listed = await repo().list(t.tenantId);
    expect(listed.find((u) => u.id === second.id)?.onlyUnitMemberCount).toBe(1);
    expect(listed.find((u) => u.id === t.unitId)?.onlyUnitMemberCount).toBe(1);
  });
});
