import { signBody } from "@app/whatsapp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { IngestResult } from "../../modules/inbound/ingest-webhook";

const SECRET = "app-secret-de-teste";
const TOKEN = "verify-token-de-teste";

const emptyResult: IngestResult = {
  messages: 0,
  newMessages: 0,
  enqueued: 0,
  statuses: 0,
  newStatuses: 0,
  invalidItems: 0,
};

function setup(
  overrides: { appSecret?: string | undefined; verifyToken?: string | undefined } = {},
) {
  const payloads: unknown[] = [];
  const app = buildApp(
    { LOG_LEVEL: "silent" },
    {
      whatsapp: {
        appSecret: "appSecret" in overrides ? overrides.appSecret : SECRET,
        verifyToken: "verifyToken" in overrides ? overrides.verifyToken : TOKEN,
        ingest: async (payload) => {
          payloads.push(payload);
          return emptyResult;
        },
      },
    },
  );
  return { app, payloads };
}

const open: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

function post(app: ReturnType<typeof buildApp>, body: string | Buffer, signature?: string) {
  return app.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    headers: {
      "content-type": "application/json",
      ...(signature === undefined ? {} : { "x-hub-signature-256": signature }),
    },
    payload: body,
  });
}

describe("GET /webhooks/whatsapp (handshake)", () => {
  const url = (query: string) => `/webhooks/whatsapp?${query}`;

  it("devolve o challenge em texto puro quando o token confere", async () => {
    const { app } = setup();
    open.push(app);
    const response = await app.inject({
      method: "GET",
      url: url(`hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=12345`),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("12345");
    expect(response.headers["content-type"]).toContain("text/plain");
  });

  it("recusa com 403 token errado ou modo diferente", async () => {
    const { app } = setup();
    open.push(app);
    for (const query of [
      "hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1",
      `hub.mode=outro&hub.verify_token=${TOKEN}&hub.challenge=1`,
      `hub.mode=subscribe&hub.verify_token=${TOKEN}`,
      "",
    ]) {
      const response = await app.inject({ method: "GET", url: url(query) });
      expect(response.statusCode, query).toBe(403);
    }
  });

  it("responde 503 quando o token de verificação não está configurado", async () => {
    const { app } = setup({ verifyToken: undefined });
    open.push(app);
    const response = await app.inject({
      method: "GET",
      url: url("hub.mode=subscribe&hub.verify_token=x&hub.challenge=1"),
    });
    expect(response.statusCode).toBe(503);
  });
});

describe("POST /webhooks/whatsapp (assinatura)", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("com assinatura válida responde 200 e entrega o payload ao caso de uso", async () => {
    const { app, payloads } = setup();
    open.push(app);
    const response = await post(app, body, signBody(Buffer.from(body), SECRET));
    expect(response.statusCode).toBe(200);
    expect(payloads).toEqual([JSON.parse(body)]);
  });

  it("assinatura inválida: 401 e nada é processado", async () => {
    const { app, payloads } = setup();
    open.push(app);
    const response = await post(app, body, signBody(Buffer.from(body), "outro-segredo"));
    expect(response.statusCode).toBe(401);
    expect(payloads).toEqual([]);
  });

  it("assinatura ausente: 401 e nada é processado", async () => {
    const { app, payloads } = setup();
    open.push(app);
    expect((await post(app, body)).statusCode).toBe(401);
    expect(payloads).toEqual([]);
  });

  it("corpo adulterado em 1 byte depois de assinado: 401", async () => {
    const { app, payloads } = setup();
    open.push(app);
    const signature = signBody(Buffer.from(body), SECRET);
    const tampered = body.replace("entry", "entrx");
    expect((await post(app, tampered, signature)).statusCode).toBe(401);
    expect(payloads).toEqual([]);
  });

  it("JSON reformatado (mesmo conteúdo, bytes diferentes) não passa na assinatura", async () => {
    const { app } = setup();
    open.push(app);
    const signature = signBody(Buffer.from(body), SECRET);
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    expect((await post(app, reformatted, signature)).statusCode).toBe(401);
  });

  it("sem segredo do app configurado, recusa com 503 em vez de aceitar sem checar", async () => {
    const { app, payloads } = setup({ appSecret: undefined });
    open.push(app);
    expect((await post(app, body, signBody(Buffer.from(body), SECRET))).statusCode).toBe(503);
    expect(payloads).toEqual([]);
  });

  it("corpo assinado que não é JSON: 400", async () => {
    const { app, payloads } = setup();
    open.push(app);
    const garbage = "isto não é json";
    expect((await post(app, garbage, signBody(Buffer.from(garbage), SECRET))).statusCode).toBe(400);
    expect(payloads).toEqual([]);
  });

  it("aceita payload de 3,5 MB (acima do limite padrão de 1 MiB do Fastify)", async () => {
    const { app, payloads } = setup();
    open.push(app);
    const big = JSON.stringify({ entry: [], padding: "x".repeat(3.5 * 1024 * 1024) });
    const response = await post(app, big, signBody(Buffer.from(big), SECRET));
    expect(response.statusCode).toBe(200);
    expect(payloads).toHaveLength(1);
  });

  it("recusa com 413 payload acima do limite da rota", async () => {
    const { app } = setup();
    open.push(app);
    const huge = JSON.stringify({ padding: "x".repeat(4.5 * 1024 * 1024) });
    const response = await post(app, huge, signBody(Buffer.from(huge), SECRET));
    expect(response.statusCode).toBe(413);
  });

  it("o parser de bytes brutos fica restrito ao webhook: /health continua normal", async () => {
    const { app } = setup();
    open.push(app);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("logs", () => {
  it("falha na gravação vira 500 sem registrar o conteúdo da mensagem no log", async () => {
    const lines: string[] = [];
    const app = buildApp(
      { LOG_LEVEL: "info" },
      {
        whatsapp: {
          appSecret: SECRET,
          verifyToken: TOKEN,
          ingest: async () => {
            throw new Error("Failed query: insert ... params: gastei 100 no mercado do Zé");
          },
        },
        logStream: { write: (line) => lines.push(line) },
      },
    );
    open.push(app);
    const body = JSON.stringify({ entry: [] });
    const response = await post(app, body, signBody(Buffer.from(body), SECRET));
    expect(response.statusCode).toBe(500);
    const output = lines.join("");
    expect(output).toContain("falha no webhook");
    expect(output).not.toContain("gastei 100");
  });

  it("não registram a query string do handshake (hub.verify_token é segredo)", async () => {
    const lines: string[] = [];
    const app = buildApp(
      { LOG_LEVEL: "info" },
      {
        whatsapp: { appSecret: SECRET, verifyToken: TOKEN, ingest: async () => emptyResult },
        logStream: { write: (line) => lines.push(line) },
      },
    );
    open.push(app);
    await app.inject({
      method: "GET",
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1`,
    });
    const output = lines.join("");
    expect(output).toContain("/webhooks/whatsapp");
    expect(output).not.toContain(TOKEN);
  });
});
