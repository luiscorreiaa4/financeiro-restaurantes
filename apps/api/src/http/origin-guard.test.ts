import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { appOriginOf, ORIGIN_EXEMPT_PATHS } from "./origin-guard";

const APP_URL = "http://localhost:3000";
const ORIGIN = "http://localhost:3000";

function appFor(appUrl = APP_URL) {
  const app = buildApp({ LOG_LEVEL: "silent", APP_URL: appUrl });
  // Rotas de teste: uma por método de escrita e uma isenta com nome parecido.
  app.post("/t/escrita", async () => ({ ok: true }));
  app.put("/t/escrita", async () => ({ ok: true }));
  app.patch("/t/escrita", async () => ({ ok: true }));
  app.delete("/t/escrita", async () => ({ ok: true }));
  app.get("/t/leitura", async () => ({ ok: true }));
  app.post("/webhooks/whatsapp", async () => ({ ok: true }));
  app.post("/webhooks/whatsapp/outro", async () => ({ ok: true }));
  app.post("/webhooks/whatsappX", async () => ({ ok: true }));
  return app;
}

describe("appOriginOf", () => {
  it("ignora barra final e caminho de APP_URL", () => {
    expect(appOriginOf("http://localhost:3000/")).toBe(ORIGIN);
    expect(appOriginOf("http://localhost:3000/painel/x?a=1")).toBe(ORIGIN);
    expect(appOriginOf("https://app.exemplo.com.br/")).toBe("https://app.exemplo.com.br");
  });
});

describe("hook global de Origin (DD-32, RNF01.R10)", () => {
  it("lista de isentas é exatamente o webhook do WhatsApp", () => {
    expect(ORIGIN_EXEMPT_PATHS).toEqual(["/webhooks/whatsapp"]);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s sem Origin é recusado com 403 origin_forbidden",
    async (method) => {
      const app = appFor();
      const response = await app.inject({ method, url: "/t/escrita" });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: "origin_forbidden" });
      await app.close();
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s com Origin do painel passa",
    async (method) => {
      const app = appFor();
      const response = await app.inject({ method, url: "/t/escrita", headers: { origin: ORIGIN } });
      expect(response.statusCode).toBe(200);
      await app.close();
    },
  );

  it("Origin de outro site, 'null' e prefixo parecido são recusados", async () => {
    const app = appFor();
    for (const origin of [
      "null",
      "http://evil.com",
      "http://localhost:3001",
      "https://localhost:3000",
      "http://localhost:3000.evil.com",
      "http://localhost:3000/",
    ]) {
      const response = await app.inject({ method: "POST", url: "/t/escrita", headers: { origin } });
      expect(response.statusCode, origin).toBe(403);
    }
    await app.close();
  });

  it("APP_URL com barra final ou caminho resulta na mesma origem", async () => {
    for (const appUrl of ["http://localhost:3000/", "http://localhost:3000/painel/entrar"]) {
      const app = appFor(appUrl);
      const ok = await app.inject({
        method: "POST",
        url: "/t/escrita",
        headers: { origin: ORIGIN },
      });
      const bad = await app.inject({ method: "POST", url: "/t/escrita" });
      expect(ok.statusCode).toBe(200);
      expect(bad.statusCode).toBe(403);
      await app.close();
    }
  });

  it("GET, HEAD e OPTIONS nunca são barrados pelo hook", async () => {
    const app = appFor();
    expect((await app.inject({ method: "GET", url: "/t/leitura" })).statusCode).toBe(200);
    expect((await app.inject({ method: "HEAD", url: "/t/leitura" })).statusCode).toBe(200);
    const options = await app.inject({ method: "OPTIONS", url: "/t/leitura" });
    expect(options.json?.().code).not.toBe("origin_forbidden");
    await app.close();
  });

  it("webhook POST passa sem Origin e com Origin estranho (a assinatura decide depois)", async () => {
    const app = appFor();
    const semOrigin = await app.inject({ method: "POST", url: "/webhooks/whatsapp" });
    const estranho = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { origin: "http://evil.com" },
    });
    expect(semOrigin.statusCode).toBe(200);
    expect(estranho.statusCode).toBe(200);
    await app.close();
  });

  it("caminho isento com query string continua isento", async () => {
    const app = appFor();
    const response = await app.inject({ method: "POST", url: "/webhooks/whatsapp?a=1&b=/x" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("caminho que só começa com o isento NÃO é isento (comparação exata)", async () => {
    const app = appFor();
    for (const url of ["/webhooks/whatsapp/outro", "/webhooks/whatsappX"]) {
      const response = await app.inject({ method: "POST", url });
      expect(response.statusCode, url).toBe(403);
    }
    await app.close();
  });

  it("barra final no webhook não é isenta: o Fastify roteia essa URL como 404 e o hook recusa antes", async () => {
    const app = appFor();
    const response = await app.inject({ method: "POST", url: "/webhooks/whatsapp/" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "origin_forbidden" });
    await app.close();
  });

  it("recusa não loga o Origin recebido", async () => {
    const lines: string[] = [];
    const app = buildApp(
      { LOG_LEVEL: "debug", APP_URL },
      { logStream: { write: (line) => lines.push(line) } },
    );
    app.post("/t/escrita", async () => ({ ok: true }));
    await app.inject({
      method: "POST",
      url: "/t/escrita",
      headers: { origin: "http://segredo.evil" },
    });
    expect(lines.join("")).not.toContain("segredo.evil");
    await app.close();
  });

  it("toda rota de escrita registrada fora das isentas responde 403 sem Origin", async () => {
    const stub = new Proxy({}, { get: () => async () => undefined }) as never;
    const app = buildApp(
      { LOG_LEVEL: "silent", APP_URL },
      {
        whatsapp: { appSecret: "s", verifyToken: "t", ingest: stub },
        auth: { gateway: stub, checkSession: stub, sessionBlocked: stub, secure: true },
        signup: stub,
        recovery: stub,
        profile: stub,
        panel: stub,
      },
    );
    const routes: Array<{ method: string; url: string }> = [];
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) routes.push({ method, url: route.url });
    });
    await app.ready();
    const writes = routes.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method));
    expect(writes.length).toBeGreaterThan(5);
    const checked: string[] = [];
    for (const { method, url } of writes) {
      if (ORIGIN_EXEMPT_PATHS.includes(url)) continue;
      const response = await app.inject({ method: method as "POST", url });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json(), `${method} ${url}`).toEqual({ code: "origin_forbidden" });
      checked.push(url);
    }
    expect(checked.length).toBeGreaterThan(5);
    await app.close();
  });
});
