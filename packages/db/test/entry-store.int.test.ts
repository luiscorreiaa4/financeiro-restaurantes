import {
  createEntry,
  type EntryChange,
  type EntryDraft,
  editEntry,
  money,
  softDeleteEntry,
} from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createEntryStore } from "../src/entry-store";
import { createOutboundMessageRepo } from "../src/outbound-message-repo";
import { createTenantConversationRepo } from "../src/tenant-conversation-repo";
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

const store = () => createEntryStore(createDatabase(db.app));
const m = (cents: number) => {
  const result = money(cents);
  if (!result.ok) throw new Error("centavos inválidos");
  return result.value;
};

/** Mensagem recebida já atribuída ao tenant, como o worker a deixa. */
async function inbound(f: TenantFixture, text = "gás 80"): Promise<string> {
  const id = uuidv7();
  await db.admin.query(
    `insert into inbound_messages (id, tenant_id, user_id, wa_message_id, type, text, raw, status)
     values ($1, $2, $3, $4, 'text', $5, '{}', 'processing')`,
    [id, f.tenantId, f.userId, `wamid.${uuidv7()}`, text],
  );
  return id;
}

function newEntry(
  f: TenantFixture,
  inboundMessageId: string,
  overrides: Partial<EntryDraft> = {},
  at = new Date(),
): EntryChange {
  const created = createEntry(
    {
      unitId: f.unitId,
      type: "expense",
      occurredOn: "2026-10-30",
      description: "Gás",
      quantity: null,
      quantityUnit: null,
      amountCents: m(8000),
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: f.categoryId,
      supplierId: null,
      paymentMethodId: null,
      salesChannelId: null,
      inboundMessageId,
      flags: ["category_to_review"],
      ...overrides,
    },
    { id: uuidv7(), tenantId: f.tenantId, actorId: f.userId, channel: "whatsapp", at },
  );
  if (!created.ok) throw new Error(`core recusou: ${created.error.code}`);
  return created.value;
}

const usage = {
  provider: "anthropic",
  model: "claude-haiku-5-5",
  inputTokens: 50,
  outputTokens: 400,
  cacheReadTokens: 2760,
  cacheWriteTokens: 0,
  audioSeconds: 0,
  costUsdMicros: 56,
};

describe("EntryStore: registrar lançamentos", () => {
  it("grava lançamentos, versão, fornecedor novo e uso de IA na mesma transação", async () => {
    const inboundId = await inbound(a);
    const supplierId = uuidv7();
    const first = newEntry(a, inboundId, { supplierId });
    const second = newEntry(a, inboundId, { description: "Óleo", amountCents: m(18000) });

    await store().register({
      tenantId: a.tenantId,
      userId: a.userId,
      inboundMessageId: inboundId,
      entries: [
        { position: 0, change: first },
        { position: 1, change: second },
      ],
      newSuppliers: [{ id: supplierId, name: "Ceasa" }],
      usage: [usage],
    });

    const stored = await store().findEntriesByInbound(a.tenantId, inboundId);
    expect(stored.map((entry) => entry.description)).toEqual(["Gás", "Óleo"]);
    expect(stored[0]).toMatchObject({
      amountCents: 8000,
      netCents: 8000,
      flags: ["category_to_review"],
      supplierId,
      version: 1,
    });

    const versions = await db.admin.query(
      "select action, channel from entry_versions where entry_id = any($1)",
      [[first.entry.id, second.entry.id]],
    );
    expect(versions.rows).toEqual([
      { action: "create", channel: "whatsapp" },
      { action: "create", channel: "whatsapp" },
    ]);
    const supplier = await db.admin.query("select name from suppliers where id = $1", [supplierId]);
    expect(supplier.rows[0]?.name).toBe("Ceasa");
    const ai = await db.admin.query(
      "select cache_read_tokens, cost_usd_micros from ai_usage where inbound_message_id = $1",
      [inboundId],
    );
    expect(ai.rows).toEqual([{ cache_read_tokens: 2760, cost_usd_micros: "56" }]);
  });

  it("erro no meio não deixa lançamento pela metade (CA06)", async () => {
    const inboundId = await inbound(a);
    const ok = newEntry(a, inboundId);
    const duplicatePosition = newEntry(a, inboundId, { description: "Outro" });

    await expect(
      store().register({
        tenantId: a.tenantId,
        userId: a.userId,
        inboundMessageId: inboundId,
        entries: [
          { position: 0, change: ok },
          { position: 0, change: duplicatePosition },
        ],
        newSuppliers: [],
        usage: [usage],
      }),
    ).rejects.toThrow();

    expect(await store().findEntriesByInbound(a.tenantId, inboundId)).toEqual([]);
    const ai = await db.admin.query("select 1 from ai_usage where inbound_message_id = $1", [
      inboundId,
    ]);
    expect(ai.rows).toHaveLength(0);
  });

  it("reprocessar a mesma mensagem não duplica lançamento", async () => {
    const inboundId = await inbound(a);
    const registration = {
      tenantId: a.tenantId,
      userId: a.userId,
      inboundMessageId: inboundId,
      newSuppliers: [],
      usage: [],
    };
    await store().register({
      ...registration,
      entries: [{ position: 0, change: newEntry(a, inboundId) }],
    });
    await expect(
      store().register({
        ...registration,
        entries: [{ position: 0, change: newEntry(a, inboundId) }],
      }),
    ).rejects.toThrow();
    expect(await store().findEntriesByInbound(a.tenantId, inboundId)).toHaveLength(1);
  });

  it("não enxerga lançamentos de outro tenant", async () => {
    const inboundId = await inbound(a);
    await store().register({
      tenantId: a.tenantId,
      userId: a.userId,
      inboundMessageId: inboundId,
      entries: [{ position: 0, change: newEntry(a, inboundId) }],
      newSuppliers: [],
      usage: [],
    });
    expect(await store().findEntriesByInbound(b.tenantId, inboundId)).toEqual([]);
    const recent = await store().findRecentEntries(b.tenantId, new Date(0));
    expect(recent.every((row) => row.inboundMessageId !== inboundId)).toBe(true);
  });
});

