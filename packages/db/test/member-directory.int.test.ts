import { normalizeBrazilianPhone } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createMemberDirectory } from "../src/member-directory";
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

const directory = () => createMemberDirectory(createDatabase(db.auth));

let counter = 0;
const newPhone = () => `+55119${String(70000000 + ++counter)}`;

describe("MemberDirectory (papel app_auth)", () => {
  it("cria o usuário e o acha pelo celular e pelo e-mail normalizado", async () => {
    const phone = newPhone();
    const id = await directory().createUser({
      name: "Ana",
      phoneE164: phone,
      email: "ana.dir@exemplo.com",
    });
    expect(await directory().findUserByPhone([phone])).toEqual({
      id,
      email: "ana.dir@exemplo.com",
    });
    expect(await directory().findUserIdByEmail("  ANA.DIR@exemplo.com ")).toBe(id);
    expect(await directory().findUserIdByEmail("ninguem@exemplo.com")).toBeNull();
    expect(await directory().findUserByPhone([])).toBeNull();
    expect(await directory().findUserByPhone(["+5511900000001"])).toBeNull();
  });

  it("cria usuário sem e-mail", async () => {
    const phone = newPhone();
    const id = await directory().createUser({ name: "Beto", phoneE164: phone, email: null });
    expect(await directory().findUserByPhone([phone])).toEqual({ id, email: null });
  });

  it("Review Focus 5: celular de 8 dígitos acha o usuário gravado com o 9º dígito", async () => {
    const withNine = "+5511987654321";
    const id = await directory().createUser({ name: "Carla", phoneE164: withNine, email: null });
    const typed = normalizeBrazilianPhone("(11) 8765-4321");
    if (!typed.ok) throw new Error("celular de teste inválido");
    expect(typed.value.lookupCandidates).toContain(withNine);
    expect((await directory().findUserByPhone(typed.value.lookupCandidates))?.id).toBe(id);
  });

  it("hasMembershipElsewhere: só conta vínculo em OUTRA empresa", async () => {
    expect(await directory().hasMembershipElsewhere(a.userId, a.tenantId)).toBe(false);
    expect(await directory().hasMembershipElsewhere(a.userId, b.tenantId)).toBe(true);
    expect(await directory().hasMembershipElsewhere(uuidv7(), a.tenantId)).toBe(false);
  });

  it("updateUserContact troca celular e e-mail, e limpa o e-mail com null", async () => {
    const phone = newPhone();
    const id = await directory().createUser({ name: "Dora", phoneE164: phone, email: null });
    const next = newPhone();
    await directory().updateUserContact(id, { phoneE164: next, email: "dora@exemplo.com" });
    expect((await directory().findUserByPhone([next]))?.id).toBe(id);
    expect(await directory().findUserByPhone([phone])).toBeNull();
    expect(await directory().findUserIdByEmail("dora@exemplo.com")).toBe(id);
    await directory().updateUserContact(id, { email: null });
    expect(await directory().findUserIdByEmail("dora@exemplo.com")).toBeNull();
    // Sem campos: não faz nada.
    await directory().updateUserContact(id, {});
    expect((await directory().findUserByPhone([next]))?.id).toBe(id);
  });

  it("celular repetido é recusado pelo banco (único)", async () => {
    await expect(
      directory().createUser({ name: "Clone", phoneE164: a.phone, email: null }),
    ).rejects.toThrow();
  });

  it("app_auth só faz o que o GRANT permite: não apaga usuário nem lê lançamento", async () => {
    await expect(db.auth.query("delete from users where id = $1", [a.userId])).rejects.toThrow();
    await expect(db.auth.query("select 1 from entries limit 1")).rejects.toThrow();
  });
});
