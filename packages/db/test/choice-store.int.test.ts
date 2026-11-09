import { buildChoice } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChoiceStore } from "../src/choice-store";
import { createDatabase } from "../src/client";
import { createSenderDirectory } from "../src/sender-directory";
import { createTenantConversationRepo } from "../src/tenant-conversation-repo";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;
/** Segunda unidade do restaurante A. */
let praiaId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
  praiaId = uuidv7();
  await db.admin.query("insert into units (id, tenant_id, name) values ($1, $2, 'Praia')", [
    praiaId,
    a.tenantId,
  ]);
  // O dono de A também trabalha em B.
  await db.admin.query(
    "insert into memberships (id, tenant_id, user_id, role, all_units) values ($1, $2, $3, 'owner', true)",
    [uuidv7(), b.tenantId, a.userId],
  );
});

afterAll(async () => {
  await db?.stop();
});

const store = () => createChoiceStore(createDatabase(db.app));
const FUTURE = new Date("2099-01-01T00:00:00Z");
const NOW = new Date("2026-11-09T12:00:00Z");

async function openChoice(target: "unit" | "tenant", userId = a.userId) {
  const id = uuidv7();
  const { draft, text } = buildChoice(target, [
    { id: a.unitId, label: "Matriz" },
    { id: praiaId, label: "Praia" },
  ]);
  await store().open({
    tenantId: a.tenantId,
    userId,
    inboundMessageId: a.inboundMessageId,
    id,
    draft,
    question: text,
    expiresAt: FUTURE,
  });
  return id;
}

const questionStatus = async (id: string) =>
  (await db.admin.query("select status, kind from pending_questions where id = $1", [id]))
    .rows[0] as { status: string; kind: string };

const membership = async (tenantId: string, userId: string) =>
  (
    await db.admin.query(
      "select default_unit_id, preferred_at from memberships where tenant_id = $1 and user_id = $2",
      [tenantId, userId],
    )
  ).rows[0] as { default_unit_id: string | null; preferred_at: Date | null };

describe("ChoiceStore.open", () => {
  it("abre a pergunta de escolha e cancela a pergunta anterior em aberto", async () => {
    // O fixture já deixa uma pergunta de esclarecimento aberta para o dono.
    const { rows } = await db.admin.query(
      "select id from pending_questions where tenant_id = $1 and user_id = $2 and status = 'open'",
      [a.tenantId, a.userId],
    );
    const old = (rows[0] as { id: string }).id;
    expect(await questionStatus(old)).toEqual({ status: "open", kind: "clarify" });
    const id = await openChoice("unit");
    expect(await questionStatus(old)).toEqual({ status: "cancelled", kind: "clarify" });
    expect(await questionStatus(id)).toEqual({ status: "open", kind: "choice" });
  });

  it("a pergunta aberta aparece com o tipo choice para o roteador", async () => {
    const id = await openChoice("tenant");
    const found = await createTenantConversationRepo(createDatabase(db.app)).hasPendingQuestion({
      tenantId: a.tenantId,
      userId: a.userId,
      now: NOW,
    });
    expect(found).toBe(true);
    expect((await questionStatus(id)).kind).toBe("choice");
  });
});

