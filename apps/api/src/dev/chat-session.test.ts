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

  it("/audio e /foto levam o arquivo e, na foto, a legenda", () => {
    expect(parseChatInput("/audio nota.ogg")).toEqual({
      kind: "media",
      media: "audio",
      path: "nota.ogg",
      caption: "",
    });
    expect(parseChatInput("/foto cupom.jpg nota do mercado")).toEqual({
      kind: "media",
      media: "image",
      path: "cupom.jpg",
      caption: "nota do mercado",
    });
  });

  it("/reply leva o texto que vem depois e /custo não leva nada", () => {
    expect(parseChatInput("/reply foi 400")).toEqual({ kind: "reply", text: "foi 400" });
    expect(parseChatInput("/custo")).toEqual({ kind: "cost" });
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
    answers?: {
      afterPoll: number;
      waMessageId: string;
      text: string;
      createdAt: Date;
      purpose?: "confirmation" | "question" | "help" | "notice";
    }[];
    usage?: { calls: number; costUsdMicros: number } | null;
    /** Arquivos que o chat consegue guardar, por caminho digitado. */
    files?: Record<string, { mediaId: string; mimeType: string }>;
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
              purpose: a.purpose ?? ("notice" as const),
              createdAt: a.createdAt,
            }));
        },
      },
      async stageMedia(path) {
        return scenario.files?.[path] ?? null;
      },
      async usageSummary() {
        return scenario.usage ?? null;
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

  it("avisa quando termina sem nenhuma resposta", async () => {
    const { session } = setup();
    const lines = await session.send("paguei 350 de carne");
    expect(lines).toEqual(["(sem resposta para essa mensagem)"]);
  });

  it("/reply cita a última confirmação recebida e não as outras mensagens", async () => {
    const { session, posted } = setup({
      answers: [
        {
          afterPoll: 1,
          waMessageId: "dev.out.confirmacao",
          text: "✅ Registrado",
          createdAt: new Date("2026-10-28T15:00:01Z"),
          purpose: "confirmation",
        },
        {
          afterPoll: 1,
          waMessageId: "dev.out.aviso",
          text: "Aviso",
          createdAt: new Date("2026-10-28T15:00:02Z"),
          purpose: "notice",
        },
      ],
    });
    await session.send("camarão 450");
    await session.reply("foi 400");
    const message = JSON.parse(posted[1]?.body ?? "{}").entry[0].changes[0].value.messages[0];
    expect(message.context).toMatchObject({ id: "dev.out.confirmacao" });
    expect(message.text.body).toBe("foi 400");
  });

  it("/reply sem confirmação anterior avisa em vez de enviar", async () => {
    const { session, posted } = setup();
    expect(await session.reply("foi 400")).toEqual([
      expect.stringContaining("nenhuma confirmação"),
    ]);
    expect(posted).toHaveLength(0);
  });

  it("/foto monta o payload de imagem com a legenda e o id do arquivo guardado", async () => {
    const { session, posted } = setup({
      files: { "cupom.jpg": { mediaId: "dev.media.9", mimeType: "image/jpeg" } },
    });
    await session.sendMedia("image", "cupom.jpg", "nota do mercado");
    const message = JSON.parse(posted[0]?.body ?? "{}").entry[0].changes[0].value.messages[0];
    expect(message).toMatchObject({
      type: "image",
      image: { id: "dev.media.9", mime_type: "image/jpeg", caption: "nota do mercado" },
    });
  });

  it("/audio monta o payload de áudio, assinado como o webhook real, sem legenda", async () => {
    const { session, posted } = setup({
      files: { "nota.ogg": { mediaId: "dev.media.8", mimeType: "audio/ogg; codecs=opus" } },
    });
    await session.sendMedia("audio", "nota.ogg", "ignorada");
    const { body, signature } = posted[0] ?? { body: "", signature: "" };
    expect(
      isValidSignature({
        rawBody: new TextEncoder().encode(body),
        header: signature,
        appSecret: SECRET,
      }),
    ).toBe(true);
    const message = JSON.parse(body).entry[0].changes[0].value.messages[0];
    expect(message.type).toBe("audio");
    expect(message.audio).toMatchObject({ id: "dev.media.8" });
    expect(message.audio.caption).toBeUndefined();
  });

  it("/audio com arquivo que não existe avisa em vez de enviar", async () => {
    const { session, posted } = setup();
    expect(await session.sendMedia("audio", "sumiu.ogg", "")).toEqual([
      expect.stringContaining("não achei um arquivo de áudio"),
    ]);
    expect(await session.sendMedia("image", "", "")).toEqual([expect.stringContaining("use:")]);
    expect(posted).toHaveLength(0);
  });

  it("/custo mostra o gasto de IA do usuário atual", async () => {
    const { session } = setup({ usage: { calls: 3, costUsdMicros: 1234 } });
    expect(await session.cost()).toEqual(["(custo de IA: US$ 0.00123 em 3 chamada(s))"]);
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
