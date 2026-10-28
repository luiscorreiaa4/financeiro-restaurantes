import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createInboundIngestRepo } from "../src/inbound-ingest-repo";
import { createInboundProcessingRepo } from "../src/inbound-processing-repo";
import { startTestDatabase, type TestDatabase } from "./database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.admin.query("truncate inbound_messages cascade");
});

async function receive(text = "Teste"): Promise<string> {
  const ingest = createInboundIngestRepo(createDatabase(db.ingest));
  const [stored] = await ingest.saveMessages([
    {
      waMessageId: `wamid.${crypto.randomUUID()}`,
      waId: "551187654321",
      waUserId: null,
      type: "text",
      text,
      raw: {},
    },
  ]);
  return stored?.id ?? "";
}

const row = async (id: string) =>
  (
    await db.admin.query<{ status: string; error: string | null; updated_at: Date }>(
      "select status, error, updated_at from inbound_messages where id = $1",
      [id],
    )
  ).rows[0];

describe("transições de estado da mensagem recebida (papel app_ingest)", () => {
  const repo = () => createInboundProcessingRepo(createDatabase(db.ingest));

  it("claim leva received a processing e devolve a mensagem", async () => {
    const id = await receive("paguei o gás");
    const claimed = await repo().claim(id);
    expect(claimed).toMatchObject({ id, type: "text", text: "paguei o gás", waId: "551187654321" });
    expect((await row(id))?.status).toBe("processing");
  });

  it("claim de uma mensagem em processing (retomada) funciona de novo", async () => {
    const id = await receive();
    await repo().claim(id);
    expect(await repo().claim(id)).not.toBeNull();
  });

  it("claim de mensagem inexistente, processada, falha ou aguardando resposta devolve null", async () => {
    expect(await repo().claim("0197d6c0-0000-7000-8000-00000000dead")).toBeNull();
    for (const status of ["processed", "failed", "needs_answer"]) {
      const id = await receive();
      await db.admin.query("update inbound_messages set status = $2 where id = $1", [id, status]);
      expect(await repo().claim(id)).toBeNull();
      expect((await row(id))?.status).toBe(status);
    }
  });

  it("markProcessed só vale a partir de processing e é idempotente", async () => {
    const id = await receive();
    expect(await repo().markProcessed(id)).toBe(false); // ainda received
    await repo().claim(id);
    expect(await repo().markProcessed(id)).toBe(true);
    expect(await repo().markProcessed(id)).toBe(false);
    expect((await row(id))?.status).toBe("processed");
  });

  it("markFailed guarda o código e não sobrescreve uma mensagem já processada", async () => {
    const failing = await receive();
    await repo().claim(failing);
    expect(await repo().markFailed(failing, "Error:40001")).toBe(true);
    expect(await row(failing)).toMatchObject({ status: "failed", error: "Error:40001" });

    const done = await receive();
    await repo().claim(done);
    await repo().markProcessed(done);
    expect(await repo().markFailed(done, "Error")).toBe(false);
    expect(await row(done)).toMatchObject({ status: "processed", error: null });
  });

  it("dois claims simultâneos da mesma mensagem não corrompem o estado", async () => {
    const id = await receive();
    const results = await Promise.all([repo().claim(id), repo().claim(id)]);
    expect(results.filter((r) => r !== null).length).toBeGreaterThanOrEqual(1);
    expect((await row(id))?.status).toBe("processing");
    expect(await repo().markProcessed(id)).toBe(true);
    expect(await repo().markProcessed(id)).toBe(false);
  });
});
