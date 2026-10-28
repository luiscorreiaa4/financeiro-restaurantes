import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWebhook } from "./parse";
import { buildTextWebhookPayload } from "./simulate";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), "utf8"));

const base = {
  waId: "551187654321",
  waMessageId: "dev.wamid.1",
  text: "paguei 350 de carne",
  sentAt: new Date("2026-10-28T15:00:00Z"),
};

describe("buildTextWebhookPayload", () => {
  it("gera um payload que o parser do webhook entende como mensagem de texto", () => {
    const parsed = parseWebhook(buildTextWebhookPayload(base));
    expect(parsed.invalidItems).toBe(0);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      waMessageId: "dev.wamid.1",
      waId: "551187654321",
      type: "text",
      text: "paguei 350 de carne",
    });
  });

  it("tem a mesma forma do payload real de texto da Meta", () => {
    const real = fixture("text-message").entry[0].changes[0].value;
    const built = (buildTextWebhookPayload(base) as ReturnType<typeof fixture>).entry[0].changes[0]
      .value;
    expect(Object.keys(built).sort()).toEqual(Object.keys(real).sort());
    expect(Object.keys(built.messages[0]).sort()).toEqual(Object.keys(real.messages[0]).sort());
    expect(Object.keys(built.metadata).sort()).toEqual(Object.keys(real.metadata).sort());
  });

  it("converte o horário para segundos, como a Meta", () => {
    const value = (buildTextWebhookPayload(base) as ReturnType<typeof fixture>).entry[0].changes[0]
      .value;
    expect(value.messages[0].timestamp).toBe("1793199600");
  });

  it("sem resposta, não inclui o contexto", () => {
    const value = (buildTextWebhookPayload(base) as ReturnType<typeof fixture>).entry[0].changes[0]
      .value;
    expect(value.messages[0].context).toBeUndefined();
  });

  it("com resposta, cita a mensagem nossa em context.id, como no reply real", () => {
    const payload = buildTextWebhookPayload({ ...base, replyToWaMessageId: "dev.out.1" });
    const message = (payload as ReturnType<typeof fixture>).entry[0].changes[0].value.messages[0];
    const real = fixture("reply-message").entry[0].changes[0].value.messages[0];
    expect(message.context.id).toBe("dev.out.1");
    expect(Object.keys(message.context).sort()).toEqual(Object.keys(real.context).sort());
  });
});
