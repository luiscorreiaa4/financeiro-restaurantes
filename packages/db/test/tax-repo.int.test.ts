import { estimateTax } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createTaxRepo } from "../src/tax-repo";
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

const repo = () => createTaxRepo(createDatabase(db.app));

describe("TaxRepo: configuração por empresa (RF39.R1, R2, R8)", () => {
  it("empresa nova não tem a opção ligada (RF39.CA01)", async () => {
    const t = await createTenant(db.admin, "Sem imposto");
    await db.admin.query("delete from tax_settings where tenant_id = $1", [t.tenantId]);
    expect(await repo().loadSettings(t.tenantId)).toEqual({ enabled: false, periods: [] });
  });

  it("grava o regime e os parâmetros e registra na auditoria quem, quando e antes/depois", async () => {
    const saved = await repo().saveSettings(a.tenantId, a.userId, {
      validFrom: "2027-01-01",
      enabled: true,
      regime: "lucro_presumido",
      params: {},
    });
    expect(saved).toEqual({ ok: true, value: true });

    const loaded = await repo().loadSettings(a.tenantId);
    expect(loaded.enabled).toBe(true);
    expect(loaded.periods.map((period) => period.regime)).toEqual([
      "simples_nacional",
      "lucro_presumido",
    ]);

    const audit = await db.admin.query(
      "select actor_id, action, metadata from audit_log where tenant_id = $1 and action = 'tax_settings_changed'",
      [a.tenantId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_id: a.userId,
      metadata: {
        validFrom: "2027-01-01",
        before: null,
        after: { enabled: true, regime: "lucro_presumido", params: {} },
      },
    });
  });

  it("alterar parâmetros do mesmo período atualiza a linha e guarda o antes e o depois", async () => {
    await repo().saveSettings(a.tenantId, a.userId, {
      validFrom: "2026-01-01",
      enabled: true,
      regime: "simples_nacional",
      params: { rbt12Cents: 30_000_000 },
    });
    const audit = await db.admin.query(
      `select metadata from audit_log
        where tenant_id = $1 and action = 'tax_settings_changed' and metadata->>'validFrom' = '2026-01-01'`,
      [a.tenantId],
    );
    expect(audit.rows[0].metadata).toMatchObject({
      before: { enabled: true, regime: "simples_nacional", params: { rbt12Cents: 24_000_000 } },
      after: { enabled: true, regime: "simples_nacional", params: { rbt12Cents: 30_000_000 } },
    });
    const rows = await db.admin.query(
      "select count(*)::int as n from tax_settings where tenant_id = $1 and valid_from = '2026-01-01'",
      [a.tenantId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("'não sei' não permite ativar e nada é gravado", async () => {
    const before = await db.admin.query(
      "select count(*)::int as n from tax_settings where tenant_id = $1",
      [b.tenantId],
    );
    const result = await repo().saveSettings(b.tenantId, b.userId, {
      validFrom: "2028-01-01",
      enabled: true,
      regime: "not_sure",
      params: {},
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "TaxSettingsInvalid", reason: "regime_required" },
    });
    const after = await db.admin.query(
      "select count(*)::int as n from tax_settings where tenant_id = $1",
      [b.tenantId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("desligar a opção esconde os valores sem apagar a configuração", async () => {
    await repo().saveSettings(b.tenantId, b.userId, {
      validFrom: "2028-06-01",
      enabled: false,
      regime: "simples_nacional",
      params: { rbt12Cents: 24_000_000 },
    });
    const loaded = await repo().loadSettings(b.tenantId);
    expect(loaded.enabled).toBe(false);
    expect(loaded.periods.length).toBeGreaterThan(0);
  });
});

describe("TaxRepo: regras versionadas e cálculo de ponta a ponta (RF39.CA02, CA03)", () => {
  it("lê as regras do sistema e o cálculo bate com a conta independente", async () => {
    await db.admin.query(
      `insert into tax_rules (id, regime, valid_from, components)
       values ('0190a000-0000-7000-8000-0000000000f1', 'simples_nacional', '2020-01-01',
         '[{"label":"DAS","formula":{"kind":"simples_brackets","brackets":[
            {"upToCents":18000000,"nominalBp":400,"deductionCents":0},
            {"upToCents":36000000,"nominalBp":730,"deductionCents":594000}]}}]')
       on conflict (regime, valid_from) do nothing`,
    );
    const t = await createTenant(db.admin, "Simples");
    const settings = await repo().loadSettings(t.tenantId);
    const rules = await repo().loadRules(t.tenantId);
    const estimate = estimateTax({
      enabled: settings.enabled,
      month: "2026-11",
      revenueCents: 2_000_000,
      settings: settings.periods,
      rules,
    });
    // RBT12 R$ 240.000 → 4,825% de R$ 20.000 = R$ 965,00.
    expect(estimate).toMatchObject({ ok: true, value: { totalCents: 96_500 } });
  });
});
