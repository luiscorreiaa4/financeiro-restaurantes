import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCatalogSettingsRepo } from "../src/catalog-settings-repo";
import { createDatabase } from "../src/client";
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

const repo = () => createCatalogSettingsRepo(createDatabase(db.app));

const card = (name: string, type: "credit" | "debit" = "credit", isDefaultCard = false) => ({
  name,
  type,
  feePercentBp: 320,
  feeFixedCents: 0,
  aliases: [],
  status: "active" as const,
  isDefaultCard,
});

const channel = (name: string) => ({
  name,
  type: "app" as const,
  feePercentBp: 1200,
  aliases: [],
  status: "active" as const,
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown } | null): T {
  if (!result?.ok) throw new Error(`esperava ok, veio ${JSON.stringify(result)}`);
  return result.value;
}

describe("CatalogSettingsRepo: formas de pagamento (RF08)", () => {
  it("cria, lista com filtros e marca o protegido pelo nome", async () => {
    const created = unwrap(await repo().createPaymentMethod(a.tenantId, a.userId, card("Visa")));
    expect(created).toMatchObject({ name: "Visa", protected: false, feePercentBp: 320 });
    await db.admin.query(
      "insert into payment_methods (id, tenant_id, name, type) values ($1, $2, 'Não informada', 'other')",
      [uuidv7(), a.tenantId],
    );
    const all = await repo().listPaymentMethods(a.tenantId, {});
    expect(all.find((m) => m.name === "Não informada")?.protected).toBe(true);
    expect(all.find((m) => m.name === "Visa")?.protected).toBe(false);
    const credit = await repo().listPaymentMethods(a.tenantId, { type: "credit" });
    expect(credit.map((m) => m.name)).toEqual(["Visa"]);
    const inactive = await repo().listPaymentMethods(a.tenantId, { status: "inactive" });
    expect(inactive).toEqual([]);
    const audit = await db.admin.query(
      "select metadata from audit_log where tenant_id = $1 and action = 'payment_method.create' and target = $2",
      [a.tenantId, created.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("A não vê nem altera forma de B (id de B devolve null)", async () => {
    expect((await repo().listPaymentMethods(a.tenantId, {})).map((m) => m.id)).not.toContain(
      b.paymentMethodId,
    );
    const result = await repo().updatePaymentMethod(a.tenantId, a.userId, b.paymentMethodId, {
      name: "Invadida",
    });
    expect(result).toBeNull();
    const row = await db.admin.query("select name from payment_methods where id = $1", [
      b.paymentMethodId,
    ]);
    expect(row.rows[0].name).toBe("Pix");
  });

  it("auditoria guarda before e after só do que mudou", async () => {
    const created = unwrap(await repo().createPaymentMethod(a.tenantId, a.userId, card("Elo")));
    const updated = unwrap(
      await repo().updatePaymentMethod(a.tenantId, a.userId, created.id, {
        feePercentBp: 450,
        name: "Elo",
      }),
    );
    expect(updated.feePercentBp).toBe(450);
    const audit = await db.admin.query(
      "select actor_id, metadata from audit_log where tenant_id = $1 and action = 'payment_method.update' and target = $2",
      [a.tenantId, created.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(a.userId);
    expect(audit.rows[0].metadata).toEqual({
      before: { feePercentBp: 320 },
      after: { feePercentBp: 450 },
    });
  });

  it("nome repetido vira NameTaken (validador e índice único)", async () => {
    unwrap(await repo().createPaymentMethod(a.tenantId, a.userId, card("Hiper")));
    const dup = await repo().createPaymentMethod(a.tenantId, a.userId, card("hiper"));
    expect(dup).toMatchObject({ ok: false, error: { code: "NameTaken" } });
  });

  it("23505 do índice de nome (corrida) vira NameTaken e outro 23505 não é engolido", async () => {
    const same = card("Corrida");
    const results = await Promise.all([
      repo().createPaymentMethod(a.tenantId, a.userId, same),
      repo().createPaymentMethod(a.tenantId, a.userId, same),
    ]);
    const oks = results.filter((r) => r.ok);
    const taken = results.filter((r) => !r.ok && r.error.code === "NameTaken");
    expect(oks).toHaveLength(1);
    expect(taken).toHaveLength(1);
  });

  it("editar 'Não informada' vira SystemCatalogReadOnly", async () => {
    const row = await db.admin.query(
      "select id from payment_methods where tenant_id = $1 and name = 'Não informada'",
      [a.tenantId],
    );
    const result = await repo().updatePaymentMethod(a.tenantId, a.userId, row.rows[0].id, {
      feePercentBp: 100,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "SystemCatalogReadOnly" } });
  });

  it("cartão padrão novo desmarca o anterior na mesma transação", async () => {
    const t = await createTenant(db.admin, "Cartão");
    const first = unwrap(
      await repo().createPaymentMethod(t.tenantId, t.userId, card("C1", "credit", true)),
    );
    const second = unwrap(
      await repo().createPaymentMethod(t.tenantId, t.userId, card("C2", "debit", true)),
    );
    const rows = await repo().listPaymentMethods(t.tenantId, {});
    expect(rows.filter((m) => m.isDefaultCard).map((m) => m.id)).toEqual([second.id]);
    expect(rows.find((m) => m.id === first.id)?.isDefaultCard).toBe(false);
  });

  it("desmarcar o cartão padrão sem escolher outro é recusado (DefaultCardInactive)", async () => {
    const t = await createTenant(db.admin, "Desmarcar");
    const only = unwrap(
      await repo().createPaymentMethod(t.tenantId, t.userId, card("Padrão", "credit", true)),
    );
    const result = await repo().updatePaymentMethod(t.tenantId, t.userId, only.id, {
      isDefaultCard: false,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "DefaultCardInactive" } });
    const rows = await repo().listPaymentMethods(t.tenantId, {});
    expect(rows.find((m) => m.id === only.id)?.isDefaultCard).toBe(true);
    // Marcar OUTRA continua desmarcando a anterior.
    const other = unwrap(await repo().createPaymentMethod(t.tenantId, t.userId, card("Outra")));
    expect(
      (await repo().updatePaymentMethod(t.tenantId, t.userId, other.id, { isDefaultCard: true }))
        ?.ok,
    ).toBe(true);
    const after = await repo().listPaymentMethods(t.tenantId, {});
    expect(after.filter((m) => m.isDefaultCard).map((m) => m.id)).toEqual([other.id]);
  });

  it("cartão padrão só crédito ou débito e ativo", async () => {
    const t = await createTenant(db.admin, "Cartão inválido");
    const pix = await repo().createPaymentMethod(t.tenantId, t.userId, {
      ...card("Vale", "credit", true),
      type: "voucher",
    });
    expect(pix).toMatchObject({ ok: false, error: { code: "DefaultCardType" } });
  });

  it("duas atualizações em paralelo marcando cartão padrão deixam exatamente um", async () => {
    const t = await createTenant(db.admin, "Paralelo");
    const x = unwrap(await repo().createPaymentMethod(t.tenantId, t.userId, card("Cartao X")));
    const y = unwrap(
      await repo().createPaymentMethod(t.tenantId, t.userId, card("Cartao Y", "debit")),
    );
    const results = await Promise.all([
      repo().updatePaymentMethod(t.tenantId, t.userId, x.id, { isDefaultCard: true }),
      repo().updatePaymentMethod(t.tenantId, t.userId, y.id, { isDefaultCard: true }),
    ]);
    expect(results.every((r) => r?.ok === true)).toBe(true);
    const rows = await db.admin.query(
      "select id from payment_methods where tenant_id = $1 and is_default_card",
      [t.tenantId],
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("CatalogSettingsRepo: canais de venda (RF09)", () => {
  it("cria, lista e isola por empresa", async () => {
    const created = unwrap(await repo().createSalesChannel(a.tenantId, a.userId, channel("iFood")));
    expect(created).toMatchObject({ name: "iFood", protected: false });
    expect((await repo().listSalesChannels(b.tenantId, {})).map((c) => c.name)).not.toContain(
      "iFood",
    );
    expect(
      await repo().updateSalesChannel(b.tenantId, b.userId, created.id, { feePercentBp: 1 }),
    ).toBeNull();
    const audit = await db.admin.query(
      "select 1 from audit_log where tenant_id = $1 and action = 'sales_channel.create'",
      [a.tenantId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("inativar canal que é padrão de unidade é recusado", async () => {
    const created = unwrap(await repo().createSalesChannel(a.tenantId, a.userId, channel("Rappi")));
    await db.admin.query("update units set default_sales_channel_id = $1 where id = $2", [
      created.id,
      a.unitId,
    ]);
    const result = await repo().updateSalesChannel(a.tenantId, a.userId, created.id, {
      status: "inactive",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "ChannelIsUnitDefault" } });
    const row = await db.admin.query("select status from sales_channels where id = $1", [
      created.id,
    ]);
    expect(row.rows[0].status).toBe("active");
  });

  it("nome repetido e 'Não informado' protegido", async () => {
    unwrap(await repo().createSalesChannel(a.tenantId, a.userId, channel("Uber")));
    expect(await repo().createSalesChannel(a.tenantId, a.userId, channel("uber"))).toMatchObject({
      ok: false,
      error: { code: "NameTaken" },
    });
    const sys = uuidv7();
    await db.admin.query(
      "insert into sales_channels (id, tenant_id, name, type) values ($1, $2, 'Não informado', 'other')",
      [sys, a.tenantId],
    );
    expect(
      await repo().updateSalesChannel(a.tenantId, a.userId, sys, { feePercentBp: 5 }),
    ).toMatchObject({ ok: false, error: { code: "SystemCatalogReadOnly" } });
    const listed = await repo().listSalesChannels(a.tenantId, {});
    expect(listed.find((c) => c.id === sys)?.protected).toBe(true);
  });
});