describe("EntryStore: catálogo e duplicidade", () => {
  it("carrega o catálogo do tenant com as categorias do sistema e sem as de outro tenant", async () => {
    const catalog = await store().loadCatalog(a.tenantId);
    expect(catalog.categories.map((category) => category.id)).toContain(a.categoryId);
    expect(catalog.categories.map((category) => category.id)).not.toContain(b.categoryId);
    expect(catalog.units).toEqual([{ id: a.unitId, name: "Matriz" }]);
    expect(catalog.paymentMethods.map((method) => method.name)).toContain("Pix");
  });

  it("lista os lançamentos ativos recentes e ignora os da lixeira", async () => {
    const inboundId = await inbound(a, "repetido");
    const entry = newEntry(a, inboundId, { description: "Repetido" });
    await store().register({
      tenantId: a.tenantId,
      userId: a.userId,
      inboundMessageId: inboundId,
      entries: [{ position: 0, change: entry }],
      newSuppliers: [],
      usage: [],
    });
    const since = new Date(Date.now() - 60_000);
    expect(
      (await store().findRecentEntries(a.tenantId, since)).map((r) => r.description),
    ).toContain("Repetido");

    const deleted = softDeleteEntry(entry.entry, {
      actorId: a.userId,
      channel: "whatsapp",
      at: new Date(),
    });
    if (!deleted.ok) throw new Error("exclusão falhou");
    await store().applyChanges(a.tenantId, [deleted.value]);
    expect(
      (await store().findRecentEntries(a.tenantId, since)).map((r) => r.description),
    ).not.toContain("Repetido");
  });
});

