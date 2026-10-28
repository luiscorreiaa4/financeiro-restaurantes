import type { NewOutboundMessage, OutboundMessageRepo } from "@app/db";
import { describe, expect, it } from "vitest";
import { createDevMessageSender, DevAdapterInProductionError } from "./dev-message-sender";

function memoryRepo(options: { failWith?: Error } = {}) {
  const saved: NewOutboundMessage[] = [];
  const repo: OutboundMessageRepo = {
    async save(message) {
      if (options.failWith) throw options.failWith;
      saved.push(message);
    },
    async listSince() {
      return [];
    },
  };
  return { repo, saved };
}

describe("DevMessageSender", () => {
  it("grava a resposta com id dev.out, destinatário sem o + e a origem", async () => {
    const { repo, saved } = memoryRepo();
    const sender = createDevMessageSender({ repo, nodeEnv: "development" });
    const result = await sender.sendText({
      to: "+5511987654321",
      text: "Registrado",
      replyTo: "dev.wamid.1",
      trace: { tenantId: "t1", inboundMessageId: "in-1", purpose: "confirmation" },
    });
    expect(result.ok && result.value.waMessageId).toMatch(/^dev\.out\.[0-9a-f-]{36}$/);
    expect(saved).toEqual([
      {
        waMessageId: result.ok ? result.value.waMessageId : "",
        toWaId: "5511987654321",
        text: "Registrado",
        purpose: "confirmation",
        tenantId: "t1",
        inboundMessageId: "in-1",
        repliedToWaMessageId: "dev.wamid.1",
      },
    ]);
  });

  it("sem origem informada, grava como aviso sem tenant", async () => {
    const { repo, saved } = memoryRepo();
    await createDevMessageSender({ repo, nodeEnv: "test" }).sendText({
      to: "+5511987654321",
      text: "oi",
    });
    expect(saved[0]).toMatchObject({ purpose: "notice", tenantId: null, inboundMessageId: null });
  });

  it("cada resposta ganha um id diferente", async () => {
    const { repo } = memoryRepo();
    const sender = createDevMessageSender({ repo, nodeEnv: "development" });
    const ids = await Promise.all(
      [1, 2, 3].map(async () => {
        const result = await sender.sendText({ to: "+5511987654321", text: "x" });
        return result.ok ? result.value.waMessageId : "";
      }),
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("falha do banco vira SendFailed sem vazar a mensagem do erro", async () => {
    const { repo } = memoryRepo({ failWith: new TypeError("insert ... values ('texto secreto')") });
    const result = await createDevMessageSender({ repo, nodeEnv: "development" }).sendText({
      to: "+5511987654321",
      text: "texto secreto",
    });
    expect(result).toEqual({ ok: false, error: { code: "SendFailed", detail: "TypeError" } });
  });

  it("recusa subir em produção", () => {
    expect(() =>
      createDevMessageSender({ repo: memoryRepo().repo, nodeEnv: "production" }),
    ).toThrow(DevAdapterInProductionError);
  });

  it("marcar como lida e mostrar digitação funcionam sem efeito colateral", async () => {
    const { repo, saved } = memoryRepo();
    const sender = createDevMessageSender({ repo, nodeEnv: "development" });
    expect(await sender.markAsRead("x")).toEqual({ ok: true, value: true });
    expect(await sender.showTyping("x")).toEqual({ ok: true, value: true });
    expect(saved).toEqual([]);
  });
});
