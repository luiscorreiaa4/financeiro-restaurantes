import { normalizeBrazilianPhone } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client";
import { createInboundIngestRepo } from "../src/inbound-ingest-repo";
import { createInboundProcessingRepo } from "../src/inbound-processing-repo";
import { createInboundSenderRepo } from "../src/inbound-sender-repo";
import { createOutboundMessageRepo } from "../src/outbound-message-repo";
import { createSenderDirectory } from "../src/sender-directory";
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

const ingestDb = () => createDatabase(db.ingest);
const appDb = () => createDatabase(db.app);

/** Mensagem recebida ainda sem tenant, como o webhook a deixa. */
async function receive(raw: unknown = {}): Promise<{ id: string; waMessageId: string }> {
  const waMessageId = `wamid.${uuidv7()}`;
  const [stored] = await createInboundIngestRepo(ingestDb()).saveMessages([
    { waMessageId, waId: "551187654321", waUserId: null, type: "text", text: "oi", raw },
  ]);
  return { id: stored?.id ?? "", waMessageId };
}

describe("SenderDirectory", () => {
  const directory = () => createSenderDirectory(ingestDb());

  it("acha o usuário pelo telefone canônico, com papel, restaurante e unidades", async () => {
    const found = await directory().findMemberships([a.phone]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      tenantId: a.tenantId,
      tenantName: "Restaurante A",
      userId: a.userId,
      role: "owner",
      unitId: null,
      tenantUnitIds: [a.unitId],
      deactivatedAt: null,
    });
  });

  it("acha o usuário pelo telefone sem o 9º dígito, como o webhook entrega", async () => {
    const phone = normalizeBrazilianPhone("551187654321");
    if (!phone.ok) throw new Error("telefone inválido no teste");
    const userId = uuidv7();
    await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Com nove', $2)", [
      userId,
      phone.value.e164,
    ]);
    await db.admin.query(
      "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, 'staff')",
      [uuidv7(), a.tenantId, userId],
    );
    const found = await directory().findMemberships(phone.value.lookupCandidates);
    expect(found.map((m) => m.userId)).toEqual([userId]);
  });

  it("devolve um vínculo por restaurante quando o usuário está em dois", async () => {
    await db.admin.query(
      "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, 'manager')",
      [uuidv7(), b.tenantId, a.userId],
    );
    const found = await directory().findMemberships([a.phone]);
    expect(found.map((m) => m.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());
    await db.admin.query("delete from memberships where tenant_id = $1 and user_id = $2", [
      b.tenantId,
      a.userId,
    ]);
  });

  it("devolve o vínculo desativado com a data, sem apagar nada", async () => {
    await db.admin.query(
      "update memberships set deactivated_at = '2026-10-01T12:00:00Z' where tenant_id = $1",
      [b.tenantId],
    );
    const found = await directory().findMemberships([b.phone]);
    expect(found[0]?.deactivatedAt).toEqual(new Date("2026-10-01T12:00:00Z"));
    await db.admin.query("update memberships set deactivated_at = null where tenant_id = $1", [
      b.tenantId,
    ]);
  });

  it("telefone sem cadastro e lista vazia devolvem vazio", async () => {
    expect(await directory().findMemberships(["+5511900000000"])).toEqual([]);
    expect(await directory().findMemberships([])).toEqual([]);
  });
});

