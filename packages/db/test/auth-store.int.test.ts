import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthStore, createAuthStore } from "../src/auth-store";
import { createDatabase, createPool } from "../src/client";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

let db: TestDatabase;
let pool: ReturnType<typeof createPool>;
let store: AuthStore;

beforeAll(async () => {
  db = await startTestDatabase();
  pool = createPool(db.urls.auth);
  store = createAuthStore(createDatabase(pool), { now: () => NOW });
});

afterAll(async () => {
  await pool?.end();
  await db?.stop();
});

async function newUser(name = "Fulano"): Promise<string> {
  const id = uuidv7();
  await db.admin.query("insert into users (id, name, email) values ($1, $2, $3)", [
    id,
    name,
    `${id}@ex.com`,
  ]);
  return id;
}

async function newCredential(userId: string, hash: string): Promise<void> {
  await db.admin.query(
    "insert into accounts (id, account_id, provider_id, user_id, password) values ($1, $2, 'credential', $3, $4)",
    [uuidv7(), userId, userId, hash],
  );
}

async function newSession(
  userId: string,
  options: { expiresAt?: Date; updatedAt?: Date; userAgent?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into sessions (id, user_id, token, expires_at, updated_at, user_agent)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      userId,
      `tok-${id}`,
      options.expiresAt ?? new Date(NOW.getTime() + HOUR),
      options.updatedAt ?? NOW,
      options.userAgent ?? null,
    ],
  );
  return id;
}

async function sessionIds(userId: string): Promise<string[]> {
  const { rows } = await db.admin.query<{ id: string }>(
    "select id from sessions where user_id = $1",
    [userId],
  );
  return rows.map((r) => r.id).sort();
}

describe("auth-store: busca por id", () => {
  it("findUserById devolve id e e-mail normalizado; id desconhecido devolve null", async () => {
    const id = uuidv7();
    await db.admin.query("insert into users (id, name, email) values ($1, 'Fulano', $2)", [
      id,
      `${id}@ex.com`,
    ]);
    expect(await store.findUserById(id)).toEqual({ id, email: `${id}@ex.com` });
    expect(await store.findUserById(uuidv7())).toBeNull();
  });
});

describe("auth-store: senha", () => {
  it("getPasswordHash devolve o hash de quem tem senha e null de quem não tem conta", async () => {
    const withPassword = await newUser();
    await newCredential(withPassword, "hash-a");
    const without = await newUser();
    expect(await store.getPasswordHash(withPassword)).toBe("hash-a");
    expect(await store.getPasswordHash(without)).toBeNull();
  });

  it("setPasswordHash troca o hash e devolve false sem conta de senha", async () => {
    const user = await newUser();
    await newCredential(user, "hash-antigo");
    const other = await newUser();
    await newCredential(other, "hash-outro");
    expect(await store.setPasswordHash(user, "hash-novo")).toBe(true);
    expect(await store.getPasswordHash(user)).toBe("hash-novo");
    expect(await store.getPasswordHash(other)).toBe("hash-outro");

    const without = await newUser();
    expect(await store.setPasswordHash(without, "x")).toBe(false);
    expect(await store.getPasswordHash(without)).toBeNull();
  });

  it("conta só de outro provedor não tem senha e não aceita troca", async () => {
    const user = await newUser();
    await db.admin.query(
      "insert into accounts (id, account_id, provider_id, user_id, password) values ($1, $2, 'google', $3, 'hash-externo')",
      [uuidv7(), user, user],
    );

    expect(await store.getPasswordHash(user)).toBeNull();
    expect(await store.setPasswordHash(user, "hash-novo")).toBe(false);
    const { rows } = await db.admin.query<{ provider_id: string; password: string }>(
      "select provider_id, password from accounts where user_id = $1",
      [user],
    );
    expect(rows).toEqual([{ provider_id: "google", password: "hash-externo" }]);
  });
});

