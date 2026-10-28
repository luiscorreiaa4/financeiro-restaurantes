import { isValidSignature } from "@app/whatsapp";
import { describe, expect, it } from "vitest";
import {
  type ChatDeps,
  ChatSession,
  chatBlockReason,
  parseChatInput,
  replyAddress,
  waIdFromTyped,
} from "./chat-session";

describe("parseChatInput", () => {
  it("texto livre vira mensagem, sem as pontas em branco", () => {
    expect(parseChatInput("  paguei 350 de carne  ")).toEqual({
      kind: "message",
      text: "paguei 350 de carne",
    });
  });

  it("linha vazia é ignorada", () => {
    expect(parseChatInput("   ")).toEqual({ kind: "empty" });
  });

  it("/como carrega o telefone digitado, em qualquer formato", () => {
    expect(parseChatInput("/como (11) 98765-0001")).toEqual({
      kind: "switch_user",
      phone: "(11) 98765-0001",
    });
  });

  it("/sair encerra, sem importar a caixa", () => {
    expect(parseChatInput("/SAIR")).toEqual({ kind: "exit" });
  });

  it.each([
    ["/reply", "E7"],
    ["/custo", "E7"],
    ["/audio nota.ogg", "E9"],
    ["/foto nota.jpg", "E9"],
  ])("%s é um comando previsto para a %s", (line, stage) => {
    expect(parseChatInput(line)).toMatchObject({ kind: "planned", stage });
  });

  it("comando que não existe é apontado", () => {
    expect(parseChatInput("/xpto")).toEqual({ kind: "unknown_command", command: "/xpto" });
  });

  it("mensagem que parece caminho de arquivo não é confundida com texto livre", () => {
    expect(parseChatInput("/tmp/arquivo").kind).toBe("unknown_command");
  });
});

describe("waIdFromTyped", () => {
  it.each([
    ["11987650001", "5511987650001"],
    ["(11) 98765-0001", "5511987650001"],
    ["1187650001", "551187650001"],
    ["+55 11 98765-0001", "5511987650001"],
    ["551187650001", "551187650001"],
    ["+1 415 555 0123", "14155550123"],
  ])("%s vira %s", (typed, expected) => {
    expect(waIdFromTyped(typed)).toBe(expected);
  });

  it("sem dígitos não há telefone", () => {
    expect(waIdFromTyped("abc")).toBeNull();
  });
});

describe("replyAddress", () => {
  it("wa_id sem o 9º dígito recebe a resposta no formato com o 9, como o envio exige", () => {
    expect(replyAddress("551187650001")).toBe("5511987650001");
  });

  it("wa_id já com o 9 continua igual", () => {
    expect(replyAddress("5511987650001")).toBe("5511987650001");
  });

  it("número que não é brasileiro fica como veio", () => {
    expect(replyAddress("14155550123")).toBe("14155550123");
  });
});

describe("chatBlockReason", () => {
  const ok = {
    NODE_ENV: "development",
    CHANNEL_MODE: "dev",
    WHATSAPP_APP_SECRET: "segredo",
    DATABASE_INGEST_URL: "postgres://x",
  };

  it("libera em desenvolvimento com a configuração completa", () => {
    expect(chatBlockReason(ok)).toBeNull();
  });

  it("recusa em produção", () => {
    expect(chatBlockReason({ ...ok, NODE_ENV: "production" })).toContain("production");
  });

  it("recusa com o canal real", () => {
    expect(chatBlockReason({ ...ok, CHANNEL_MODE: "whatsapp" })).toContain("CHANNEL_MODE=dev");
  });

  it("pede o App Secret e a conexão de ingestão quando faltam", () => {
    expect(chatBlockReason({ ...ok, WHATSAPP_APP_SECRET: undefined })).toContain(
      "WHATSAPP_APP_SECRET",
    );
    expect(chatBlockReason({ ...ok, DATABASE_INGEST_URL: undefined })).toContain(
      "DATABASE_INGEST_URL",
    );
  });
});

