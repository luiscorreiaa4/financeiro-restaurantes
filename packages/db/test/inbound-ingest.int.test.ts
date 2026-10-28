import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createInboundIngestRepo } from "../src/inbound-ingest-repo";
import { asTenant, startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
});

afterAll(async () => {
  await db?.stop();
});

const message = (waMessageId: string, text = "Teste") => ({
  waMessageId,
  waId: "551187654321",
  waUserId: null,
  type: "text" as const,
  text,
  raw: { message: { id: waMessageId } },
});

const status = (waMessageId: string, name: string, errorCode: number | null = null) => ({
  waMessageId,
  status: name,
  recipientId: "551187654321",
  errorCode,
  errorTitle: errorCode ? "Restrito" : null,
  errorDetail: null,
  occurredAt: new Date("2026-10-27T12:00:00Z"),
  raw: { id: waMessageId },
});

describe("gravação do webhook (papel app_ingest)", () => {
  it("grava a mensagem sem tenant e marca como nova", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    const stored = await repo.saveMessages([message("wamid.novo-1")]);
    expect(stored).toMatchObject([
      { waMessageId: "wamid.novo-1", isNew: true, status: "received" },
    ]);
    const row = await db.admin.query(
      "select tenant_id, type, text, raw from inbound_messages where wa_message_id = 'wamid.novo-1'",
    );
    expect(row.rows).toEqual([
      { tenant_id: null, type: "text", text: "Teste", raw: { message: { id: "wamid.novo-1" } } },
    ]);
  });

  it("reentrega da mesma mensagem não cria linha e volta como não nova", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    const [first] = await repo.saveMessages([message("wamid.dup-1")]);
    const [second] = await repo.saveMessages([message("wamid.dup-1", "texto diferente")]);
    expect(second).toMatchObject({ id: first?.id, isNew: false });
    const count = await db.admin.query(
      "select count(*)::int as n, min(text) as text from inbound_messages where wa_message_id = 'wamid.dup-1'",
    );
    expect(count.rows[0]).toEqual({ n: 1, text: "Teste" });
  });

  it("lote com mensagem repetida no mesmo POST grava uma vez", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    const stored = await repo.saveMessages([message("wamid.lote-1"), message("wamid.lote-1")]);
    expect(stored).toHaveLength(1);
  });

  it("lote misto de novas e já existentes devolve uma entrada para cada", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    await repo.saveMessages([message("wamid.misto-1")]);
    const stored = await repo.saveMessages([message("wamid.misto-1"), message("wamid.misto-2")]);
    expect(stored.map((s) => [s.waMessageId, s.isNew]).sort()).toEqual([
      ["wamid.misto-1", false],
      ["wamid.misto-2", true],
    ]);
  });

  it("nenhum tenant enxerga a mensagem enquanto ela não tem tenant", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    await repo.saveMessages([message("wamid.sem-dono-1")]);
    await asTenant(db.app, a.tenantId, async (client) => {
      const seen = await client.query(
        "select 1 from inbound_messages where wa_message_id = 'wamid.sem-dono-1'",
      );
      expect(seen.rowCount).toBe(0);
    });
  });

  it("evento de status falhou guarda o código de erro e não duplica na reentrega", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    expect(await repo.saveStatuses([status("wamid.out-1", "failed", 130497)])).toBe(1);
    expect(await repo.saveStatuses([status("wamid.out-1", "failed", 130497)])).toBe(0);
    const row = await db.admin.query(
      "select error_code, status, tenant_id from whatsapp_status_events where wa_message_id = 'wamid.out-1'",
    );
    expect(row.rows).toEqual([{ error_code: 130497, status: "failed", tenant_id: null }]);
  });

  it("estados diferentes da mesma mensagem enviada são eventos distintos", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    const saved = await repo.saveStatuses([
      status("wamid.out-2", "sent"),
      status("wamid.out-2", "delivered"),
      status("wamid.out-2", "read"),
    ]);
    expect(saved).toBe(3);
  });

  it("lista vazia não consulta nem grava nada", async () => {
    const repo = createInboundIngestRepo(createDatabase(db.ingest));
    expect(await repo.saveMessages([])).toEqual([]);
    expect(await repo.saveStatuses([])).toBe(0);
  });
});
