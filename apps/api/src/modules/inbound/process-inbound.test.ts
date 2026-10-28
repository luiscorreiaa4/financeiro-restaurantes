import type { ClaimedInboundMessage, InboundProcessingRepo } from "@app/core";
import { describe, expect, it } from "vitest";
import { createLogger, type JobLogger } from "../../infra/logger";
import { createProcessInbound, describeError, type RouteInbound } from "./process-inbound";

const ID = "0197d6c0-0000-7000-8000-000000000001";
const FIRST_ATTEMPT = { retryCount: 0, retryLimit: 5 };
const LAST_ATTEMPT = { retryCount: 5, retryLimit: 5 };
const SECRET_TEXT = "paguei 350 reais pro seu Zé do peixe";

/** Implementação em memória da porta, com a mesma regra de estados do adaptador do banco. */
class MemoryRepo implements InboundProcessingRepo {
  status: string;
  error: string | null = null;
  constructor(status = "received") {
    this.status = status;
  }
  async claim(id: string): Promise<ClaimedInboundMessage | null> {
    if (id !== ID || !["received", "processing"].includes(this.status)) return null;
    this.status = "processing";
    return {
      id: ID,
      waMessageId: "wamid.X",
      waId: "5511987654321",
      waUserId: null,
      type: "text",
      text: SECRET_TEXT,
      replyToWaMessageId: null,
    };
  }
  async markProcessed() {
    if (this.status !== "processing") return false;
    this.status = "processed";
    return true;
  }
  async markFailed(_id: string, errorCode: string) {
    if (!["received", "processing"].includes(this.status)) return false;
    this.status = "failed";
    this.error = errorCode;
    return true;
  }
}

function setup(options: { status?: string; route?: RouteInbound } = {}) {
  const repo = new MemoryRepo(options.status);
  const lines: string[] = [];
  const logger = createLogger("info", { write: (line) => lines.push(line) });
  const routed: ClaimedInboundMessage[] = [];
  const route: RouteInbound =
    options.route ??
    (async (message) => {
      routed.push(message);
    });
  const processInbound = createProcessInbound({ repo, route, logger });
  const job = { inboundMessageId: ID, waMessageId: "wamid.X" };
  return { repo, lines, routed, processInbound, job };
}

describe("process-inbound (caso de uso)", () => {
  it("mensagem recebida passa por processing e termina processed", async () => {
    const { repo, routed, processInbound, job } = setup();
    expect(await processInbound(job, FIRST_ATTEMPT)).toBe("processed");
    expect(repo.status).toBe("processed");
    expect(routed).toHaveLength(1);
  });

  it("mensagem já processada é ignorada sem chamar o roteamento", async () => {
    const { repo, routed, processInbound, job } = setup({ status: "processed" });
    expect(await processInbound(job, FIRST_ATTEMPT)).toBe("skipped");
    expect(repo.status).toBe("processed");
    expect(routed).toHaveLength(0);
  });

  it("mensagem que já falhou não é reprocessada por um job atrasado", async () => {
    const { routed, processInbound, job } = setup({ status: "failed" });
    expect(await processInbound(job, FIRST_ATTEMPT)).toBe("skipped");
    expect(routed).toHaveLength(0);
  });

  it("mensagem presa em processing (worker caiu) é retomada e concluída", async () => {
    const { repo, routed, processInbound, job } = setup({ status: "processing" });
    expect(await processInbound(job, { retryCount: 1, retryLimit: 5 })).toBe("processed");
    expect(repo.status).toBe("processed");
    expect(routed).toHaveLength(1);
  });

  it("job com payload fora do contrato é recusado sem tocar na mensagem", async () => {
    const { repo, routed, processInbound } = setup();
    for (const bad of [null, {}, { inboundMessageId: "não-é-uuid", waMessageId: "w" }]) {
      expect(await processInbound(bad, FIRST_ATTEMPT)).toBe("invalid_payload");
    }
    expect(repo.status).toBe("received");
    expect(routed).toHaveLength(0);
  });

  it("erro numa tentativa intermediária sobe para retentar e mantém processing", async () => {
    const { repo, processInbound, job } = setup({
      route: async () => {
        throw new Error("falha transitória");
      },
    });
    await expect(processInbound(job, FIRST_ATTEMPT)).rejects.toThrow("falha transitória");
    expect(repo.status).toBe("processing");
    expect(repo.error).toBeNull();
  });

  it("erro na última tentativa marca failed com código curto e sobe o erro", async () => {
    const { repo, processInbound, job } = setup({
      route: async () => {
        throw new TypeError(`não entendi: ${SECRET_TEXT}`);
      },
    });
    await expect(processInbound(job, LAST_ATTEMPT)).rejects.toThrow(TypeError);
    expect(repo.status).toBe("failed");
    expect(repo.error).toBe("TypeError");
  });

  it("o log não contém o texto da mensagem nem a mensagem do erro", async () => {
    const { lines, processInbound, job } = setup({
      route: async (message) => {
        throw new Error(`falhou em: ${message.text}`);
      },
    });
    await expect(processInbound(job, LAST_ATTEMPT)).rejects.toThrow();
    const log = lines.join("\n");
    expect(log).toContain("mensagem falhou após todas as tentativas");
    expect(log).not.toContain(SECRET_TEXT);
    expect(log).not.toContain("5511987654321");
  });
});

describe("describeError", () => {
  it("usa o nome do erro e, quando existe, o código textual (ex.: SQLSTATE)", () => {
    expect(describeError(new RangeError("x"))).toBe("RangeError");
    expect(describeError(Object.assign(new Error("x"), { code: "40001" }))).toBe("Error:40001");
    expect(describeError("texto solto com dados")).toBe("UnknownError");
  });
});

describe("logger do worker", () => {
  it("mascara campos sensíveis mesmo se alguém os passar por engano", () => {
    const lines: string[] = [];
    const logger: JobLogger = createLogger("info", { write: (line) => lines.push(line) });
    logger.info({ text: SECRET_TEXT, nested: { raw: SECRET_TEXT, waId: "551187654321" } }, "teste");
    const log = lines.join("");
    expect(log).not.toContain(SECRET_TEXT);
    expect(log).not.toContain("551187654321");
    expect(log).toContain("[Redacted]");
  });
});
