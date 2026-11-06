import { isUuidV7 } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { migrateAll, migrateUpTo } from "./staged-migrations";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe("migração das unidades de acesso (RF05.R5, R6, R8; DN-07)", () => {
  it("cada colaborador mantém exatamente as unidades que tinha", async () => {
    const legacy = await db.createEmptyDatabase("legacy_access");
    await migrateUpTo(legacy, "0005_fiscal_documents");

    const tenantId = uuidv7();
    const unitCentro = uuidv7();
    const unitPraia = uuidv7();
    const owner = uuidv7();
    const manager = uuidv7();
    const gone = uuidv7();
    const memberOwner = uuidv7();
    const memberManager = uuidv7();
    const memberGone = uuidv7();

    await legacy.query("insert into tenants (id, name) values ($1, 'Legado')", [tenantId]);
    for (const [id, name] of [
      [unitCentro, "Centro"],
      [unitPraia, "Praia"],
    ]) {
      await legacy.query("insert into units (id, tenant_id, name) values ($1, $2, $3)", [
        id,
        tenantId,
        name,
      ]);
    }
    for (const [id, name, phone] of [
      [owner, "Dono", "+5511900000001"],
      [manager, "Gerente", "+5511900000002"],
      [gone, "Saiu", "+5511900000003"],
    ]) {
      await legacy.query("insert into users (id, name, phone_e164) values ($1, $2, $3)", [
        id,
        name,
        phone,
      ]);
    }
    await legacy.query(
      "insert into memberships (id, tenant_id, user_id, unit_id, role) values ($1, $2, $3, null, 'owner')",
      [memberOwner, tenantId, owner],
    );
    await legacy.query(
      "insert into memberships (id, tenant_id, user_id, unit_id, role) values ($1, $2, $3, $4, 'manager')",
      [memberManager, tenantId, manager, unitPraia],
    );
    await legacy.query(
      `insert into memberships (id, tenant_id, user_id, unit_id, role, deactivated_at)
       values ($1, $2, $3, $4, 'staff', now())`,
      [memberGone, tenantId, gone, unitCentro],
    );

    await migrateAll(legacy);

    const { rows } = await legacy.query<{
      id: string;
      all_units: boolean;
      default_unit_id: string | null;
      status: string;
    }>("select id, all_units, default_unit_id, status from memberships");
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(memberOwner)).toMatchObject({
      all_units: true,
      default_unit_id: null,
      status: "active",
    });
    expect(byId.get(memberManager)).toMatchObject({
      all_units: false,
      default_unit_id: unitPraia,
      status: "active",
    });
    expect(byId.get(memberGone)).toMatchObject({
      all_units: false,
      default_unit_id: unitCentro,
      status: "deactivated",
    });

    const links = await legacy.query<{ id: string; membership_id: string; unit_id: string }>(
      "select id, membership_id, unit_id from membership_units order by membership_id",
    );
    for (const link of links.rows) expect(isUuidV7(link.id)).toBe(true);
    const pairs = links.rows.map((row) => `${row.membership_id}:${row.unit_id}`).sort();
    expect(pairs).toEqual([`${memberManager}:${unitPraia}`, `${memberGone}:${unitCentro}`].sort());

    const columns = await legacy.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'memberships' and column_name = 'unit_id'`,
    );
    expect(columns.rows).toHaveLength(0);
  });
});