describe("EntryStore: desfazer e corrigir", () => {
  it("devolve só a mensagem mais recente do usuário com lançamentos ativos, na janela", async () => {
    const f = await createTenant(db.admin, "Restaurante C");
    const older = await inbound(f, "antigo");
    const newer = await inbound(f, "novo");
    const t0 = Date.now();
    await store().register({
      tenantId: f.tenantId,
      userId: f.userId,
      inboundMessageId: older,
      entries: [
        { position: 0, change: newEntry(f, older, { description: "Antigo" }, new Date(t0 + 1000)) },
      ],
      newSuppliers: [],
      usage: [],
    });
    await store().register({
      tenantId: f.tenantId,
      userId: f.userId,
      inboundMessageId: newer,
      entries: [
        { position: 0, change: newEntry(f, newer, { description: "Novo A" }, new Date(t0 + 2000)) },
        {
          position: 1,
          change: newEntry(f, newer, { description: "Novo B" }, new Date(t0 + 2000)),
        },
      ],
      newSuppliers: [],
      usage: [],
    });

    const since = new Date(t0 - 24 * 3600_000);
    // O createTenant já cria o lançamento "Mercado" (agora); os do teste são um pouco depois.
    const batch = await store().findLatestActiveBatch({
      tenantId: f.tenantId,
      userId: f.userId,
      since,
    });
    expect(batch.map((entry) => entry.description)).toEqual(["Novo A", "Novo B"]);

    const deletions = batch.map((entry) => {
      const result = softDeleteEntry(entry, {
        actorId: f.userId,
        channel: "whatsapp",
        at: new Date(),
      });
      if (!result.ok) throw new Error("exclusão falhou");
      return result.value;
    });
    expect(await store().applyChanges(f.tenantId, deletions)).toBe(true);

    const next = await store().findLatestActiveBatch({
      tenantId: f.tenantId,
      userId: f.userId,
      since,
    });
    expect(next.map((entry) => entry.description)).toEqual(["Antigo"]);

    const outsideWindow = await store().findLatestActiveBatch({
      tenantId: f.tenantId,
      userId: f.userId,
      since: new Date(t0 + 60_000),
    });
    expect(outsideWindow).toEqual([]);
  });

  it("recusa a alteração quando o lançamento mudou no meio e não grava versão", async () => {
    const inboundId = await inbound(a);
    const original = newEntry(a, inboundId);
    await store().register({
      tenantId: a.tenantId,
      userId: a.userId,
      inboundMessageId: inboundId,
      entries: [{ position: 0, change: original }],
      newSuppliers: [],
      usage: [],
    });
    const context = { actorId: a.userId, channel: "whatsapp" as const, at: new Date() };
    const edited = editEntry(original.entry, { amountCents: m(9000) }, context);
    if (!edited.ok) throw new Error("edição falhou");
    expect(await store().applyChanges(a.tenantId, [edited.value])).toBe(true);

    // Segunda alteração calculada sobre a versão antiga: deve ser recusada.
    const stale = editEntry(original.entry, { amountCents: m(9500) }, context);
    if (!stale.ok) throw new Error("edição falhou");
    expect(await store().applyChanges(a.tenantId, [stale.value])).toBe(false);

    const [current] = await store().findEntriesByInbound(a.tenantId, inboundId);
    expect(current).toMatchObject({ amountCents: 9000, version: 2 });
    const versions = await db.admin.query(
      "select version from entry_versions where entry_id = $1",
      [original.entry.id],
    );
    expect(versions.rows).toHaveLength(2);
  });

  it("guarda o id da confirmação nos lançamentos da mensagem", async () => {
    const inboundId = await inbound(a);
    await store().register({
      tenantId: a.tenantId,
      userId: a.userId,
      inboundMessageId: inboundId,
      entries: [{ position: 0, change: newEntry(a, inboundId) }],
      newSuppliers: [],
      usage: [],
    });
    await store().setConfirmation(a.tenantId, inboundId, "dev.out.confirmacao-1");
    const [entry] = await store().findEntriesByInbound(a.tenantId, inboundId);
    expect(entry?.confirmationWaMessageId).toBe("dev.out.confirmacao-1");
  });
});