describe("ChoiceStore.apply", () => {
  it("trocar unidade grava a unidade padrão do vínculo e deixa o fechamento para o chamador (DE-26)", async () => {
    const id = await openChoice("unit");
    const done = await store().apply({
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "unit",
      chosenId: praiaId,
      now: NOW,
    });
    expect(done).toBe(true);
    expect((await membership(a.tenantId, a.userId)).default_unit_id).toBe(praiaId);
    expect((await questionStatus(id)).status).toBe("open");
  });

  it("repetir a mesma resposta é inofensivo enquanto a pergunta está aberta", async () => {
    const id = await openChoice("unit");
    const input = {
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "unit" as const,
      chosenId: praiaId,
      now: NOW,
    };
    expect(await store().apply(input)).toBe(true);
    expect(await store().apply(input)).toBe(true);
    expect((await membership(a.tenantId, a.userId)).default_unit_id).toBe(praiaId);
  });

  it("não grava unidade inativa", async () => {
    const inactiveId = uuidv7();
    await db.admin.query(
      "insert into units (id, tenant_id, name, status) values ($1, $2, 'Fechada', 'inactive')",
      [inactiveId, a.tenantId],
    );
    await db.admin.query(
      "update memberships set default_unit_id = $3 where tenant_id = $1 and user_id = $2",
      [a.tenantId, a.userId, a.unitId],
    );
    const id = await openChoice("unit");
    const done = await store().apply({
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "unit",
      chosenId: inactiveId,
      now: NOW,
    });
    expect(done).toBe(false);
    expect((await membership(a.tenantId, a.userId)).default_unit_id).toBe(a.unitId);
  });

  it("não grava unidade fora das unidades de acesso do vínculo", async () => {
    const userId = uuidv7();
    const membershipId = uuidv7();
    await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Staff', $2)", [
      userId,
      "+5511955550001",
    ]);
    await db.admin.query(
      "insert into memberships (id, tenant_id, user_id, role, default_unit_id) values ($1, $2, $3, 'staff', $4)",
      [membershipId, a.tenantId, userId, a.unitId],
    );
    await db.admin.query(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), a.tenantId, membershipId, a.unitId],
    );
    const id = await openChoice("unit", userId);
    const done = await store().apply({
      tenantId: a.tenantId,
      userId,
      questionId: id,
      target: "unit",
      chosenId: praiaId,
      now: NOW,
    });
    expect(done).toBe(false);
    expect((await membership(a.tenantId, userId)).default_unit_id).toBe(a.unitId);
    expect((await questionStatus(id)).status).toBe("open");
  });

  it("não aceita unidade de outro restaurante", async () => {
    const id = await openChoice("unit");
    const done = await store().apply({
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "unit",
      chosenId: b.unitId,
      now: NOW,
    });
    expect(done).toBe(false);
    expect((await questionStatus(id)).status).toBe("open");
  });

  it("trocar empresa marca só o vínculo escolhido", async () => {
    const id = await openChoice("tenant");
    const done = await store().apply({
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "tenant",
      chosenId: b.tenantId,
      now: NOW,
    });
    expect(done).toBe(true);
    expect((await membership(b.tenantId, a.userId)).preferred_at).toEqual(NOW);
    expect((await membership(a.tenantId, a.userId)).preferred_at).toBeNull();
  });

  it("a escolha passa a valer no SenderDirectory", async () => {
    const found = await createSenderDirectory(createDatabase(db.ingest)).findMemberships([a.phone]);
    const chosen = found.find((m) => m.tenantId === b.tenantId);
    expect(chosen?.preferredAt).toEqual(NOW);
    expect(found.find((m) => m.tenantId === a.tenantId)?.preferredAt).toBeNull();
  });

  it("não grava empresa em que a pessoa não tem vínculo ativo", async () => {
    const c = await createTenant(db.admin, "Restaurante C");
    const id = await openChoice("tenant");
    const done = await store().apply({
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "tenant",
      chosenId: c.tenantId,
      now: NOW,
    });
    expect(done).toBe(false);
    expect((await questionStatus(id)).status).toBe("open");
    expect((await membership(c.tenantId, c.userId)).preferred_at).toBeNull();
  });

  it("pergunta que já foi fechada não grava nada", async () => {
    const id = await openChoice("unit");
    await db.admin.query("update pending_questions set status = 'cancelled' where id = $1", [id]);
    await db.admin.query(
      "update memberships set default_unit_id = $3 where tenant_id = $1 and user_id = $2",
      [a.tenantId, a.userId, a.unitId],
    );
    const done = await store().apply({
      tenantId: a.tenantId,
      userId: a.userId,
      questionId: id,
      target: "unit",
      chosenId: praiaId,
      now: NOW,
    });
    expect(done).toBe(false);
    expect((await membership(a.tenantId, a.userId)).default_unit_id).toBe(a.unitId);
  });

  it("nunca mexe no vínculo de outra pessoa", async () => {
    const other = await membership(a.tenantId, uuidv7());
    expect(other).toBeUndefined();
    const manager = (
      await db.admin.query(
        "select default_unit_id from memberships where tenant_id = $1 and role = 'manager'",
        [a.tenantId],
      )
    ).rows[0] as { default_unit_id: string };
    expect(manager.default_unit_id).toBe(a.unitId);
  });
});

describe("colunas novas", () => {
  it("pending_questions.kind recusa valor fora da lista", async () => {
    await expect(
      db.admin.query(
        `insert into pending_questions (id, tenant_id, user_id, inbound_message_id, draft, question, expires_at, kind)
         values ($1, $2, $3, $4, '{}', 'q', $5, 'outro')`,
        [uuidv7(), b.tenantId, b.userId, b.inboundMessageId, FUTURE],
      ),
    ).rejects.toThrow(/pending_questions_kind_check/);
  });
});
