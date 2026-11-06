import { resolveSender } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { DEV_PHONES, DevSeedInProductionError, seedDevData } from "../src/dev-seed";
import { createSenderDirectory } from "../src/sender-directory";
import { startTestDatabase, type TestDatabase } from "./database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe("seed de desenvolvimento", () => {
  it("recusa rodar em produção, sem gravar nada", async () => {
    await expect(seedDevData(createDatabase(db.admin), "production")).rejects.toBeInstanceOf(
      DevSeedInProductionError,
    );
    const { rows } = await db.admin.query("select count(*)::int as n from tenants");
    expect(rows[0].n).toBe(0);
  });

  it("pode rodar mais de uma vez sem duplicar", async () => {
    await seedDevData(createDatabase(db.admin), "development");
    await seedDevData(createDatabase(db.admin), "development");
    const { rows } = await db.admin.query(
      "select (select count(*)::int from tenants) as tenants, (select count(*)::int from memberships) as memberships",
    );
    expect(rows[0]).toEqual({ tenants: 2, memberships: 6 });
    const links = await db.admin.query("select count(*)::int as n from membership_units");
    expect(links.rows[0].n).toBe(4);
  });

  it("grava cadastros de apoio completos: tipos, cartão padrão, 'Não informado' e canal padrão", async () => {
    await seedDevData(createDatabase(db.admin), "development");
    const { rows } = await db.admin.query(
      `select
         (select count(*)::int from payment_methods where name = 'Não informada') as no_method,
         (select count(*)::int from sales_channels where name = 'Não informado') as no_channel,
         (select count(*)::int from payment_methods where is_default_card and type = 'credit') as card,
         (select count(*)::int from sales_channels where type = 'app' and name = 'iFood') as app,
         (select count(*)::int from units where default_sales_channel_id is not null and city is not null and uf is not null) as units_ready,
         (select count(*)::int from units) as units`,
    );
    expect(rows[0]).toEqual({
      no_method: 2,
      no_channel: 2,
      card: 2,
      app: 2,
      units_ready: 3,
      units: 3,
    });
  });

  it("cada telefone cai no caso de teste prometido", async () => {
    const directory = createSenderDirectory(createDatabase(db.ingest));
    const resolve = async (phone: string) =>
      resolveSender(await directory.findMemberships([phone]));

    const owner = await resolve(DEV_PHONES.owner);
    expect(owner).toMatchObject({ kind: "known", defaultUnitId: expect.any(String) });
    if (owner.kind === "known") expect(owner.sender.role).toBe("owner");

    const manager = await resolve(DEV_PHONES.manager);
    expect(manager).toMatchObject({ kind: "known" });
    if (manager.kind === "known") {
      expect(manager.sender.role).toBe("manager");
      expect(manager.sender.allUnits).toBe(false);
      expect(manager.sender.unitIds).toHaveLength(2);
    }
    const staff = await resolve(DEV_PHONES.staff);
    expect(staff).toMatchObject({ kind: "known" });
    if (staff.kind === "known") {
      expect(staff.sender.role).toBe("staff");
      expect(staff.sender.unitIds).toHaveLength(1);
    }

    const two = await resolve(DEV_PHONES.twoRestaurants);
    expect(two).toMatchObject({ kind: "known", tenantCount: 2 });
    if (two.kind === "known") expect(two.sender.tenantName).toBe("Restaurante Demo");

    expect(await resolve(DEV_PHONES.deactivated)).toEqual({ kind: "unknown" });
  });
});
