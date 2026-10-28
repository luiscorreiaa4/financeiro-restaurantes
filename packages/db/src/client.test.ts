import { describe, expect, it } from "vitest";
import { createDatabase, createPool, InvalidTenantIdError, withTenant } from "./client";

describe("withTenant", () => {
  // A validação acontece antes de qualquer acesso ao banco: o pool nunca conecta.
  const pool = createPool("postgres://nobody:none@127.0.0.1:1/none");
  const db = createDatabase(pool);

  it.each([
    ["vazio", ""],
    ["texto qualquer", "abc"],
    ["tentativa de injeção", "'; drop table entries; --"],
    ["uuid com caractere extra", "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5bz"],
  ])("rejeita tenantId inválido (%s) sem tocar no banco", async (_nome, tenantId) => {
    await expect(withTenant(db, tenantId, async () => "nunca")).rejects.toBeInstanceOf(
      InvalidTenantIdError,
    );
  });
});
