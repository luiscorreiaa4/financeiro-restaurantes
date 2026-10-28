import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWebhook } from "./parse";

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../test/fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("contrato: fixtures da Meta contra o parser", () => {
  it("mensagem de texto vira uma mensagem text com remetente e id do usuário", () => {
    const { messages, statuses } = parseWebhook(fixture("text-message"));
    expect(statuses).toEqual([]);
    expect(messages).toMatchObject([
      {
        waMessageId: "wamid.TEXTO1",
        waId: "551187654321",
        waUserId: "BR.1234567890123456",
        type: "text",
        text: "Teste",
      },
    ]);
  });

  it("o raw guarda só o evento da mensagem, com metadata e contato", () => {
    const [message] = parseWebhook(fixture("text-message")).messages;
    expect(message?.raw).toMatchObject({
      metadata: { phone_number_id: "100000000000001" },
      contact: { wa_id: "551187654321" },
      message: { id: "wamid.TEXTO1" },
    });
  });

  it("áudio e imagem são classificados e não carregam texto", () => {
    expect(parseWebhook(fixture("audio-message")).messages).toMatchObject([
      { type: "audio", text: null },
    ]);
    expect(parseWebhook(fixture("image-message")).messages).toMatchObject([
      { type: "image", text: null },
    ]);
  });

  it("resposta (reply) continua sendo texto e preserva o contexto no raw", () => {
    const [message] = parseWebhook(fixture("reply-message")).messages;
    expect(message).toMatchObject({ type: "text", text: "era 50" });
    expect(message?.raw).toMatchObject({
      message: { context: { id: "wamid.CONFIRMACAO1" } },
    });
  });

  it("tipos que não tratamos (reação, figurinha) viram unsupported sem perder a mensagem", () => {
    expect(parseWebhook(fixture("reaction-message")).messages).toMatchObject([
      { type: "unsupported", text: null },
    ]);
  });

  it("status failed guarda o código 130497 e o motivo", () => {
    const { messages, statuses } = parseWebhook(fixture("status-failed-130497"));
    expect(messages).toEqual([]);
    expect(statuses).toMatchObject([
      {
        waMessageId: "wamid.SAIDA1",
        status: "failed",
        recipientId: "551187654321",
        errorCode: 130497,
        errorDetail: "Business account is restricted from messaging users in this country.",
      },
    ]);
    expect(statuses[0]?.occurredAt?.toISOString()).toBe("2026-10-28T02:00:00.000Z");
  });

  it("status delivered e read não têm erro", () => {
    expect(parseWebhook(fixture("status-delivered")).statuses).toMatchObject([
      { status: "delivered", errorCode: null, errorTitle: null },
    ]);
    expect(parseWebhook(fixture("status-read")).statuses).toMatchObject([{ status: "read" }]);
  });

  it("lote misto: itera todas as mensagens e todos os status do mesmo POST", () => {
    const { messages, statuses } = parseWebhook(fixture("batch-mixed"));
    expect(messages.map((m) => [m.waMessageId, m.type])).toEqual([
      ["wamid.LOTE1", "text"],
      ["wamid.LOTE2", "text"],
      ["wamid.LOTE3", "unsupported"],
    ]);
    expect(statuses.map((s) => s.status)).toEqual(["sent"]);
  });

  it("campos novos e desconhecidos da Meta não derrubam o parse", () => {
    const { messages, invalidItems } = parseWebhook(fixture("unknown-field-message"));
    expect(messages).toMatchObject([{ waMessageId: "wamid.NOVO1", text: "oi" }]);
    expect(invalidItems).toBe(0);
  });

  it("evento de outro campo (account_update) é ignorado", () => {
    expect(parseWebhook(fixture("non-message-field"))).toEqual({
      messages: [],
      statuses: [],
      invalidItems: 0,
    });
  });
});

describe("parser tolerante", () => {
  it.each([
    ["null", null],
    ["texto", "oi"],
    ["número", 42],
    ["lista", []],
    ["objeto vazio", {}],
    ["entry inválido", { entry: "x" }],
  ])("payload sem forma de webhook devolve vazio sem lançar erro (%s)", (_name, payload) => {
    expect(parseWebhook(payload)).toEqual({ messages: [], statuses: [], invalidItems: 0 });
  });

  it("um item inválido é contado e não faz perder os outros do lote", () => {
    const payload = structuredClone(fixture("batch-mixed")) as {
      entry: { changes: { value: { messages: unknown[] } }[] }[];
    };
    payload.entry[0]?.changes[0]?.value.messages.unshift({ type: "text" }, "lixo");
    const { messages, invalidItems } = parseWebhook(payload);
    expect(messages).toHaveLength(3);
    expect(invalidItems).toBe(2);
  });

  it("mensagem de texto sem corpo vira unsupported em vez de text vazio", () => {
    const payload = structuredClone(fixture("text-message")) as {
      entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[];
    };
    const first = payload.entry[0]?.changes[0]?.value.messages[0];
    if (first) delete first.text;
    expect(parseWebhook(payload).messages).toMatchObject([{ type: "unsupported", text: null }]);
  });

  it("vários entries e várias changes no mesmo POST são todos percorridos", () => {
    const one = fixture("text-message") as { entry: unknown[] };
    const two = fixture("audio-message") as { entry: unknown[] };
    const merged = { ...one, entry: [...one.entry, ...two.entry] };
    expect(parseWebhook(merged).messages.map((m) => m.type)).toEqual(["text", "audio"]);
  });

  it("timestamp inválido no status vira data nula", () => {
    const payload = structuredClone(fixture("status-delivered")) as {
      entry: { changes: { value: { statuses: Record<string, unknown>[] } }[] }[];
    };
    const status = payload.entry[0]?.changes[0]?.value.statuses[0];
    if (status) status.timestamp = "ontem";
    expect(parseWebhook(payload).statuses).toMatchObject([{ occurredAt: null }]);
  });

  it("sem contato correspondente, o id do usuário fica nulo", () => {
    const payload = structuredClone(fixture("text-message")) as {
      entry: {
        changes: { value: { contacts: unknown[]; messages: Record<string, unknown>[] } }[];
      }[];
    };
    const value = payload.entry[0]?.changes[0]?.value;
    if (value) {
      value.contacts = [];
      delete value.messages[0]?.from_user_id;
    }
    expect(parseWebhook(payload).messages).toMatchObject([{ waUserId: null }]);
  });
});