describe("EntryStore: pergunta pendente", () => {
  it("só pode haver uma pergunta aberta por colaborador (RF15.R8)", async () => {
    const f = await createTenant(db.admin, "Restaurante D");
    const open = (id: string) => ({
      id,
      draft: { pending: [] },
      question: "Qual foi o valor?",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const first = await inbound(f);
    const second = await inbound(f);
    const base = {
      tenantId: f.tenantId,
      userId: f.userId,
      entries: [],
      newSuppliers: [],
      usage: [],
    };

    // O createTenant já deixa uma pergunta aberta: fecha antes.
    const existing = await store().findOpenPendingQuestion({
      tenantId: f.tenantId,
      userId: f.userId,
      now: new Date(),
    });
    if (existing) await store().closePendingQuestion(f.tenantId, existing.id, "cancelled");

    await store().register({
      ...base,
      inboundMessageId: first,
      openPendingQuestion: open(uuidv7()),
    });
    await expect(
      store().register({
        ...base,
        inboundMessageId: second,
        openPendingQuestion: open(uuidv7()),
      }),
    ).rejects.toThrow();
  });

  it("fechar a pergunta ao responder a tira da lista de abertas e grava os lançamentos juntos", async () => {
    const f = await createTenant(db.admin, "Restaurante E");
    const existing = await store().findOpenPendingQuestion({
      tenantId: f.tenantId,
      userId: f.userId,
      now: new Date(),
    });
    if (existing) await store().closePendingQuestion(f.tenantId, existing.id, "cancelled");

    const first = await inbound(f, "camarão");
    const questionId = uuidv7();
    await store().register({
      tenantId: f.tenantId,
      userId: f.userId,
      inboundMessageId: first,
      entries: [],
      newSuppliers: [],
      usage: [],
      openPendingQuestion: {
        id: questionId,
        draft: { description: "camarão" },
        question: "Qual foi o valor?",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const open = await store().findOpenPendingQuestion({
      tenantId: f.tenantId,
      userId: f.userId,
      now: new Date(),
    });
    expect(open).toMatchObject({ id: questionId, question: "Qual foi o valor?" });
    expect(await store().loadInboundText(f.tenantId, first)).toBe("camarão");

    const answer = await inbound(f, "450");
    await store().register({
      tenantId: f.tenantId,
      userId: f.userId,
      inboundMessageId: answer,
      entries: [{ position: 0, change: newEntry(f, answer, { description: "Camarão" }) }],
      newSuppliers: [],
      usage: [],
      closePendingQuestion: { id: questionId, status: "answered" },
    });
    expect(
      await store().findOpenPendingQuestion({
        tenantId: f.tenantId,
        userId: f.userId,
        now: new Date(),
      }),
    ).toBeNull();
    const conversation = createTenantConversationRepo(createDatabase(db.app));
    expect(
      await conversation.hasPendingQuestion({
        tenantId: f.tenantId,
        userId: f.userId,
        now: new Date(),
      }),
    ).toBe(false);
  });

  it("pergunta expirada não conta como aberta", async () => {
    const f = await createTenant(db.admin, "Restaurante F");
    await db.admin.query(
      "update pending_questions set expires_at = now() - interval '1 minute' where tenant_id = $1",
      [f.tenantId],
    );
    expect(
      await store().findOpenPendingQuestion({
        tenantId: f.tenantId,
        userId: f.userId,
        now: new Date(),
      }),
    ).toBeNull();
  });
});

describe("EntryStore: uso de IA e envio idempotente", () => {
  it("soma o custo de IA das mensagens do usuário", async () => {
    const f = await createTenant(db.admin, "Restaurante G");
    const inboundId = await inbound(f);
    await store().recordAiUsage({
      tenantId: f.tenantId,
      inboundMessageId: inboundId,
      usage: [usage, { ...usage, costUsdMicros: 200 }],
    });
    const total = await store().sumAiUsageForUser({ tenantId: f.tenantId, userId: f.userId });
    // O createTenant grava 1 linha de uso (custo 0) na mensagem dele.
    expect(total.costUsdMicros).toBe(256);
    expect(total.calls).toBe(3);
  });

  it("recusa uma segunda confirmação para a mesma mensagem de origem (RF16.Obs1)", async () => {
    const f = await createTenant(db.admin, "Restaurante H");
    const inboundId = await inbound(f);
    const outbound = createOutboundMessageRepo(createDatabase(db.ingest));
    const message = (waMessageId: string, purpose: "confirmation" | "notice") => ({
      waMessageId,
      toWaId: "5511900000000",
      text: "x",
      purpose,
      tenantId: f.tenantId,
      inboundMessageId: inboundId,
      repliedToWaMessageId: null,
    });
    await outbound.save(message("dev.out.1", "confirmation"));
    await expect(outbound.save(message("dev.out.2", "confirmation"))).rejects.toThrow();
    // Avisos continuam livres: uma mensagem pode gerar mais de um aviso.
    await outbound.save(message("dev.out.3", "notice"));
    await outbound.save(message("dev.out.4", "notice"));
  });
});