describe("InboundSenderRepo", () => {
  const repo = () => createInboundSenderRepo(ingestDb());
  const owner = (f: TenantFixture) => ({ tenantId: f.tenantId, userId: f.userId });

  it("atribui tenant e usuário à mensagem, que passa a ser visível para o tenant", async () => {
    const { id } = await receive();
    expect(await repo().assignSender(id, owner(a))).toBe(true);
    const { rows } = await db.admin.query(
      "select tenant_id, user_id from inbound_messages where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ tenant_id: a.tenantId, user_id: a.userId });
  });

  it("repetir a atribuição (retry do job) continua funcionando", async () => {
    const { id } = await receive();
    expect(await repo().assignSender(id, owner(a))).toBe(true);
    expect(await repo().assignSender(id, owner(a))).toBe(true);
  });

  it("uma mensagem já atribuída nunca troca de tenant", async () => {
    const { id } = await receive();
    await repo().assignSender(id, owner(a));
    expect(await repo().assignSender(id, owner(b))).toBe(false);
    const { rows } = await db.admin.query("select tenant_id from inbound_messages where id = $1", [
      id,
    ]);
    expect(rows[0].tenant_id).toBe(a.tenantId);
  });

  it("mensagem inexistente não é atribuída", async () => {
    expect(await repo().assignSender(uuidv7(), owner(a))).toBe(false);
  });
});

describe("claim devolve a mensagem citada no reply", () => {
  const claim = (id: string) => createInboundProcessingRepo(ingestDb()).claim(id);

  it("lê context.id do payload bruto", async () => {
    const { id } = await receive({ message: { context: { id: "wamid.CONFIRMACAO1" } } });
    expect((await claim(id))?.replyToWaMessageId).toBe("wamid.CONFIRMACAO1");
  });

  it("é nulo quando a mensagem não cita nada", async () => {
    const { id } = await receive({ message: { id: "x" } });
    expect((await claim(id))?.replyToWaMessageId).toBeNull();
  });
});

describe("TenantConversationRepo", () => {
  const repo = () => createTenantConversationRepo(appDb());

  describe("opt-in", () => {
    it("registra na primeira mensagem e não duplica nas seguintes", async () => {
      const user = uuidv7();
      await db.admin.query("insert into users (id, name, phone_e164) values ($1, 'Novo', $2)", [
        user,
        "+5511911112222",
      ]);
      const first = await receive();
      await createInboundSenderRepo(ingestDb()).assignSender(first.id, {
        tenantId: a.tenantId,
        userId: user,
      });
      const input = { tenantId: a.tenantId, userId: user, inboundMessageId: first.id };
      expect(await repo().recordOptIn(input)).toBe(true);
      expect(await repo().recordOptIn(input)).toBe(false);
      const { rows } = await db.admin.query(
        "select source, inbound_message_id from whatsapp_opt_ins where user_id = $1",
        [user],
      );
      expect(rows).toEqual([{ source: "first_message", inbound_message_id: first.id }]);
    });

    it("exige que a mensagem de origem seja do mesmo tenant", async () => {
      const { id } = await receive();
      await createInboundSenderRepo(ingestDb()).assignSender(id, {
        tenantId: b.tenantId,
        userId: b.userId,
      });
      await expect(
        repo().recordOptIn({ tenantId: a.tenantId, userId: uuidv7(), inboundMessageId: id }),
      ).rejects.toThrow();
    });
  });

  describe("resposta a uma mensagem nossa", () => {
    /** Uma mensagem de origem nova por resposta: só pode haver uma confirmação por origem. */
    const saveOutbound = async (
      f: TenantFixture,
      waMessageId: string,
      purpose: "confirmation" | "help",
    ): Promise<string> => {
      const inboundMessageId = uuidv7();
      await db.admin.query(
        `insert into inbound_messages (id, tenant_id, user_id, wa_message_id, type, text, raw, status)
         values ($1, $2, $3, $4, 'text', 'x', '{}', 'processed')`,
        [inboundMessageId, f.tenantId, f.userId, `wamid.${uuidv7()}`],
      );
      await createOutboundMessageRepo(ingestDb()).save({
        waMessageId,
        toWaId: f.phone.replace("+", ""),
        text: "Registrado",
        purpose,
        tenantId: f.tenantId,
        inboundMessageId,
        repliedToWaMessageId: null,
      });
      return inboundMessageId;
    };

    it("reconhece a confirmação do próprio tenant, com a mensagem que a originou", async () => {
      const origin = await saveOutbound(a, "dev.out.confirmacao-a", "confirmation");
      expect(await repo().findReplyTarget(a.tenantId, "dev.out.confirmacao-a")).toMatchObject({
        inboundMessageId: origin,
        purpose: "confirmation",
      });
    });

    it("distingue confirmação de mensagem de ajuda", async () => {
      await saveOutbound(a, "dev.out.ajuda-a", "help");
      expect((await repo().findReplyTarget(a.tenantId, "dev.out.ajuda-a"))?.purpose).toBe("help");
    });

    it("não reconhece a mensagem de outro tenant, nem uma id desconhecida", async () => {
      await saveOutbound(b, "dev.out.confirmacao-b", "confirmation");
      expect(await repo().findReplyTarget(a.tenantId, "dev.out.confirmacao-b")).toBeNull();
      expect(await repo().findReplyTarget(a.tenantId, "dev.out.nao-existe")).toBeNull();
    });
  });

  describe("pergunta pendente", () => {
    const now = new Date("2026-10-28T15:00:00Z");
    const ask = (f: TenantFixture, userId: string, expiresAt: string) =>
      db.admin.query(
        `insert into pending_questions (id, tenant_id, user_id, inbound_message_id, draft, question, expires_at)
         values ($1, $2, $3, $4, '{}', 'Qual o valor?', $5)`,
        [uuidv7(), f.tenantId, userId, f.inboundMessageId, expiresAt],
      );

    it("vê a pergunta ainda válida do usuário", async () => {
      await db.admin.query("delete from pending_questions");
      await ask(a, a.userId, "2026-10-28T16:00:00Z");
      expect(await repo().hasPendingQuestion({ tenantId: a.tenantId, userId: a.userId, now })).toBe(
        true,
      );
    });

    it("ignora a pergunta expirada", async () => {
      await db.admin.query("delete from pending_questions");
      await ask(a, a.userId, "2026-10-28T14:59:59Z");
      expect(await repo().hasPendingQuestion({ tenantId: a.tenantId, userId: a.userId, now })).toBe(
        false,
      );
    });

    it("não mistura perguntas de outro usuário nem de outro tenant", async () => {
      await db.admin.query("delete from pending_questions");
      await ask(b, b.userId, "2026-10-28T16:00:00Z");
      expect(await repo().hasPendingQuestion({ tenantId: a.tenantId, userId: a.userId, now })).toBe(
        false,
      );
      expect(await repo().hasPendingQuestion({ tenantId: a.tenantId, userId: b.userId, now })).toBe(
        false,
      );
    });
  });
});

describe("OutboundMessageRepo", () => {
  const repo = () => createOutboundMessageRepo(ingestDb());

  it("grava resposta a número desconhecido (sem tenant) e a lista para o destinatário", async () => {
    const { id } = await receive();
    const before = new Date(Date.now() - 1000);
    await repo().save({
      waMessageId: `dev.out.${uuidv7()}`,
      toWaId: "5511900001111",
      text: "Não encontrei este número",
      purpose: "notice",
      tenantId: null,
      inboundMessageId: id,
      repliedToWaMessageId: null,
    });
    const listed = await repo().listSince("5511900001111", before);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ text: "Não encontrei este número", purpose: "notice" });
    expect(await repo().listSince("5511900001111", new Date(Date.now() + 60_000))).toEqual([]);
    expect(await repo().listSince("5511900009999", before)).toEqual([]);
  });

  it("a resposta sem tenant não aparece para nenhum tenant (papel app)", async () => {
    const { rows } = await db.app.query("select count(*)::int as n from outbound_messages");
    expect(rows[0].n).toBe(0);
  });

  it("recusa o mesmo wa_message_id duas vezes", async () => {
    const waMessageId = `dev.out.${uuidv7()}`;
    const message = {
      waMessageId,
      toWaId: "5511900001111",
      text: "x",
      purpose: "notice" as const,
      tenantId: null,
      inboundMessageId: null,
      repliedToWaMessageId: null,
    };
    await repo().save(message);
    await expect(repo().save(message)).rejects.toThrow();
  });
});