describe("ChatSession", () => {
  const SECRET = "segredo-de-teste";
  const START = new Date("2026-10-28T15:00:00Z");

  interface Scenario {
    webhookStatus?: number;
    /** Estados da mensagem a cada consulta; o último se repete. */
    states?: (string | null)[];
    /** Respostas que aparecem a partir da N-ésima consulta de respostas. */
    answers?: { afterPoll: number; waMessageId: string; text: string; createdAt: Date }[];
  }

  function setup(scenario: Scenario = {}) {
    let clock = START.getTime();
    let statePolls = 0;
    let answerPolls = 0;
    const posted: { body: string; signature: string }[] = [];
    const asked: { toWaId: string; since: Date }[] = [];
    const deps: ChatDeps = {
      async postWebhook(input) {
        posted.push(input);
        return scenario.webhookStatus ?? 200;
      },
      outbound: {
        async listSince(toWaId, since) {
          asked.push({ toWaId, since });
          answerPolls += 1;
          return (scenario.answers ?? [])
            .filter((a) => a.afterPoll <= answerPolls && a.createdAt > since)
            .map((a) => ({
              waMessageId: a.waMessageId,
              text: a.text,
              purpose: "notice" as const,
              createdAt: a.createdAt,
            }));
        },
      },
      async inboundStatus() {
        const states = scenario.states ?? ["processed"];
        const state = states[Math.min(statePolls, states.length - 1)] ?? null;
        statePolls += 1;
        return state;
      },
      appSecret: SECRET,
      newId: () => "id-1",
      now: () => new Date(clock),
      sleep: async (ms) => {
        clock += ms;
      },
      pollIntervalMs: 500,
      timeoutMs: 2_000,
    };
    return { session: new ChatSession(deps, "551187650001", START), posted, asked };
  }

  it("assina o corpo exato com o App Secret e envia no formato do webhook real", async () => {
    const { session, posted } = setup();
    await session.send("paguei 350 de carne");
    expect(posted).toHaveLength(1);
    const { body, signature } = posted[0] ?? { body: "", signature: "" };
    expect(
      isValidSignature({
        rawBody: new TextEncoder().encode(body),
        header: signature,
        appSecret: SECRET,
      }),
    ).toBe(true);
    const message = JSON.parse(body).entry[0].changes[0].value.messages[0];
    expect(message).toMatchObject({
      from: "551187650001",
      id: "dev.wamid.id-1",
      type: "text",
      text: { body: "paguei 350 de carne" },
    });
  });

  it("mostra a resposta do bot e para quando a mensagem termina", async () => {
    const { session } = setup({
      states: ["received", "processing", "processed"],
      answers: [
        {
          afterPoll: 3,
          waMessageId: "dev.out.1",
          text: "Ainda não há nada para desfazer.",
          createdAt: new Date("2026-10-28T15:00:01Z"),
        },
      ],
    });
    expect(await session.send("desfazer")).toEqual(["Bot: Ainda não há nada para desfazer."]);
  });

  it("mensagem de várias linhas é alinhada sob a primeira", async () => {
    const { session } = setup({
      answers: [
        {
          afterPoll: 1,
          waMessageId: "dev.out.1",
          text: "Linha 1\nLinha 2",
          createdAt: new Date("2026-10-28T15:00:01Z"),
        },
      ],
    });
    expect(await session.send("ajuda")).toEqual(["Bot: Linha 1", "     Linha 2"]);
  });

  it("procura as respostas no endereço com o 9º dígito, mesmo enviando sem ele", async () => {
    const { session, asked } = setup();
    await session.send("oi");
    expect(asked[0]?.toWaId).toBe("5511987650001");
  });

  it("não repete uma resposta já mostrada na mensagem seguinte", async () => {
    const answer = {
      afterPoll: 1,
      waMessageId: "dev.out.1",
      text: "Oi",
      createdAt: new Date("2026-10-28T15:00:01Z"),
    };
    const { session } = setup({ answers: [answer] });
    expect(await session.send("a")).toHaveLength(1);
    expect(await session.send("b")).toEqual([expect.stringContaining("sem resposta")]);
  });

  it("avisa que o ramo não responde quando termina sem resposta", async () => {
    const { session } = setup();
    const lines = await session.send("paguei 350 de carne");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("extração por IA chega na E6");
  });

  it("avisa quando o processamento falha", async () => {
    const { session } = setup({ states: ["processing", "failed"] });
    expect((await session.send("oi"))[0]).toContain("falhou");
  });

  it("avisa que o worker pode estar parado quando estoura o tempo", async () => {
    const { session } = setup({ states: ["received"] });
    expect((await session.send("oi"))[0]).toContain("pnpm dev:worker");
  });

  it("webhook que recusa a mensagem não fica esperando resposta", async () => {
    const { session } = setup({ webhookStatus: 401 });
    expect(await session.send("oi")).toEqual([expect.stringContaining("401")]);
  });

  it("trocar de usuário muda o remetente das próximas mensagens", async () => {
    const { session, posted } = setup();
    session.switchUser("5511987650004");
    await session.send("oi");
    const message = JSON.parse(posted[0]?.body ?? "{}").entry[0].changes[0].value.messages[0];
    expect(message.from).toBe("5511987650004");
    expect(session.currentWaId).toBe("5511987650004");
  });
});
