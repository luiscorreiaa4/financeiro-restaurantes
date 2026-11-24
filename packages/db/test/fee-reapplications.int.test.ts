import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid";
import { asTenant, startTestDatabase, type TestDatabase } from "./database";
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

const INSERT = `insert into fee_reapplications
  (id, tenant_id, target_kind, target_id, from_date, to_date, fee_percent_bp, fee_fixed_cents, status, created_by, client_request_id)
  values ($1, $2, $3, $4, $5, $6, 320, 0, $7, $8, $9)`;

interface Opts {
  kind?: string;
  target?: string;
  from?: string;
  to?: string;
  status?: string;
  crid?: string | null;
  by?: string;
}

function insert(f: TenantFixture, o: Opts = {}) {
  return db.admin.query(INSERT, [
    uuidv7(),
    f.tenantId,
    o.kind ?? "payment_method",
    o.target ?? uuidv7(),
    o.from ?? "2026-10-01",
    o.to ?? "2026-10-31",
    o.status ?? "done",
    o.by ?? f.userId,
    o.crid ?? null,
  ]);
}

describe("fee_reapplications", () => {
  it("CHECK: período invertido, acima de 366 dias, status e alvo inválidos são recusados", async () => {
    await expect(insert(a, { from: "2026-10-31", to: "2026-10-01" })).rejects.toThrow(
      /fee_reapplications_period_check/,
    );
    await expect(insert(a, { from: "2025-01-01", to: "2026-01-03" })).rejects.toThrow(
      /fee_reapplications_period_max_check/,
    );
    await expect(insert(a, { status: "weird" })).rejects.toThrow(/status_check/);
    await expect(insert(a, { kind: "supplier" })).rejects.toThrow(/target_kind_check/);
  });

  it("CHECK: percentual acima de 10000 bp e taxa fixa negativa são recusados", async () => {
    const base = (bp: number, fixed: number) =>
      db.admin.query(
        `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date, fee_percent_bp, fee_fixed_cents, status, created_by)
         values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', $4, $5, 'done', $6)`,
        [uuidv7(), a.tenantId, uuidv7(), bp, fixed, a.userId],
      );
    await expect(base(10001, 0)).rejects.toThrow(/fee_reapplications_fee_check/);
    await expect(base(100, -1)).rejects.toThrow(/fee_reapplications_fee_check/);
    await expect(base(10000, 0)).resolves.toBeDefined();
  });

  it("período de exatamente 366 dias é aceito", async () => {
    await expect(insert(a, { from: "2025-01-01", to: "2026-01-02" })).resolves.toBeDefined();
  });

  it("único parcial: um só job ativo por alvo; concluído libera", async () => {
    const target = uuidv7();
    await insert(a, { target, status: "queued" });
    await expect(insert(a, { target, status: "running" })).rejects.toThrow(
      /fee_reapplications_active_target_unique/,
    );
    await expect(insert(a, { target, status: "done" })).resolves.toBeDefined();
    await expect(insert(a, { target, status: "failed" })).resolves.toBeDefined();
    await expect(insert(a, { status: "queued" })).resolves.toBeDefined();
    await expect(insert(b, { target, status: "queued" })).resolves.toBeDefined();
  });

  it("único parcial de client_request_id: por usuário e empresa; nulos repetem", async () => {
    const crid = uuidv7();
    await insert(a, { crid });
    await expect(insert(a, { crid })).rejects.toThrow(/fee_reapplications_client_request_unique/);
    await expect(insert(b, { crid })).resolves.toBeDefined();
    const other = uuidv7();
    await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'U', $2)", [
      other,
      `+5511${String(500000000 + Math.floor(Math.random() * 1e8))}`,
    ]);
    await expect(insert(a, { crid, by: other })).resolves.toBeDefined();
    await insert(a, { crid: null });
    await expect(insert(a, { crid: null })).resolves.toBeDefined();
  });

  it("RLS: o papel app só vê e grava a própria empresa, e não apaga", async () => {
    await insert(a);
    await insert(b);
    await asTenant(db.app, a.tenantId, async (client) => {
      const rows = await client.query("select distinct tenant_id from fee_reapplications");
      expect(rows.rows.map((r) => r.tenant_id)).toEqual([a.tenantId]);
      await client.query("savepoint s");
      await expect(
        client.query(
          `insert into fee_reapplications (id, tenant_id, target_kind, target_id, from_date, to_date, fee_percent_bp, fee_fixed_cents, status, created_by)
           values ($1, $2, 'payment_method', $3, '2026-10-01', '2026-10-31', 1, 0, 'done', $4)`,
          [uuidv7(), b.tenantId, uuidv7(), a.userId],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("rollback to savepoint s");
      // UPDATE na própria empresa funciona; em linha de outra empresa não afeta nada.
      const own = await client.query(
        "update fee_reapplications set status = 'failed', error_code = 'x' where tenant_id = $1",
        [a.tenantId],
      );
      expect(own.rowCount).toBeGreaterThan(0);
      const cross = await client.query(
        "update fee_reapplications set status = 'failed' where tenant_id = $1",
        [b.tenantId],
      );
      expect(cross.rowCount).toBe(0);
      await expect(client.query("delete from fee_reapplications")).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