describe("auth-store: sessões", () => {
  it("listSessions ignora vencidas e de outros usuários, mais recente primeiro, sem token", async () => {
    const user = await newUser();
    const other = await newUser();
    const old = await newSession(user, {
      updatedAt: new Date(NOW.getTime() - 2 * HOUR),
      userAgent: "velho",
    });
    const recent = await newSession(user, {
      updatedAt: new Date(NOW.getTime() - HOUR),
      userAgent: "novo",
    });
    await newSession(user, { expiresAt: new Date(NOW.getTime() - 1000) });
    await newSession(other);

    const list = await store.listSessions(user, NOW);
    expect(list.map((s) => s.id)).toEqual([recent, old]);
    expect(list[0]).toEqual({
      id: recent,
      userAgent: "novo",
      updatedAt: new Date(NOW.getTime() - HOUR),
    });
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(["id", "updatedAt", "userAgent"]);
  });

  it("listSessions deixa de fora a sessão que vence exatamente em now", async () => {
    const user = await newUser();
    const valid = await newSession(user);
    await newSession(user, { expiresAt: NOW });

    const list = await store.listSessions(user, NOW);
    expect(list.map((s) => s.id)).toEqual([valid]);
  });

  it("deleteSessionsExcept apaga todas as do usuário quando a sessão mantida é de outro", async () => {
    const user = await newUser();
    const other = await newUser();
    await newSession(user);
    await newSession(user);
    const otherSession = await newSession(other);

    expect(await store.deleteSessionsExcept(user, otherSession)).toBe(2);
    expect(await sessionIds(user)).toEqual([]);
    expect(await sessionIds(other)).toEqual([otherSession]);
  });

  it("deleteSessionsExcept mantém a sessão indicada e não toca em outro usuário", async () => {
    const user = await newUser();
    const other = await newUser();
    const keep = await newSession(user);
    await newSession(user);
    await newSession(user);
    const otherSession = await newSession(other);

    expect(await store.deleteSessionsExcept(user, keep)).toBe(2);
    expect(await sessionIds(user)).toEqual([keep]);
    expect(await sessionIds(other)).toEqual([otherSession]);
  });

  it("deleteResetTokens apaga só os links de recuperação do usuário (DD-30)", async () => {
    const user = await newUser();
    const other = await newUser();
    const insert = (identifier: string, value: string) =>
      db.admin.query(
        "insert into verifications (id, identifier, value, expires_at) values ($1, $2, $3, $4)",
        [uuidv7(), identifier, value, new Date(NOW.getTime() + HOUR)],
      );
    await insert("reset-password:tokA1", user);
    await insert("reset-password:tokA2", user);
    await insert("reset-password:tokB1", other);
    await insert(`sign-in-otp-${user}@ex.com`, user);

    expect(await store.deleteResetTokens(user)).toBe(2);
    const left = await db.admin.query(
      "select identifier from verifications where value in ($1, $2) order by identifier",
      [user, other],
    );
    expect(left.rows.map((r: { identifier: string }) => r.identifier)).toEqual([
      "reset-password:tokB1",
      `sign-in-otp-${user}@ex.com`,
    ]);
  });

  it("deleteSessionsExcept com null apaga todas as sessões do usuário", async () => {
    const user = await newUser();
    const other = await newUser();
    await newSession(user);
    await newSession(user);
    const otherSession = await newSession(other);

    expect(await store.deleteSessionsExcept(user, null)).toBe(2);
    expect(await sessionIds(user)).toEqual([]);
    expect(await sessionIds(other)).toEqual([otherSession]);
  });
});

describe("auth-store: perfil e auditoria", () => {
  it("updateUserName troca só o nome do usuário", async () => {
    const user = await newUser("Antes");
    const other = await newUser("Outro");
    await store.updateUserName(user, "Depois");
    const { rows } = await db.admin.query<{ name: string }>(
      "select name from users where id = any($1) order by name",
      [[user, other]],
    );
    expect(rows.map((r) => r.name)).toEqual(["Depois", "Outro"]);
  });

  it("recordAudit aceita os eventos de senha, sessões e nome", async () => {
    const user = await newUser();
    for (const event of [
      "password_reset",
      "password_changed",
      "password_set",
      "other_sessions_revoked",
      "name_changed",
    ] as const) {
      await store.recordAudit({ event, userId: user });
    }
    const { rows } = await db.admin.query<{ event: string }>(
      "select event from auth_audit where user_id = $1 order by event",
      [user],
    );
    expect(rows.map((r) => r.event)).toEqual([
      "name_changed",
      "other_sessions_revoked",
      "password_changed",
      "password_reset",
      "password_set",
    ]);
  });
});
